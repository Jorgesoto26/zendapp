-- =====================================================================
-- MIGRACIÓN: 20261104000003_strict_single_caja_per_day.sql
-- Regla Estricta: Máximo 1 sola caja por usuario por día calendario.
-- 
-- 1. Depuración del registro duplicado cerrado generado durante la prueba.
-- 2. Trigger DB: trg_prevent_duplicate_caja_per_day que bloquea físicamente
--    a nivel de PostgreSQL cualquier segundo INSERT en el mismo día para un usuario.
-- 3. Actualización de admin_create_user: la caja inicial se crea como 'abierta'
--    (vinculada a la caja del admin de hoy), evitando duplicidad al primer login.
-- 4. Actualización de rpc_check_or_open_caja: Si ya existe una caja hoy y está
--    'cerrada', bloquea el login/apertura con mensaje informativo exacto.
-- 5. Actualización de admin_abrir_cajas_masivo: Respeta la regla de caja única diaria.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LIMPIEZA DE CAJA DUPLICADA CERRADA DE PRUEBA
-- ---------------------------------------------------------------------
DELETE FROM public.cajas
WHERE id = 'b4785503-111a-4098-b212-90582869b792'
  AND estado = 'cerrada'
  AND usuario_id = 'b9441380-fee8-47c7-bd9b-06f2085cb84b';

-- ---------------------------------------------------------------------
-- 2. TRIGGER A NIVEL DE MOTOR: MÁXIMO 1 CAJA POR USUARIO POR DÍA
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._check_single_caja_per_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz text := 'America/Bogota';
  v_fecha_nueva date;
  v_count integer;
BEGIN
  -- Calcular fecha calendario local del registro entrante
  v_fecha_nueva := (COALESCE(NEW.fecha_apertura, now()) AT TIME ZONE v_tz)::date;

  -- Verificar si ya existe CUALQUIER caja (abierta o cerrada) para este usuario en esta fecha local
  SELECT COUNT(*) INTO v_count
  FROM public.cajas
  WHERE usuario_id = NEW.usuario_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (fecha_apertura AT TIME ZONE v_tz)::date = v_fecha_nueva;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_CAJA_PER_DAY: El usuario ya tiene una caja registrada para el día % (Zona Horaria %). Bajo ninguna circunstancia se permiten dos cajas en el mismo día.', v_fecha_nueva, v_tz;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_caja_per_day ON public.cajas;
CREATE TRIGGER trg_prevent_duplicate_caja_per_day
BEFORE INSERT ON public.cajas
FOR EACH ROW
EXECUTE FUNCTION public._check_single_caja_per_day();

