-- =====================================================================
-- MIGRACIÓN: 20261103000003_fix_admin_abrir_cajas_masivo.sql
-- Modelo de Caja Única (1 caja abierta a la vez por usuario) con:
-- 1. Transición Just-In-Time (JIT) automática de cambio de día:
--    Cierra la caja del día anterior y abre la de hoy al primer toque.
-- 2. Apertura en cascada: Si el vendedor ingresa antes que el admin,
--    se auto-crea la caja de hoy del admin para no bloquear al vendedor.
-- 3. Zona horaria dinámica detectada desde el dispositivo del usuario.
-- 4. Protección contra concurrencia con cerrojos transaccionales (pg_advisory_xact_lock).
-- 5. Apertura masiva para administrador y reapertura estricta de 1 caja.
-- =====================================================================

-- Eliminar firmas anteriores para evitar conflictos en PostgREST
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo();
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo(text);
DROP FUNCTION IF EXISTS public.admin_get_open_cajas();
DROP FUNCTION IF EXISTS public.admin_get_open_cajas(uuid);
DROP FUNCTION IF EXISTS public.admin_get_open_cajas(uuid, text);
DROP FUNCTION IF EXISTS public.admin_get_open_cajas_count();
DROP FUNCTION IF EXISTS public.admin_get_open_cajas_count(uuid);
DROP FUNCTION IF EXISTS public.rpc_check_or_open_vendedor_caja(uuid);
DROP FUNCTION IF EXISTS public.rpc_check_or_open_vendedor_caja(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_check_or_open_caja(uuid);
DROP FUNCTION IF EXISTS public.rpc_check_or_open_caja(uuid, text);
DROP FUNCTION IF EXISTS public.admin_reabrir_caja(uuid);
DROP FUNCTION IF EXISTS public._calc_caja_saldo_actual(uuid);
DROP FUNCTION IF EXISTS public._auto_close_caja(uuid);

-- ---------------------------------------------------------------------
-- 1. FUNCIÓN INTERNA: Calcular saldo actual exacto según movimientos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._calc_caja_saldo_actual(p_caja_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ini numeric := 0;
  v_movs numeric := 0;
BEGIN
  SELECT COALESCE(saldo_inicial, 0) INTO v_ini 
  FROM public.cajas 
  WHERE id = p_caja_id;

  SELECT COALESCE(SUM(
    CASE
      WHEN m.tipo IN ('ingreso', 'pago') THEN m.monto
      WHEN m.tipo IN ('retiro', 'venta', 'renovacion', 'gasto') THEN -m.monto
      ELSE 0
    END
  ), 0) INTO v_movs
  FROM public.cash_movements m 
  WHERE m.caja_id = p_caja_id;

  RETURN ROUND(v_ini + v_movs, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public._calc_caja_saldo_actual(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. FUNCIÓN INTERNA: Auto-cierre de caja con balance recalculado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._auto_close_caja(p_caja_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_final numeric;
BEGIN
  v_final := public._calc_caja_saldo_actual(p_caja_id);

  UPDATE public.cajas
  SET estado = 'cerrada',
      fecha_cierre = now(),
      saldo_final = v_final
  WHERE id = p_caja_id AND estado = 'abierta';

  RETURN v_final;
END;
$$;

GRANT EXECUTE ON FUNCTION public._auto_close_caja(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. RPC: rpc_check_or_open_caja (Núcleo JIT de Transición de Cajas)
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
  v_user_open_caja            RECORD;
  v_caja_fecha                date;
  v_saldo_actual              numeric;
  v_previa_auto_cerrada       boolean := false;
  v_admin_id                  uuid;
  v_admin_open_caja           RECORD;
  v_admin_caja_fecha          date;
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

  -- 1. Verificar si el usuario ya tiene una caja abierta
  SELECT * INTO v_user_open_caja
  FROM public.cajas
  WHERE usuario_id = v_user_id AND estado = 'abierta'
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_user_open_caja.id IS NOT NULL THEN
    v_caja_fecha := (v_user_open_caja.fecha_apertura AT TIME ZONE v_tz)::date;

    IF v_caja_fecha = v_hoy_local THEN
      -- La caja abierta pertenece al día de hoy: actualizar saldo y retornarla
      v_saldo_actual := public._calc_caja_saldo_actual(v_user_open_caja.id);
      UPDATE public.cajas
      SET saldo_final = v_saldo_actual
      WHERE id = v_user_open_caja.id;

      SELECT * INTO v_user_open_caja FROM public.cajas WHERE id = v_user_open_caja.id;

      RETURN json_build_object(
        'success', true,
        'caja', row_to_json(v_user_open_caja),
        'accion', 'mantiene_hoy',
        'ya_abierta', true,
        'auto_cerrada_previa', false
      );
    ELSE
      -- La caja abierta pertenece a un día previo: auto-cerrarla JIT
      PERFORM public._auto_close_caja(v_user_open_caja.id);
      v_previa_auto_cerrada := true;
    END IF;
  END IF;

  -- 2. El usuario no tiene caja abierta para hoy. Se procede a crearla.
  -- Si es vendedor (o tiene superior), resolver en cascada la caja del Administrador:
  v_admin_id := v_profile.superior_id;

  IF v_admin_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_admin_id::text));

    SELECT * INTO v_admin_open_caja
    FROM public.cajas
    WHERE usuario_id = v_admin_id AND estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    IF v_admin_open_caja.id IS NOT NULL THEN
      v_admin_caja_fecha := (v_admin_open_caja.fecha_apertura AT TIME ZONE v_tz)::date;

      IF v_admin_caja_fecha = v_hoy_local THEN
        -- El admin ya tiene caja abierta para hoy
        v_admin_caja_id := v_admin_open_caja.id;
      ELSE
        -- La caja del admin es de un día previo: auto-cerrarla
        PERFORM public._auto_close_caja(v_admin_open_caja.id);
        v_admin_open_caja := NULL;
      END IF;
    END IF;

    -- Si el admin no tiene caja abierta para hoy, auto-crearla en cascada
    IF v_admin_open_caja IS NULL THEN
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

  -- 3. Crear la nueva caja del usuario para el día de hoy
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
-- 4. RPC COMPATIBILIDAD: rpc_check_or_open_vendedor_caja
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_check_or_open_vendedor_caja(
  p_vendedor_id uuid,
  p_timezone text DEFAULT 'America/Bogota'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.rpc_check_or_open_caja(p_vendedor_id, p_timezone);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_vendedor_caja(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. RPC: admin_abrir_cajas_masivo (Manual Admin Trigger con 1 Caja)
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
  v_admin_open_caja           RECORD;
  v_admin_caja_fecha          date;
  v_admin_caja_id             uuid := NULL;
  v_admin_reutilizada         boolean := false;
  v_last_saldo                numeric := 0;
  v_count                     integer := 0;
  v_vendedores_abiertas       integer := 0;
  v_sub_id                    uuid;
  v_sub_open_caja             RECORD;
  v_sub_caja_fecha            date;
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
  SELECT * INTO v_admin_open_caja
  FROM public.cajas
  WHERE usuario_id = v_admin_id AND estado = 'abierta'
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_admin_open_caja.id IS NOT NULL THEN
    v_admin_caja_fecha := (v_admin_open_caja.fecha_apertura AT TIME ZONE v_tz)::date;

    IF v_admin_caja_fecha = v_hoy_local THEN
      v_admin_caja_id := v_admin_open_caja.id;
      v_admin_reutilizada := true;
    ELSE
      -- Caja anterior abierta: cerrarla
      PERFORM public._auto_close_caja(v_admin_open_caja.id);
      v_admin_open_caja := NULL;
    END IF;
  END IF;

  IF v_admin_caja_id IS NULL THEN
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

  -- 3. Para cada vendedor subordinado activo: auto-cierre anterior y apertura de hoy si no tiene
  FOR v_sub_id IN
    WITH RECURSIVE subordinates AS (
      SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
      UNION ALL
      SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
    )
    SELECT id FROM subordinates
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_sub_id::text));

    SELECT * INTO v_sub_open_caja
    FROM public.cajas
    WHERE usuario_id = v_sub_id AND estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    IF v_sub_open_caja.id IS NOT NULL THEN
      v_sub_caja_fecha := (v_sub_open_caja.fecha_apertura AT TIME ZONE v_tz)::date;

      IF v_sub_caja_fecha < v_hoy_local THEN
        -- Caja de un día previo: cerrarla
        PERFORM public._auto_close_caja(v_sub_open_caja.id);
        v_sub_open_caja := NULL;
      ELSE
        -- Ya tiene caja hoy: asegurar admin_caja_id
        UPDATE public.cajas
        SET admin_caja_id = v_admin_caja_id
        WHERE id = v_sub_open_caja.id AND (admin_caja_id IS NULL OR admin_caja_id <> v_admin_caja_id);
      END IF;
    END IF;

    -- Si quedó sin caja abierta para hoy, crearla
    IF v_sub_open_caja IS NULL THEN
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

-- ---------------------------------------------------------------------
-- 6. RPC: admin_reabrir_caja (Regla estricta: 1 sola caja abierta a la vez)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reabrir_caja(
  p_caja_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caja          record;
  v_otra_caja     record;
  v_user_rol      text;
  v_superior_id   uuid;
  v_padre_id      uuid;
  v_padre_abierto boolean := false;
  v_fecha_txt     text;
  v_saldo_actual  numeric := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo los administradores pueden reabrir cajas.';
  END IF;

  SELECT id, usuario_id, estado, saldo_inicial, fecha_apertura
  INTO v_caja
  FROM public.cajas
  WHERE id = p_caja_id;

  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NO_ENCONTRADA: La caja especificada no existe.';
  END IF;

  IF NOT public.is_same_hierarchy(v_caja.usuario_id) AND v_caja.usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: La caja no pertenece a un usuario de tu equipo.';
  END IF;

  IF v_caja.estado = 'abierta' THEN
    RAISE EXCEPTION 'CAJA_YA_ABIERTA: Esta caja ya se encuentra abierta.';
  END IF;

  -- Regla de jerarquía: si es caja de vendedor, la caja del admin debe estar abierta
  SELECT rol, superior_id INTO v_user_rol, v_superior_id
  FROM public.profiles
  WHERE id = v_caja.usuario_id;

  IF v_user_rol = 'vendedor' OR (v_caja.usuario_id <> auth.uid()) THEN
    v_padre_id := COALESCE(v_superior_id, auth.uid());
    SELECT EXISTS(
      SELECT 1 FROM public.cajas
      WHERE usuario_id = v_padre_id AND estado = 'abierta'
    ) INTO v_padre_abierto;

    IF NOT v_padre_abierto THEN
      RAISE EXCEPTION 'CAJA_PADRE_CERRADA: No se puede reabrir la caja del vendedor porque la caja padre del administrador se encuentra cerrada. Debes abrir primero la caja del administrador.';
    END IF;
  END IF;

  -- Regla de negocio estricta: NO SE PERMITE TENER OTRA CAJA ABIERTA A LA VEZ
  SELECT id, fecha_apertura INTO v_otra_caja
  FROM public.cajas
  WHERE usuario_id = v_caja.usuario_id
    AND estado = 'abierta'
    AND id <> p_caja_id
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_otra_caja.id IS NOT NULL THEN
    v_fecha_txt := to_char(v_otra_caja.fecha_apertura AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH12:MI AM');
    RAISE EXCEPTION 'El usuario ya tiene otra caja abierta actualmente (Fecha: %). Solo se permite tener 1 caja abierta a la vez. Debe cerrar la caja activa antes de poder reabrir esta caja.', v_fecha_txt;
  END IF;

  -- Recalcular saldo exacto de movimientos para integridad financiera
  v_saldo_actual := public._calc_caja_saldo_actual(p_caja_id);

  UPDATE public.cajas
  SET estado = 'abierta',
      fecha_cierre = NULL,
      saldo_final = v_saldo_actual
  WHERE id = p_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'usuario_id', v_caja.usuario_id,
    'estado', 'abierta',
    'saldo_actual', v_saldo_actual,
    'fecha_apertura', v_caja.fecha_apertura
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. RPC: admin_get_open_cajas (Consulta de caja abierta del Admin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_open_cajas(
  p_admin_id uuid DEFAULT auth.uid(),
  p_timezone text DEFAULT 'America/Bogota'
)
RETURNS TABLE (
  id uuid,
  usuario_id uuid,
  fecha_apertura timestamptz,
  saldo_inicial numeric,
  saldo_final numeric,
  estado text,
  fecha_formateada text,
  fecha_corta text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := COALESCE(NULLIF(TRIM(p_timezone), ''), 'America/Bogota');
  RETURN QUERY
  SELECT 
    c.id,
    c.usuario_id,
    c.fecha_apertura,
    c.saldo_inicial,
    c.saldo_final,
    c.estado,
    to_char(c.fecha_apertura AT TIME ZONE v_tz, 'DD/MM/YYYY HH12:MI AM') AS fecha_formateada,
    to_char(c.fecha_apertura AT TIME ZONE v_tz, 'YYYY-MM-DD') AS fecha_corta
  FROM public.cajas c
  WHERE c.usuario_id = COALESCE(p_admin_id, auth.uid())
    AND c.estado = 'abierta'
  ORDER BY c.fecha_apertura DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_open_cajas(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. RPC: admin_get_open_cajas_count (Conteo de cajas abiertas: 0 o 1)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_open_cajas_count(
  p_admin_id uuid DEFAULT auth.uid()
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer
  FROM public.cajas
  WHERE usuario_id = COALESCE(p_admin_id, auth.uid())
    AND estado = 'abierta';
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_open_cajas_count(uuid) TO authenticated, service_role;
