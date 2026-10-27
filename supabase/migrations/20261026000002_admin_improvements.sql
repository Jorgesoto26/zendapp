-- =====================================================================
-- MIGRACIÓN: Mejoras y Correcciones del Perfil Administrador
-- Fecha: 2026-10-26
-- 1. Corrección Reportes (m.fecha en vez de m.created_at)
-- 2. Cambio de contraseña seguro para subordinados (admin_update_user)
-- 3. Traslado atómico de cartera entre vendedores (admin_trasladar_cartera)
-- 4. Distribución progresiva de abonos entre cuotas y no pago limpio (create_payment)
-- 5. Corrección de cálculo de cuotas restantes (admin_get_cartera_detail)
-- 6. Aplicación de límites y bloqueo de usuarios inhabilitados en servidor (create_sale, rpc_create_cash_movement)
-- =====================================================================

-- Extensión pgcrypto para hashing de contraseñas de auth
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- 1. REPORTE CONSOLIDADO: Corregir alias de fecha en cash_movements (Requisito 12)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_reporte_consolidado(
  p_fecha_ini date,
  p_fecha_fin date
)
RETURNS TABLE (
  usuario_id uuid,
  nombre text,
  apellido text,
  rol text,
  total_recaudado numeric,
  total_ventas numeric,
  total_gastos numeric,
  total_ingresos numeric,
  total_retiros numeric,
  total_nopagos bigint,
  saldo_cartera_actual numeric
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
  all_users AS (SELECT id FROM subordinates UNION SELECT auth.uid())
  SELECT
    p.id AS usuario_id,
    p.nombre,
    p.apellido,
    p.rol,
    -- Recaudado en el periodo (usando m.fecha en cash_movements)
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'pago'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_recaudado,
    -- Ventas en el periodo
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'venta'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_ventas,
    -- Gastos en el periodo (retiros con descripción gasto)
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'retiro'
        AND m.descripcion ILIKE '%gasto%'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_gastos,
    -- Ingresos en el periodo
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'ingreso'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_ingresos,
    -- Retiros en el periodo
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'retiro'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_retiros,
    -- No pagos registrados en el periodo
    COALESCE((
      SELECT COUNT(*)
      FROM public.payments pay
      JOIN public.invoice inv ON inv.id = pay.invoice_id
      WHERE inv.usuario_id = p.id
        AND pay.method = 'nopago'
        AND pay.payment_date >= p_fecha_ini
        AND pay.payment_date <= p_fecha_fin
    ), 0) AS total_nopagos,
    -- Saldo de cartera actual (facturas activas no castigadas)
    COALESCE((
      SELECT SUM(inv.saldo)
      FROM public.invoice inv
      WHERE inv.usuario_id = p.id
        AND inv.saldo > 0
        AND inv.castigado = false
    ), 0) AS saldo_cartera_actual
  FROM public.profiles p
  WHERE p.id IN (SELECT id FROM all_users)
  ORDER BY p.nombre ASC;
END;
$$;

-- =====================================================================
-- 2. ACTUALIZAR USUARIO Y CONTRASEÑA DE FORMA SEGURA (Requisito 3)
-- =====================================================================
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
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
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

  -- Actualizar contraseña en auth.users si se proporcionó una nueva válida
  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$$;

-- =====================================================================
-- 3. TRASLADO ATÓMICO DE CARTERA ENTRE VENDEDORES (Requisito 6)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_trasladar_cartera(
  p_vendedor_origen  uuid,
  p_vendedor_destino uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_destino_activo boolean;
  v_destino_rol    text;
  v_clientes_count integer;
  v_facturas_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden trasladar cartera';
  END IF;

  IF p_vendedor_origen = p_vendedor_destino THEN
    RAISE EXCEPTION 'No se puede trasladar la cartera al mismo vendedor';
  END IF;

  -- Verificar jerarquía sobre origen y destino
  IF NOT public.is_same_hierarchy(p_vendedor_origen) AND p_vendedor_origen <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: El vendedor origen no pertenece a tu jerarquía';
  END IF;

  IF NOT public.is_same_hierarchy(p_vendedor_destino) AND p_vendedor_destino <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: El vendedor destino no pertenece a tu jerarquía';
  END IF;

  -- Verificar que el destino esté activo
  SELECT activo, rol INTO v_destino_activo, v_destino_rol
  FROM public.profiles
  WHERE id = p_vendedor_destino;

  IF v_destino_activo IS NOT TRUE THEN
    RAISE EXCEPTION 'El vendedor destino se encuentra inhabilitado o no existe';
  END IF;

  -- 1. Trasladar la asignación de clientes
  UPDATE public.clients
  SET vendedor_id = p_vendedor_destino,
      updated_at  = now()
  WHERE vendedor_id = p_vendedor_origen;

  GET DIAGNOSTICS v_clientes_count = ROW_COUNT;

  -- 2. Trasladar facturas activas pendientes (manteniendo intactas las históricas ya pagadas)
  UPDATE public.invoice
  SET usuario_id = p_vendedor_destino
  WHERE usuario_id = p_vendedor_origen
    AND status = 'pendiente'
    AND saldo > 0;

  GET DIAGNOSTICS v_facturas_count = ROW_COUNT;

  RETURN json_build_object(
    'success', true,
    'vendedor_origen', p_vendedor_origen,
    'vendedor_destino', p_vendedor_destino,
    'clientes_trasladados', v_clientes_count,
    'facturas_trasladadas', v_facturas_count
  );
END;
$$;

-- =====================================================================
-- 4. CARTERA DETALLE: Corrección de cuotas restantes (Requisito 4)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_get_cartera_detail(p_usuario_id uuid)
RETURNS TABLE (
  invoice_id uuid,
  client_id uuid,
  nombre_cliente text,
  apellido_cliente text,
  telefono text,
  documento text,
  saldo numeric,
  saldo_inicial numeric,
  saldo_vencido numeric,
  cuotas_restantes bigint,
  cuota_actual bigint,
  cuotas_totales bigint,
  fecha_inicio timestamptz,
  fecha_fin date,
  status text,
  castigado boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT public.is_same_hierarchy(p_usuario_id) AND p_usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no pertenece a tu jerarquía';
  END IF;

  RETURN QUERY
  SELECT
    i.id AS invoice_id,
    i.client_id,
    cl.nombre AS nombre_cliente,
    cl.apellido AS apellido_cliente,
    cl.telefono,
    cl.documento,
    i.saldo,
    i.amount AS saldo_inicial,
    COALESCE((
      SELECT SUM(c.monto - COALESCE(c.monto_pagado, 0))
      FROM public.cuotas c
      WHERE c.invoice_id = i.id AND c.estado IN ('pendiente','parcial') AND c.fecha_vencimiento < CURRENT_DATE
    ), 0) AS saldo_vencido,
    -- Cuotas pendientes de completar (no contar cuotas ya pagadas, incluir abonadas)
    (SELECT COUNT(*) FROM public.cuotas c
     WHERE c.invoice_id = i.id
       AND (c.estado IN ('pendiente','parcial') OR COALESCE(c.monto_pagado, 0) < c.monto)
       AND c.estado <> 'pagada'
    ) AS cuotas_restantes,
    -- Siguiente cuota a pagar
    LEAST(
      (SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id AND c.estado = 'pagada') + 1,
      GREATEST((SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id), 1)
    ) AS cuota_actual,
    (SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id) AS cuotas_totales,
    i.created_at AS fecha_inicio,
    (SELECT MAX(c.fecha_vencimiento) FROM public.cuotas c WHERE c.invoice_id = i.id) AS fecha_fin,
    i.status,
    i.castigado
  FROM public.invoice i
  JOIN public.clients cl ON cl.id = i.client_id
  WHERE i.usuario_id = p_usuario_id
    AND i.saldo > 0
    AND i.castigado = false
  ORDER BY i.saldo DESC;
END;
$$;

-- =====================================================================
-- 5. CREATE_PAYMENT: Distribución progresiva de abonos y no pago limpio (Requisito 11)
-- =====================================================================
-- Eliminar firmas sobrecargadas para evitar conflicto
DROP FUNCTION IF EXISTS public.create_payment(uuid, uuid, numeric, date, text, uuid);
DROP FUNCTION IF EXISTS public.create_payment(uuid, uuid, numeric, date, text, uuid, uuid);

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
  -- REGLA ESTRICTA (Requisito 11):
  -- - NO marcar cuotas como pagadas ni abonadas
  -- - NO incrementar monto_pagado
  -- - NO reducir saldo de factura
  -- - NO generar entrada ficticia de dinero en caja
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

  IF p_amount > v_saldo THEN
    RAISE EXCEPTION 'El monto del pago (%) excede el saldo de la factura (%)', p_amount, v_saldo;
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
  -- DISTRIBUCIÓN PROGRESIVA DE ABONOS ENTRE CUOTAS PENDIENTES (Requisito 11)
  -- ==================================================================
  v_monto_restante := ROUND(p_amount, 2);

  FOR r_cuota IN (
    SELECT id, monto, COALESCE(monto_pagado, 0) AS monto_pagado
    FROM public.cuotas
    WHERE invoice_id = p_invoice_id
      AND estado IN ('pendiente', 'parcial')
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

  RETURN v_pay_id;
END;
$func$;

-- =====================================================================
-- 6. PROTECCIÓN EN SERVIDOR: Límites y bloqueo inhabilitados (Requisitos 1 y 2)
-- =====================================================================
DROP FUNCTION IF EXISTS public.rpc_create_cash_movement(uuid, text, text, numeric, uuid);
CREATE OR REPLACE FUNCTION public.rpc_create_cash_movement(
  p_caja_id     uuid,
  p_tipo        text,
  p_descripcion text,
  p_monto       numeric,
  p_client_uuid uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_mov_id          uuid;
  v_caja_estado     text;
  v_caja_usuario_id uuid;
  v_max_gasto       numeric;
  v_activo          boolean;
BEGIN
  -- Validar usuario activo
  SELECT activo, dinero_max_gasto INTO v_activo, v_max_gasto
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- Validar limite de gasto si tipo es retiro
  IF p_tipo = 'retiro' AND v_max_gasto IS NOT NULL AND v_max_gasto > 0 AND p_monto > v_max_gasto THEN
    RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) excede tu límite permitido por gasto (%)', p_monto, v_max_gasto;
  END IF;

  -- Validar caja abierta
  SELECT estado, usuario_id INTO v_caja_estado, v_caja_usuario_id
  FROM public.cajas WHERE id = p_caja_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: La caja debe estar abierta para registrar movimientos';
  END IF;

  -- Insertar movimiento
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid
  ) VALUES (
    p_caja_id, p_tipo, p_descripcion, ROUND(p_monto, 2), p_client_uuid
  )
  RETURNING id INTO v_mov_id;

  -- Actualizar saldo_final de caja
  IF p_tipo = 'ingreso' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) + ROUND(p_monto, 2) WHERE id = p_caja_id;
  ELSIF p_tipo = 'retiro' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) - ROUND(p_monto, 2) WHERE id = p_caja_id;
  END IF;

  RETURN v_mov_id;
END;
$func$;

-- Asegurar politicas RLS de seguridad en perfiles para que no modifiquen sus propios limites
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;

CREATE POLICY "profiles_update_policy" ON public.profiles
FOR UPDATE
USING (
  -- Solo administradores pueden actualizar perfiles de su jerarquia
  public.is_admin() AND (public.is_same_hierarchy(id) OR id = auth.uid())
)
WITH CHECK (
  public.is_admin() AND (public.is_same_hierarchy(id) OR id = auth.uid())
);
