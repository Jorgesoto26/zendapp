-- =====================================================================
-- MIGRACIÓN: 20261105000001_admin_hierarchical_navigation.sql
-- Navegación jerárquica multinivel para módulos Admin:
-- 1. admin_get_subordinates(p_parent_id)
-- 2. admin_get_cartera_summary(p_parent_id)
-- 3. admin_get_cajas(p_fecha_ini, p_fecha_fin, p_parent_id)
-- 4. admin_create_user(..., p_superior_id)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Función auxiliar para validar descendencia jerárquica
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_descendant_of(p_child_id uuid, p_ancestor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_found boolean;
BEGIN
  IF p_child_id IS NULL OR p_ancestor_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_child_id = p_ancestor_id THEN
    RETURN true;
  END IF;

  WITH RECURSIVE descendants AS (
    SELECT id FROM public.profiles WHERE superior_id = p_ancestor_id
    UNION ALL
    SELECT p.id FROM public.profiles p JOIN descendants d ON p.superior_id = d.id
  )
  SELECT EXISTS(SELECT 1 FROM descendants WHERE id = p_child_id) INTO v_found;

  RETURN COALESCE(v_found, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public._is_descendant_of(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. ACTUALIZAR admin_get_subordinates
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_subordinates();
DROP FUNCTION IF EXISTS public.admin_get_subordinates(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_subordinates(
  p_parent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  nombre text,
  apellido text,
  email text,
  rol text,
  superior_id uuid,
  activo boolean,
  dinero_max_caja numeric,
  dinero_max_venta numeric,
  dinero_max_gasto numeric,
  max_cuotas integer,
  permite_borrar_venta boolean,
  permite_modificar_pagos boolean,
  tiene_subordinados boolean,
  cantidad_subordinados integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden ver subordinados';
  END IF;

  v_target_id := COALESCE(p_parent_id, auth.uid());

  -- Validar que v_target_id sea auth.uid() o un descendiente de auth.uid()
  IF v_target_id <> auth.uid() AND NOT public._is_descendant_of(v_target_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para consultar este nivel jerárquico';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid,
    COALESCE(p.nombre, '')::text,
    COALESCE(p.apellido, '')::text,
    COALESCE(au.email, '')::text AS email,
    COALESCE(p.rol, 'vendedor')::text,
    p.superior_id::uuid,
    COALESCE(p.activo, true)::boolean,
    COALESCE(p.dinero_max_caja, 0)::numeric,
    COALESCE(p.dinero_max_venta, 0)::numeric,
    COALESCE(p.dinero_max_gasto, 0)::numeric,
    COALESCE(p.max_cuotas, 30)::integer,
    COALESCE(p.permite_borrar_venta, false)::boolean,
    COALESCE(p.permite_modificar_pagos, false)::boolean,
    (EXISTS(SELECT 1 FROM public.profiles sub WHERE sub.superior_id = p.id))::boolean AS tiene_subordinados,
    (SELECT COUNT(*)::integer FROM public.profiles sub WHERE sub.superior_id = p.id) AS cantidad_subordinados
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.superior_id = v_target_id
  ORDER BY
    (p.rol = 'admin') DESC,
    p.nombre ASC,
    p.apellido ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_subordinates(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. ACTUALIZAR admin_get_cartera_summary
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_cartera_summary();
DROP FUNCTION IF EXISTS public.admin_get_cartera_summary(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_cartera_summary(
  p_parent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  usuario_id uuid,
  nombre text,
  apellido text,
  rol text,
  activo boolean,
  total_creditos bigint,
  clientes_con_saldo bigint,
  valor_cuota_periodica numeric,
  saldo_vencido numeric,
  valor_total_cartera numeric,
  saldo_total numeric,
  tiene_subordinados boolean,
  cantidad_subordinados integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden ver cartera';
  END IF;

  v_target_id := COALESCE(p_parent_id, auth.uid());

  IF v_target_id <> auth.uid() AND NOT public._is_descendant_of(v_target_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para consultar este nivel jerárquico';
  END IF;

  RETURN QUERY
  WITH direct_subordinates AS (
    SELECT p.id, p.nombre, p.apellido, p.rol, p.activo
    FROM public.profiles p
    WHERE p.superior_id = v_target_id
       OR (v_target_id = auth.uid() AND p.id = auth.uid() AND EXISTS(SELECT 1 FROM public.invoice inv WHERE inv.usuario_id = auth.uid()))
  ),
  vencidas AS (
    SELECT i.usuario_id,
           COALESCE(SUM(c.monto - COALESCE(c.monto_pagado, 0)), 0) AS saldo_venc
    FROM public.cuotas c
    JOIN public.invoice i ON i.id = c.invoice_id
    WHERE c.estado IN ('pendiente', 'parcial')
      AND c.fecha_vencimiento < CURRENT_DATE
      AND i.usuario_id IN (SELECT id FROM direct_subordinates)
      AND i.castigado = false
    GROUP BY i.usuario_id
  )
  SELECT
    p.id AS usuario_id,
    COALESCE(p.nombre, '')::text AS nombre,
    COALESCE(p.apellido, '')::text AS apellido,
    COALESCE(p.rol, 'vendedor')::text AS rol,
    COALESCE(p.activo, true)::boolean AS activo,
    COUNT(DISTINCT i.id)::bigint AS total_creditos,
    COUNT(DISTINCT CASE WHEN i.saldo > 0 THEN i.id END)::bigint AS clientes_con_saldo,
    COALESCE(SUM(CASE WHEN i.saldo > 0 THEN
      COALESCE((SELECT c2.monto FROM public.cuotas c2 WHERE c2.invoice_id = i.id AND c2.estado IN ('pendiente','parcial') ORDER BY c2.numero LIMIT 1), 0)
    ELSE 0 END), 0)::numeric AS valor_cuota_periodica,
    COALESCE(v.saldo_venc, 0)::numeric AS saldo_vencido,
    COALESCE(SUM(i.amount), 0)::numeric AS valor_total_cartera,
    COALESCE(SUM(i.saldo), 0)::numeric AS saldo_total,
    (EXISTS(SELECT 1 FROM public.profiles sub WHERE sub.superior_id = p.id))::boolean AS tiene_subordinados,
    (SELECT COUNT(*)::integer FROM public.profiles sub WHERE sub.superior_id = p.id) AS cantidad_subordinados
  FROM direct_subordinates p
  LEFT JOIN public.invoice i ON i.usuario_id = p.id AND i.castigado = false
  LEFT JOIN vencidas v ON v.usuario_id = p.id
  GROUP BY p.id, p.nombre, p.apellido, p.rol, p.activo, v.saldo_venc
  ORDER BY (p.rol = 'admin') DESC, p.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_cartera_summary(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. ACTUALIZAR admin_get_cajas
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_cajas(date, date);
DROP FUNCTION IF EXISTS public.admin_get_cajas(date, date, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_cajas(
  p_fecha_ini date DEFAULT NULL,
  p_fecha_fin date DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  caja_id uuid,
  usuario_id uuid,
  nombre_usuario text,
  rol_usuario text,
  estado text,
  fecha_apertura timestamptz,
  fecha_cierre timestamptz,
  saldo_inicial numeric,
  saldo_final numeric,
  valor_debido_cobrar numeric,
  valor_recaudado numeric,
  valor_ventas numeric,
  valor_gastos numeric,
  valor_ingresos numeric,
  valor_retiros numeric,
  total_clientes bigint,
  cantidad_nopagos bigint,
  progreso_visitas numeric,
  total_movimientos bigint,
  tiene_subordinados boolean,
  cantidad_subordinados integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden consultar cajas.';
  END IF;

  v_target_id := COALESCE(p_parent_id, auth.uid());

  IF v_target_id <> auth.uid() AND NOT public._is_descendant_of(v_target_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para consultar este nivel jerárquico.';
  END IF;

  RETURN QUERY
  WITH direct_users AS (
    SELECT p.id FROM public.profiles p WHERE p.superior_id = v_target_id
    UNION
    SELECT v_target_id AS id
  )
  SELECT
    c.id::uuid AS caja_id,
    c.usuario_id::uuid,
    COALESCE(p.nombre, '')::text AS nombre_usuario,
    COALESCE(p.rol, '')::text AS rol_usuario,
    COALESCE(c.estado, '')::text,
    c.fecha_apertura::timestamptz,
    c.fecha_cierre::timestamptz,
    COALESCE(c.saldo_inicial, 0)::numeric,
    -- Saldo final dinámico en tiempo real para cajas abiertas
    CASE
      WHEN c.estado = 'abierta' THEN
        (COALESCE(c.saldo_inicial, 0) + COALESCE((
          SELECT SUM(
            CASE
              WHEN m.tipo IN ('ingreso', 'pago') THEN m.monto
              WHEN m.tipo IN ('retiro', 'venta', 'renovacion', 'gasto') THEN -m.monto
              ELSE 0
            END
          ) FROM public.cash_movements m WHERE m.caja_id = c.id
        ), 0))::numeric
      ELSE
        COALESCE(c.saldo_final, c.saldo_inicial, 0)::numeric
    END AS saldo_final,
    COALESCE((
      SELECT SUM(cu.monto) FROM public.cuotas cu
      JOIN public.invoice inv ON inv.id = cu.invoice_id
      WHERE inv.usuario_id = c.usuario_id AND cu.estado IN ('pendiente','parcial')
        AND inv.saldo > 0 AND inv.castigado = false
    ), 0)::numeric AS valor_debido_cobrar,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'pago'), 0)::numeric AS valor_recaudado,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo IN ('venta', 'renovacion')), 0)::numeric AS valor_ventas,
    -- Reconocer gastos tanto por m.tipo = 'gasto' como por m.tipo = 'retiro' con descripción gasto
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND (m.tipo = 'gasto' OR (m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'))), 0)::numeric AS valor_gastos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'ingreso'), 0)::numeric AS valor_ingresos,
    -- Retiros puros (sin incluir gastos)
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro' AND (m.descripcion IS NULL OR m.descripcion NOT ILIKE '%gasto%')), 0)::numeric AS valor_retiros,
    (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)::bigint AS total_clientes,
    COALESCE((SELECT COUNT(*) FROM public.payments pay
      JOIN public.invoice inv ON inv.id = pay.invoice_id
      WHERE inv.usuario_id = c.usuario_id AND pay.method = 'nopago'
        AND pay.payment_date = (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date), 0)::bigint AS cantidad_nopagos,
    CASE WHEN (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false) > 0
    THEN ROUND(
      (SELECT COUNT(DISTINCT pay.invoice_id)::numeric FROM public.payments pay
       JOIN public.invoice inv ON inv.id = pay.invoice_id
       WHERE inv.usuario_id = c.usuario_id AND pay.payment_date = (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date) * 100.0 /
      (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)
    , 1)::numeric
    ELSE 0::numeric END AS progreso_visitas,
    -- Total de movimientos de caja registrados
    COALESCE((SELECT COUNT(*) FROM public.cash_movements m WHERE m.caja_id = c.id), 0)::bigint AS total_movimientos,
    (EXISTS(SELECT 1 FROM public.profiles sub WHERE sub.superior_id = c.usuario_id))::boolean AS tiene_subordinados,
    (SELECT COUNT(*)::integer FROM public.profiles sub WHERE sub.superior_id = c.usuario_id) AS cantidad_subordinados
  FROM public.cajas c
  JOIN public.profiles p ON p.id = c.usuario_id
  WHERE c.usuario_id IN (SELECT id FROM direct_users)
    AND (p_fecha_ini IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date >= p_fecha_ini)
    AND (p_fecha_fin IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date <= p_fecha_fin)
  ORDER BY
    CASE WHEN c.usuario_id = v_target_id THEN 0 ELSE 1 END,
    c.estado ASC,
    c.fecha_apertura DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. ACTUALIZAR admin_create_user (Permitir p_superior_id opcional)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric);
DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric, uuid);

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_nombre text,
  p_apellido text DEFAULT '',
  p_rol text DEFAULT 'vendedor',
  p_dinero_max_caja numeric DEFAULT 0,
  p_dinero_max_venta numeric DEFAULT 0,
  p_dinero_max_gasto numeric DEFAULT 0,
  p_max_cuotas integer DEFAULT 30,
  p_permite_borrar_venta boolean DEFAULT false,
  p_permite_modificar_pagos boolean DEFAULT false,
  p_saldo_inicial numeric DEFAULT 0,
  p_superior_id uuid DEFAULT NULL
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
  v_target_superior_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden crear usuarios';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS: ya existe un usuario con este correo';
  END IF;

  v_target_superior_id := COALESCE(p_superior_id, auth.uid());

  IF v_target_superior_id <> auth.uid() AND NOT public._is_descendant_of(v_target_superior_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para asignar este superior jerárquico';
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

  -- Insertar o actualizar en public.profiles
  INSERT INTO public.profiles (
    id, nombre, apellido, rol, superior_id, activo, dinero_max_caja, dinero_max_venta,
    dinero_max_gasto, max_cuotas, permite_borrar_venta, permite_modificar_pagos,
    organizacion_id, updated_at, update_at
  ) VALUES (
    v_new_id, p_nombre, COALESCE(p_apellido, ''), COALESCE(p_rol, 'vendedor'), v_target_superior_id, true,
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
    organizacion_id = EXCLUDED.organizacion_id,
    updated_at = v_now,
    update_at = v_now;

  -- Crear caja inicial si es vendedor
  IF COALESCE(p_rol, 'vendedor') = 'vendedor' THEN
    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura
    ) VALUES (
      v_new_id, 'abierta', COALESCE(p_saldo_inicial, 0), COALESCE(p_saldo_inicial, 0), v_now
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'user_id', v_new_id,
    'email', p_email,
    'rol', COALESCE(p_rol, 'vendedor'),
    'superior_id', v_target_superior_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. ACTUALIZAR admin_abrir_cajas_masivo (Permitir p_admin_id opcional)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo();
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo(text);
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo(text, uuid);

CREATE OR REPLACE FUNCTION public.admin_abrir_cajas_masivo(
  p_timezone text DEFAULT 'America/Bogota',
  p_admin_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id                  uuid;
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

  v_admin_id := COALESCE(p_admin_id, auth.uid());

  IF v_admin_id <> auth.uid() AND NOT public._is_descendant_of(v_admin_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para gestionar cajas de este nivel jerárquico.';
  END IF;

  v_tz := COALESCE(NULLIF(TRIM(p_timezone), ''), 'America/Bogota');
  BEGIN
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Bogota';
    v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;
  END;

  PERFORM pg_advisory_xact_lock(hashtext('caja_lock_' || v_admin_id::text));

  -- 1. Resolver caja del Administrador en foco
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

GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo(text, uuid) TO authenticated, service_role;
