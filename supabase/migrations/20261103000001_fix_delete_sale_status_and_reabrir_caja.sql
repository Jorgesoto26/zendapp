-- =====================================================================
-- MIGRACIÓN: 20261103000001_fix_delete_sale_status_and_reabrir_caja.sql
-- Correcciones integrales:
-- 1. rpc_delete_sale / rpc_cancel_sale: usar status = 'cancelada' (evita violar invoice_status_check).
-- 2. admin_reabrir_caja: recalcular saldo a partir de movimientos en lugar de borrar a NULL.
-- 3. admin_get_cajas: cálculo dinámico del saldo actual para cajas abiertas (evita mostrar $0).
-- 4. admin_create_user: soporte para p_saldo_inicial de caja al crear vendedores.
-- 5. admin_update_user: actualización de contraseña con cost 10 compatible con GoTrue.
-- =====================================================================

-- 1. CORRECCIÓN EN rpc_delete_sale: STATUS 'cancelada'
CREATE OR REPLACE FUNCTION public.rpc_delete_sale(
  p_invoice_id uuid,
  p_motivo     text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_status            text;
  v_usuario_id        uuid;
  v_capital           numeric;
  v_caja_id           uuid;
  v_caja_estado       text;
  v_pagos_count       integer;
  v_mov_id            uuid;
  v_profile           RECORD;
BEGIN
  -- 1. Validar permisos del usuario
  SELECT activo, permite_borrar_venta, rol INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF v_profile.activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  IF NOT COALESCE(v_profile.permite_borrar_venta, false) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISO_DENEGADO: No tienes autorización para eliminar o anular ventas';
  END IF;

  -- 2. Bloquear factura
  SELECT status, usuario_id, capital_amount
  INTO v_status, v_usuario_id, v_capital
  FROM public.invoice
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'FACTURA_NOT_FOUND: factura % no existe', p_invoice_id;
  END IF;

  IF v_status = 'cancel' OR v_status = 'cancelada' THEN
    RAISE EXCEPTION 'FACTURA_YA_CANCELADA: la factura ya fue cancelada';
  END IF;

  -- 3. Regla estricta: verificar que no tenga ningún abono o pago
  SELECT COUNT(*) INTO v_pagos_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id AND amount > 0;

  IF v_pagos_count > 0 THEN
    RAISE EXCEPTION 'NO_SE_PUEDE_CANCELAR: Esta venta ya tiene pagos o abonos registrados. No puede ser anulada.';
  END IF;

  -- 4. Obtener el movimiento de venta original y su caja
  SELECT id, caja_id, monto INTO v_mov_id, v_caja_id, v_capital
  FROM public.cash_movements
  WHERE tipo IN ('venta', 'renovacion')
    AND descripcion LIKE '%' || p_invoice_id::text || '%'
  ORDER BY fecha DESC
  LIMIT 1;

  -- 5. Marcar factura y cuotas como canceladas (valor legal 'cancelada')
  UPDATE public.invoice
  SET status = 'cancelada', saldo = 0
  WHERE id = p_invoice_id;

  UPDATE public.cuotas
  SET estado = 'cancelada'
  WHERE invoice_id = p_invoice_id;

  -- 6. Revertir el dinero a la caja si existe
  IF v_caja_id IS NOT NULL THEN
    SELECT estado INTO v_caja_estado FROM public.cajas WHERE id = v_caja_id;
    IF v_caja_estado = 'abierta' THEN
      UPDATE public.cajas
      SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + COALESCE(v_capital, 0)
      WHERE id = v_caja_id;

      INSERT INTO public.cash_movements (caja_id, tipo, descripcion, monto, fecha)
      VALUES (
        v_caja_id,
        'ingreso',
        'Reversión anulación venta #' || substring(p_invoice_id::text from 1 for 8) || COALESCE(' - ' || NULLIF(p_motivo, ''), ''),
        COALESCE(v_capital, 0),
        NOW()
      );
    END IF;
  END IF;

  -- 7. Eliminar movimiento de venta original
  IF v_mov_id IS NOT NULL THEN
    DELETE FROM public.cash_movements WHERE id = v_mov_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id_factura', p_invoice_id,
    'monto_revertido', COALESCE(v_capital, 0)
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_sale(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_cancel_sale(
  p_invoice_id uuid,
  p_motivo     text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.rpc_delete_sale(p_invoice_id, p_motivo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_cancel_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_sale(uuid, text) TO service_role;


-- 2. CORRECCIÓN EN admin_reabrir_caja: PRESERVAR Y RECALCULAR SALDO REAL
CREATE OR REPLACE FUNCTION public.admin_reabrir_caja(
  p_caja_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_caja          record;
  v_otra_caja     record;
  v_user_rol      text;
  v_superior_id   uuid;
  v_padre_id      uuid;
  v_padre_abierto boolean := false;
  v_fecha_txt     text;
  v_mov_total     numeric := 0;
  v_saldo_actual  numeric := 0;
BEGIN
  -- Validar que quien invoca sea administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo los administradores pueden reabrir cajas';
  END IF;

  -- Obtener datos de la caja
  SELECT id, usuario_id, estado, saldo_inicial, fecha_apertura
  INTO v_caja
  FROM public.cajas
  WHERE id = p_caja_id;

  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NO_ENCONTRADA: La caja especificada no existe';
  END IF;

  -- Validar jerarquía: la caja debe pertenecer a su equipo
  IF NOT public.is_same_hierarchy(v_caja.usuario_id) AND v_caja.usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: La caja no pertenece a un usuario de tu equipo';
  END IF;

  -- Verificar que la caja esté cerrada
  IF v_caja.estado = 'abierta' THEN
    RAISE EXCEPTION 'CAJA_YA_ABIERTA: Esta caja ya se encuentra abierta';
  END IF;

  -- Validar si la caja pertenece a un vendedor: la caja padre (del administrador) DEBE estar ABIERTA
  SELECT rol, superior_id INTO v_user_rol, v_superior_id
  FROM public.profiles
  WHERE id = v_caja.usuario_id;

  IF v_user_rol = 'vendedor' OR (v_caja.usuario_id <> auth.uid()) THEN
    v_padre_id := COALESCE(v_superior_id, auth.uid());
    SELECT EXISTS(
      SELECT 1 FROM public.cajas
      WHERE usuario_id = v_padre_id
        AND estado = 'abierta'
    ) INTO v_padre_abierto;

    IF NOT v_padre_abierto THEN
      RAISE EXCEPTION 'CAJA_PADRE_CERRADA: No se puede reabrir la caja del vendedor porque la caja padre del administrador se encuentra cerrada. Debes abrir primero la caja del administrador.';
    END IF;
  END IF;

  -- Verificar si el usuario ya tiene OTRA caja abierta actualmente
  SELECT id, fecha_apertura INTO v_otra_caja
  FROM public.cajas
  WHERE usuario_id = v_caja.usuario_id
    AND estado = 'abierta'
    AND id <> p_caja_id
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_otra_caja.id IS NOT NULL THEN
    v_fecha_txt := to_char(v_otra_caja.fecha_apertura AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH12:MI AM');
    RAISE EXCEPTION 'El usuario ya tiene otra caja abierta actualmente con fecha de apertura: %. Debe cerrarla antes de poder reabrir esta caja.', v_fecha_txt;
  END IF;

  -- Calcular total de movimientos para preservar el saldo real acumulado
  SELECT COALESCE(SUM(
    CASE
      WHEN m.tipo IN ('ingreso', 'pago') THEN m.monto
      WHEN m.tipo IN ('retiro', 'venta', 'renovacion', 'gasto') THEN -m.monto
      ELSE 0
    END
  ), 0) INTO v_mov_total
  FROM public.cash_movements m WHERE m.caja_id = p_caja_id;

  v_saldo_actual := COALESCE(v_caja.saldo_inicial, 0) + v_mov_total;

  -- Reabrir la caja sin blanquear a NULL
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
$func$;

GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO service_role;


-- 3. CORRECCIÓN EN admin_get_cajas: CÁLCULO DINÁMICO DE SALDO ACTUAL PARA CAJAS ABIERTAS
CREATE OR REPLACE FUNCTION public.admin_get_cajas(
  p_fecha_ini date DEFAULT NULL,
  p_fecha_fin date DEFAULT NULL
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
  progreso_visitas numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  WITH RECURSIVE subordinates AS (
    SELECT p.id FROM public.profiles p WHERE p.superior_id = auth.uid()
    UNION ALL
    SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id
  ),
  all_users AS (
    SELECT id FROM subordinates UNION SELECT auth.uid()
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
    -- Si la caja está abierta, calcular saldo actual en tiempo real a partir de movimientos
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
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'venta'), 0)::numeric AS valor_ventas,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'), 0)::numeric AS valor_gastos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'ingreso'), 0)::numeric AS valor_ingresos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro'), 0)::numeric AS valor_retiros,
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
    ELSE 0::numeric END AS progreso_visitas
  FROM public.cajas c
  JOIN public.profiles p ON p.id = c.usuario_id
  WHERE c.usuario_id IN (SELECT id FROM all_users)
    AND (p_fecha_ini IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date >= p_fecha_ini)
    AND (p_fecha_fin IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date <= p_fecha_fin)
  ORDER BY
    CASE WHEN c.usuario_id = auth.uid() THEN 0 ELSE 1 END,
    c.estado ASC,
    c.fecha_apertura DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date) TO service_role;


-- 4. CORRECCIÓN EN admin_create_user: SOPORTE PARA SALDO INICIAL DE CAJA
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
  p_saldo_inicial numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
  v_encrypted_pw text;
  v_now timestamptz;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden crear usuarios';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS: ya existe un usuario con este correo';
  END IF;

  v_new_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_password), gen_salt('bf', 10));
  v_now := now();

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

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_new_id::text, v_new_id,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false)::jsonb,
    'email', v_now, v_now, v_now
  );

  INSERT INTO public.profiles (
    id, nombre, apellido, rol, superior_id, activo, dinero_max_caja, dinero_max_venta,
    dinero_max_gasto, max_cuotas, permite_borrar_venta, permite_modificar_pagos, updated_at
  ) VALUES (
    v_new_id, p_nombre, COALESCE(p_apellido, ''), COALESCE(p_rol, 'vendedor'), auth.uid(), true,
    COALESCE(p_dinero_max_caja, 0), COALESCE(p_dinero_max_venta, 0), COALESCE(p_dinero_max_gasto, 0),
    COALESCE(p_max_cuotas, 30), COALESCE(p_permite_borrar_venta, false), COALESCE(p_permite_modificar_pagos, false), v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido, rol = EXCLUDED.rol,
    superior_id = EXCLUDED.superior_id, activo = true, dinero_max_caja = EXCLUDED.dinero_max_caja,
    dinero_max_venta = EXCLUDED.dinero_max_venta, dinero_max_gasto = EXCLUDED.dinero_max_gasto,
    max_cuotas = EXCLUDED.max_cuotas, permite_borrar_venta = EXCLUDED.permite_borrar_venta,
    permite_modificar_pagos = EXCLUDED.permite_modificar_pagos, updated_at = v_now;

  -- Crear caja inicial cerrada con la base establecida si es vendedor
  IF COALESCE(p_rol, 'vendedor') = 'vendedor' THEN
    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre, fecha
    ) VALUES (
      v_new_id, 'cerrada', COALESCE(p_saldo_inicial, 0), COALESCE(p_saldo_inicial, 0), v_now, v_now, v_now::date::text
    );
  END IF;

  RETURN json_build_object('success', true, 'user_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric) TO service_role;


-- 5. CORRECCIÓN EN admin_update_user: COMPATIBILIDAD CON ENCRIPTACIÓN GoTrue (cost 10)
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id                 uuid,
  p_nombre                  text,
  p_apellido                text,
  p_dinero_max_caja         numeric DEFAULT NULL,
  p_dinero_max_venta        numeric DEFAULT NULL,
  p_dinero_max_gasto        numeric DEFAULT NULL,
  p_max_cuotas              integer DEFAULT NULL,
  p_permite_borrar_venta    boolean DEFAULT NULL,
  p_permite_modificar_pagos boolean DEFAULT NULL,
  p_password                text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden editar usuarios';
  END IF;

  IF NOT public.is_same_hierarchy(p_user_id) AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no pertenece a tu jerarquía';
  END IF;

  UPDATE public.profiles
  SET
    nombre                  = p_nombre,
    apellido                = p_apellido,
    dinero_max_caja         = COALESCE(p_dinero_max_caja, dinero_max_caja),
    dinero_max_venta        = COALESCE(p_dinero_max_venta, dinero_max_venta),
    dinero_max_gasto        = COALESCE(p_dinero_max_gasto, dinero_max_gasto),
    max_cuotas              = COALESCE(p_max_cuotas, max_cuotas),
    permite_borrar_venta    = COALESCE(p_permite_borrar_venta, permite_borrar_venta),
    permite_modificar_pagos = COALESCE(p_permite_modificar_pagos, permite_modificar_pagos),
    updated_at              = now()
  WHERE id = p_user_id;

  -- Actualizar contraseña en auth.users con salt cost 10 para coincidir con el validador nativo de GoTrue
  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO service_role;



-- =====================================================================
-- 6. CORRECCIÓN EN create_payment: GARANTIZAR AMORTIZACIÓN COMPLETA Y TOLERANCIA
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_payment(
  p_invoice_id   uuid,
  p_client_id    uuid,
  p_amount       numeric,
  p_payment_date date,
  p_method       text,
  p_caja_id      uuid,
  p_client_uuid  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_saldo           numeric;
  v_status          text;
  v_usuario_id      uuid;
  v_caja_estado     text;
  v_caja_usuario_id uuid;
  v_mov_id          uuid;
  v_pay_id          uuid;
  v_nuevo_saldo     numeric;
  v_monto_restante  numeric;
  v_saldo_cuota     numeric;
  r_cuota           RECORD;
BEGIN
  -- Validar que el usuario que ejecuta la operacion no este inhabilitado
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND activo IS FALSE) THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- Idempotencia por client_uuid
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_pay_id
    FROM public.payments
    WHERE client_uuid = p_client_uuid
    LIMIT 1;

    IF v_pay_id IS NOT NULL THEN
      RETURN v_pay_id;
    END IF;
  END IF;

  -- Idempotencia de ventana de 5 minutos (fallback si client_uuid es nulo)
  IF p_client_uuid IS NULL THEN
    SELECT id INTO v_pay_id
    FROM public.payments
    WHERE invoice_id = p_invoice_id
      AND amount = ROUND(p_amount, 2)
      AND method = p_method
      AND payment_date = p_payment_date
      AND created_at >= (now() - interval '5 minutes')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_pay_id IS NOT NULL THEN
      RETURN v_pay_id;
    END IF;
  END IF;

  -- Validacion de monto no negativo
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor o igual a 0';
  END IF;

  -- Factura con bloqueo FOR UPDATE
  SELECT saldo, status, usuario_id
  INTO v_saldo, v_status, v_usuario_id
  FROM public.invoice
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'FACTURA_NOT_FOUND: factura % no existe', p_invoice_id;
  END IF;

  -- CASO 1: NO PAGO (Visita sin cobro, amount = 0 o method = 'nopago')
  IF p_amount = 0 OR p_method = 'nopago' THEN
    INSERT INTO public.payments (
      invoice_id, client_id, amount, payment_date, method, client_uuid
    ) VALUES (
      p_invoice_id,
      p_client_id,
      0,
      p_payment_date,
      'nopago',
      p_client_uuid
    )
    RETURNING id INTO v_pay_id;

    -- Movimiento puramente informativo en caja con monto 0 (no altera saldo_final)
    IF p_caja_id IS NOT NULL THEN
      INSERT INTO public.cash_movements (caja_id, tipo, descripcion, monto, client_uuid)
      VALUES (
        p_caja_id,
        'nopago',
        'Visita sin cobro - factura ' || p_invoice_id::text,
        0,
        p_client_uuid
      );
    END IF;

    RETURN v_pay_id;
  END IF;

  -- CASO 2: ABONO / PAGO REAL (amount > 0)
  IF v_status = 'pagado' THEN
    RAISE EXCEPTION 'FACTURA_PAGADA: la factura % ya esta completamente pagada', p_invoice_id;
  END IF;

  -- Tolerancia de redondeo: si excede por hasta $1, ajustar al saldo exacto
  IF p_amount > v_saldo THEN
    IF (p_amount - v_saldo) <= 1.0 THEN
      p_amount := v_saldo;
    ELSE
      RAISE EXCEPTION 'El monto del pago (%) excede el saldo de la factura (%)', p_amount, v_saldo;
    END IF;
  END IF;

  -- Validar caja abierta
  SELECT estado, usuario_id INTO v_caja_estado, v_caja_usuario_id
  FROM public.cajas WHERE id = p_caja_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND: la caja % no existe', p_caja_id;
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: no se pueden registrar pagos en una caja cerrada';
  END IF;

  -- Insertar movimiento real de caja
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid
  ) VALUES (
    p_caja_id,
    'pago',
    'Cobro factura ' || p_invoice_id::text,
    ROUND(p_amount, 2),
    p_client_uuid
  )
  RETURNING id INTO v_mov_id;

  -- Sumar saldo a la caja
  UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, 0) + ROUND(p_amount, 2)
    WHERE id = p_caja_id;

  -- Insertar registro de pago
  INSERT INTO public.payments (
    invoice_id, client_id, amount, payment_date, method, cash_movement_id, client_uuid
  ) VALUES (
    p_invoice_id,
    p_client_id,
    ROUND(p_amount, 2),
    p_payment_date,
    p_method,
    v_mov_id,
    p_client_uuid
  )
  RETURNING id INTO v_pay_id;

  -- Descontar saldo de la factura
  v_nuevo_saldo := GREATEST(ROUND(v_saldo - p_amount, 2), 0);

  UPDATE public.invoice
    SET
      saldo  = v_nuevo_saldo,
      status = CASE WHEN v_nuevo_saldo <= 0 THEN 'pagado' ELSE status END
    WHERE id = p_invoice_id;

  -- ==================================================================
  -- DISTRIBUCIÓN PROGRESIVA DE ABONOS ENTRE CUOTAS PENDIENTES
  -- ==================================================================
  v_monto_restante := ROUND(p_amount, 2);

  FOR r_cuota IN (
    SELECT id, monto, COALESCE(monto_pagado, 0) AS monto_pagado
    FROM public.cuotas
    WHERE invoice_id = p_invoice_id
      AND estado IN ('pendiente', 'parcial', 'abonada')
    ORDER BY numero ASC
    FOR UPDATE
  ) LOOP
    EXIT WHEN v_monto_restante <= 0;

    v_saldo_cuota := r_cuota.monto - r_cuota.monto_pagado;
    IF v_saldo_cuota <= 0 THEN
      CONTINUE;
    END IF;

    IF v_monto_restante >= v_saldo_cuota THEN
      -- Cubre la totalidad del saldo pendiente de esta cuota
      UPDATE public.cuotas
      SET
        estado       = 'pagada',
        monto_pagado = r_cuota.monto,
        payment_id   = v_pay_id
      WHERE id = r_cuota.id;

      v_monto_restante := v_monto_restante - v_saldo_cuota;
    ELSE
      -- Abono parcial a la cuota
      UPDATE public.cuotas
      SET
        estado       = 'parcial',
        monto_pagado = r_cuota.monto_pagado + v_monto_restante,
        payment_id   = v_pay_id
      WHERE id = r_cuota.id;

      v_monto_restante := 0;
    END IF;
  END LOOP;

  -- Si el saldo restante de la factura llegó a 0 (pago total), asegurar que TODAS las cuotas queden como 'pagada'
  IF v_nuevo_saldo <= 0 THEN
    UPDATE public.cuotas
    SET
      estado       = 'pagada',
      monto_pagado = monto,
      payment_id   = COALESCE(payment_id, v_pay_id)
    WHERE invoice_id = p_invoice_id
      AND estado <> 'pagada';
  END IF;

  RETURN v_pay_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_payment(uuid, uuid, numeric, date, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment(uuid, uuid, numeric, date, text, uuid, uuid) TO service_role;