-- ---------------------------------------------------------------------
-- 3. RPC: admin_create_user
-- Crea la caja inicial en estado 'abierta' y vinculada al admin de hoy
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email                   text,
  p_password                text,
  p_nombre                  text,
  p_apellido                text DEFAULT '',
  p_rol                     text DEFAULT 'vendedor',
  p_dinero_max_caja         numeric DEFAULT 0,
  p_dinero_max_venta        numeric DEFAULT 0,
  p_dinero_max_gasto        numeric DEFAULT 0,
  p_max_cuotas              integer DEFAULT 30,
  p_permite_borrar_venta    boolean DEFAULT false,
  p_permite_modificar_pagos boolean DEFAULT false,
  p_saldo_inicial           numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
  v_encrypted_pw text;
  v_now timestamptz;
  v_admin_org_id uuid;
  v_admin_caja_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden crear usuarios';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS: ya existe un usuario con este correo';
  END IF;

  -- Obtener la organización del administrador creador para heredarla
  SELECT organizacion_id INTO v_admin_org_id 
  FROM public.profiles 
  WHERE id = auth.uid();

  v_new_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_password), gen_salt('bf', 10));
  v_now := now();

  -- Insertar en auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    p_email, v_encrypted_pw, v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false, 'nombre', p_nombre, 'apellido', COALESCE(p_apellido, ''))::jsonb,
    v_now, v_now, '', '', '', '', '', '', '', '', false, false
  );

  -- Insertar en auth.identities
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_new_id::text, v_new_id,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false)::jsonb,
    'email', v_now, v_now, v_now
  );

  -- Insertar en public.profiles
  INSERT INTO public.profiles (
    id, nombre, apellido, rol, superior_id, activo, dinero_max_caja, dinero_max_venta,
    dinero_max_gasto, max_cuotas, permite_borrar_venta, permite_modificar_pagos,
    organizacion_id, updated_at, update_at
  ) VALUES (
    v_new_id, p_nombre, COALESCE(p_apellido, ''), COALESCE(p_rol, 'vendedor'), auth.uid(), true,
    COALESCE(p_dinero_max_caja, 0), COALESCE(p_dinero_max_venta, 0), COALESCE(p_dinero_max_gasto, 0),
    COALESCE(p_max_cuotas, 30), COALESCE(p_permite_borrar_venta, false), COALESCE(p_permite_modificar_pagos, false),
    v_admin_org_id, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido,
    rol = EXCLUDED.rol,
    superior_id = EXCLUDED.superior_id,
    activo = true,
    dinero_max_caja = EXCLUDED.dinero_max_caja,
    dinero_max_venta = EXCLUDED.dinero_max_venta,
    dinero_max_gasto = EXCLUDED.dinero_max_gasto,
    max_cuotas = EXCLUDED.max_cuotas,
    permite_borrar_venta = EXCLUDED.permite_borrar_venta,
    permite_modificar_pagos = EXCLUDED.permite_modificar_pagos,
    organizacion_id = COALESCE(EXCLUDED.organizacion_id, profiles.organizacion_id),
    updated_at = v_now,
    update_at = v_now;

  -- Si es vendedor, crear su única caja de hoy ABIERTA con la base establecida
  IF COALESCE(p_rol, 'vendedor') = 'vendedor' THEN
    SELECT id INTO v_admin_caja_id
    FROM public.cajas
    WHERE usuario_id = auth.uid() AND estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre, admin_caja_id
    ) VALUES (
      v_new_id, 'abierta', COALESCE(p_saldo_inicial, 0), COALESCE(p_saldo_inicial, 0), v_now, NULL, v_admin_caja_id
    );
  END IF;

  RETURN json_build_object('success', true, 'user_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. RPC: rpc_check_or_open_caja (JIT con Bloqueo Estricto de Caja Cerrada Hoy)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_check_or_open_caja(
  p_user_id uuid DEFAULT auth.uid(),
  p_timezone text DEFAULT 'America/Bogota'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id                   uuid;
  v_tz                        text;
  v_hoy_local                 date;
  v_profile                   RECORD;
  v_user_caja_hoy             RECORD;
  v_user_prev_caja            RECORD;
  v_saldo_actual              numeric;
  v_previa_auto_cerrada       boolean := false;
  v_admin_id                  uuid;
  v_admin_caja_hoy            RECORD;
  v_admin_prev_caja           RECORD;
  v_admin_caja_id             uuid := NULL;
  v_admin_last_saldo          numeric := 0;
  v_user_last_saldo           numeric := 0;
  v_nueva_caja                RECORD;
  v_nueva_caja_id             uuid;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no especificado ni autenticado.';
  END IF;

  -- Normalizar zona horaria con fallback seguro
  v_tz := COALESCE(NULLIF(TRIM(p_timezone), ''), 'America/Bogota');
  BEGIN
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Bogota';
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;
  END;

  -- Bloqueo consultivo para evitar condiciones de carrera por doble toque
  PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_user_id::text));

  -- Obtener perfil del usuario
  SELECT rol, superior_id, dinero_max_caja, modo_apertura_caja
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  -- 1. Verificar si el usuario ya tiene CUALQUIER caja registrada hoy (abierta o cerrada)
  SELECT * INTO v_user_caja_hoy
  FROM public.cajas
  WHERE usuario_id = v_user_id
    AND (fecha_apertura AT TIME ZONE v_tz)::date = v_hoy_local
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_user_caja_hoy.id IS NOT NULL THEN
    IF v_user_caja_hoy.estado = 'abierta' THEN
      -- La caja abierta pertenece al día de hoy: actualizar saldo y retornarla
      v_saldo_actual := public._calc_caja_saldo_actual(v_user_caja_hoy.id);
      UPDATE public.cajas
      SET saldo_final = v_saldo_actual
      WHERE id = v_user_caja_hoy.id;

      SELECT * INTO v_user_caja_hoy FROM public.cajas WHERE id = v_user_caja_hoy.id;

      RETURN json_build_object(
        'success', true,
        'caja', row_to_json(v_user_caja_hoy),
        'accion', 'mantiene_hoy',
        'ya_abierta', true,
        'auto_cerrada_previa', false
      );
    ELSE
      -- REGLA ESTRICTA DE NEGOCIO:
      -- Si la caja de hoy está CERRADA, NO se permite reabrir automáticamente
      -- ni crear una nueva. Solo el administrador puede reabrirla.
      RETURN json_build_object(
        'success', false,
        'caja_cerrada_hoy', true,
        'caja', row_to_json(v_user_caja_hoy),
        'message', 'Tu caja del día de hoy ya se encuentra cerrada. Solo tu administrador puede realizar la reapertura de tu caja.'
      );
    END IF;
  END IF;

  -- 2. El usuario NO tiene caja registrada para hoy.
  -- Verificar si tiene alguna caja de un día previo que haya quedado abierta para auto-cerrarla
  SELECT * INTO v_user_prev_caja
  FROM public.cajas
  WHERE usuario_id = v_user_id AND estado = 'abierta'
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_user_prev_caja.id IS NOT NULL THEN
    PERFORM public._auto_close_caja(v_user_prev_caja.id);
    v_previa_auto_cerrada := true;
  END IF;

  -- 3. Si es vendedor (o tiene superior), resolver en cascada la caja del Administrador
  v_admin_id := v_profile.superior_id;

  IF v_admin_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_admin_id::text));

    -- Verificar si el admin ya tiene caja hoy (abierta o cerrada)
    SELECT * INTO v_admin_caja_hoy
    FROM public.cajas
    WHERE usuario_id = v_admin_id
      AND (fecha_apertura AT TIME ZONE v_tz)::date = v_hoy_local
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    IF v_admin_caja_hoy.id IS NOT NULL THEN
      -- El admin ya tiene caja hoy
      v_admin_caja_id := v_admin_caja_hoy.id;
    ELSE
      -- El admin no tiene caja hoy: verificar si tiene caja previa abierta para auto-cerrarla
      SELECT * INTO v_admin_prev_caja
      FROM public.cajas
      WHERE usuario_id = v_admin_id AND estado = 'abierta'
      ORDER BY fecha_apertura DESC
      LIMIT 1;

      IF v_admin_prev_caja.id IS NOT NULL THEN
        PERFORM public._auto_close_caja(v_admin_prev_caja.id);
      END IF;

      -- Crear la caja de hoy del admin en cascada
      SELECT COALESCE(saldo_final, saldo_inicial, 0)
      INTO v_admin_last_saldo
      FROM public.cajas
      WHERE usuario_id = v_admin_id
      ORDER BY fecha_apertura DESC
      LIMIT 1;

      v_admin_last_saldo := COALESCE(v_admin_last_saldo, 0);

      INSERT INTO public.cajas (
        usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura
      ) VALUES (
        v_admin_id, 'abierta', ROUND(v_admin_last_saldo, 2), ROUND(v_admin_last_saldo, 2), now()
      ) RETURNING id INTO v_admin_caja_id;
    END IF;
  END IF;

  -- 4. Crear la única caja de hoy para el usuario
  SELECT COALESCE(saldo_final, saldo_inicial, 0)
  INTO v_user_last_saldo
  FROM public.cajas
  WHERE usuario_id = v_user_id
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  v_user_last_saldo := COALESCE(v_user_last_saldo, 0);

  -- Aplicar restricción de dinero_max_caja si está configurado en el perfil
  IF v_profile.dinero_max_caja IS NOT NULL AND v_profile.dinero_max_caja > 0 AND v_user_last_saldo > v_profile.dinero_max_caja THEN
    v_user_last_saldo := v_profile.dinero_max_caja;
  END IF;

  INSERT INTO public.cajas (
    usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, admin_caja_id
  ) VALUES (
    v_user_id, 'abierta', ROUND(v_user_last_saldo, 2), ROUND(v_user_last_saldo, 2), now(), v_admin_caja_id
  ) RETURNING id INTO v_nueva_caja_id;

  SELECT * INTO v_nueva_caja FROM public.cajas WHERE id = v_nueva_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja', row_to_json(v_nueva_caja),
    'accion', 'abierta_jit',
    'auto_abierta', true,
    'auto_cerrada_previa', v_previa_auto_cerrada,
    'admin_caja_id', v_admin_caja_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_caja(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. RPC: admin_abrir_cajas_masivo (Protegido contra Duplicados de Caja)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_abrir_cajas_masivo(
  p_timezone text DEFAULT 'America/Bogota'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id                  uuid := auth.uid();
  v_tz                        text;
  v_hoy_local                 date;
  v_admin_caja_hoy            RECORD;
  v_admin_prev_caja           RECORD;
  v_admin_caja_id             uuid := NULL;
  v_admin_reutilizada         boolean := false;
  v_last_saldo                numeric := 0;
  v_count                     integer := 0;
  v_vendedores_abiertas       integer := 0;
  v_sub_id                    uuid;
  v_sub_caja_hoy              RECORD;
  v_sub_prev_caja             RECORD;
  v_sub_saldo                 numeric := 0;
  v_sub_max                   numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden ejecutar la apertura masiva.';
  END IF;

  v_tz := COALESCE(NULLIF(TRIM(p_timezone), ''), 'America/Bogota');
  BEGIN
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Bogota';
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;
  END;

  PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_admin_id::text));

  -- 1. Resolver caja del Administrador
  SELECT * INTO v_admin_caja_hoy
  FROM public.cajas
  WHERE usuario_id = v_admin_id
    AND (fecha_apertura AT TIME ZONE v_tz)::date = v_hoy_local
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_admin_caja_hoy.id IS NOT NULL THEN
    v_admin_caja_id := v_admin_caja_hoy.id;
    IF v_admin_caja_hoy.estado = 'abierta' THEN
      v_admin_reutilizada := true;
    ELSE
      -- Si la caja del admin de hoy estaba cerrada y ejecuta apertura masiva, se reabre su caja de hoy
      UPDATE public.cajas
      SET estado = 'abierta', fecha_cierre = NULL
      WHERE id = v_admin_caja_hoy.id;
      v_admin_reutilizada := true;
    END IF;
  ELSE
    -- Auto-cerrar caja previa del admin si quedó abierta
    SELECT * INTO v_admin_prev_caja
    FROM public.cajas
    WHERE usuario_id = v_admin_id AND estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    IF v_admin_prev_caja.id IS NOT NULL THEN
      PERFORM public._auto_close_caja(v_admin_prev_caja.id);
    END IF;

    SELECT COALESCE(saldo_final, saldo_inicial, 0)
    INTO v_last_saldo
    FROM public.cajas
    WHERE usuario_id = v_admin_id
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    v_last_saldo := COALESCE(v_last_saldo, 0);

    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura
    ) VALUES (
      v_admin_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now()
    ) RETURNING id INTO v_admin_caja_id;

    v_count := v_count + 1;
  END IF;

  -- 2. Asegurar vinculación de cajas ya abiertas de subordinados a la caja de hoy del admin
  UPDATE public.cajas c
  SET admin_caja_id = v_admin_caja_id
  WHERE c.estado = 'abierta'
    AND (c.admin_caja_id IS NULL OR c.admin_caja_id <> v_admin_caja_id)
    AND c.usuario_id IN (
      WITH RECURSIVE subordinates AS (
        SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
        UNION ALL
        SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
      )
      SELECT id FROM subordinates
    );

  -- 3. Para cada vendedor subordinado activo:
  FOR v_sub_id IN
    WITH RECURSIVE subordinates AS (
      SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
      UNION ALL
      SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
    )
    SELECT id FROM subordinates
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_sub_id::text));

    -- Verificar si el subordinado ya tiene CUALQUIER caja hoy (abierta o cerrada)
    SELECT * INTO v_sub_caja_hoy
    FROM public.cajas
    WHERE usuario_id = v_sub_id
      AND (fecha_apertura AT TIME ZONE v_tz)::date = v_hoy_local
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    IF v_sub_caja_hoy.id IS NOT NULL THEN
      -- Si ya tiene caja abierta hoy, asegurar vinculación con la caja del admin
      IF v_sub_caja_hoy.estado = 'abierta' THEN
        UPDATE public.cajas
        SET admin_caja_id = v_admin_caja_id
        WHERE id = v_sub_caja_hoy.id AND (admin_caja_id IS NULL OR admin_caja_id <> v_admin_caja_id);
      END IF;
      -- Si ya tiene caja hoy (abierta o cerrada), BAJO NINGUNA CIRCUNSTANCIA SE CREA OTRA CAJA HOY.
    ELSE
      -- No tiene caja hoy: auto-cerrar caja previa si quedó abierta
      SELECT * INTO v_sub_prev_caja
      FROM public.cajas
      WHERE usuario_id = v_sub_id AND estado = 'abierta'
      ORDER BY fecha_apertura DESC
      LIMIT 1;

      IF v_sub_prev_caja.id IS NOT NULL THEN
        PERFORM public._auto_close_caja(v_sub_prev_caja.id);
      END IF;

      -- Crear la única caja de hoy para el subordinado
      SELECT COALESCE(saldo_final, saldo_inicial, 0)
      INTO v_sub_saldo
      FROM public.cajas
      WHERE usuario_id = v_sub_id
      ORDER BY fecha_apertura DESC
      LIMIT 1;

      v_sub_saldo := COALESCE(v_sub_saldo, 0);

      SELECT dinero_max_caja INTO v_sub_max FROM public.profiles WHERE id = v_sub_id;
      IF v_sub_max IS NOT NULL AND v_sub_max > 0 AND v_sub_saldo > v_sub_max THEN
        v_sub_saldo := v_sub_max;
      END IF;

      INSERT INTO public.cajas (
        usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, admin_caja_id
      ) VALUES (
        v_sub_id, 'abierta', ROUND(v_sub_saldo, 2), ROUND(v_sub_saldo, 2), now(), v_admin_caja_id
      );

      v_count := v_count + 1;
      v_vendedores_abiertas := v_vendedores_abiertas + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'cajas_abiertas', v_count,
    'vendedores_cajas_abiertas', v_vendedores_abiertas,
    'admin_caja_reutilizada', v_admin_reutilizada,
    'admin_caja_id', v_admin_caja_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo(text) TO authenticated, service_role;

