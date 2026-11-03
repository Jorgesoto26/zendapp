-- =====================================================================
-- MIGRACIÓN: 20261103000002_fix_payments_cuotas_and_invoice_status.sql
-- Correcciones definitivas del flujo de pagos y sincronización:
-- 1. invoice_status_check: ampliar restricción CHECK para aceptar todos los estados
--    válidos ('pendiente', 'pagado', 'pagada', 'cancelada', 'cancelado', 'cancel', 'renovado').
-- 2. create_payment: corregir idempotencia vinculando p_client_uuid a la factura p_invoice_id,
--    garantizar distribución progresiva de cuotas en abonos y pago total.
-- 3. get_invoices_vendedor: calcular cuotasPagas a partir de cuotas reales con estado 'pagada'
--    e incluir el arreglo serializado de cuotas en el payload JSON.
-- =====================================================================

-- 1. ACTUALIZAR RESTRICCIÓN CHECK EN public.invoice
ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_status_check;
ALTER TABLE public.invoice ADD CONSTRAINT invoice_status_check 
  CHECK (status IN ('pendiente', 'pagado', 'pagada', 'cancelada', 'cancelado', 'cancel', 'renovado'));

-- 2. CORREGIR RPC create_payment CON IDEMPOTENCIA Y AMORTIZACIÓN PROGRESIVA
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
  -- 1. Validar que el usuario que ejecuta la operación no esté inhabilitado
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND activo IS FALSE) THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- 2. Idempotencia por client_uuid vinculada a esta factura específica
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_pay_id
    FROM public.payments
    WHERE client_uuid = p_client_uuid
      AND invoice_id = p_invoice_id
    LIMIT 1;

    IF v_pay_id IS NOT NULL THEN
      RETURN v_pay_id;
    END IF;
  END IF;

  -- 3. Idempotencia de ventana de 5 minutos (fallback si client_uuid es nulo)
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

  -- 4. Validación de monto no negativo
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor o igual a 0';
  END IF;

  -- 5. Factura con bloqueo FOR UPDATE
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
  IF v_status = 'pagado' OR v_status = 'pagada' THEN
    RAISE EXCEPTION 'FACTURA_PAGADA: la factura % ya está completamente pagada', p_invoice_id;
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


-- 3. CORREGIR get_invoices_vendedor: cuotasPagas EXACTAS Y CARGA DE CUOTAS
CREATE OR REPLACE FUNCTION public.get_invoices_vendedor(p_vendedor_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_target_id uuid;
  v_is_ok     boolean;
  v_result    json;
BEGIN
  v_target_id := COALESCE(p_vendedor_id, auth.uid());

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: no hay sesión activa';
  END IF;

  IF auth.uid() IS NOT NULL AND v_target_id <> auth.uid() THEN
    SELECT (public.is_admin() OR public.is_same_hierarchy(v_target_id)) INTO v_is_ok;
    IF NOT v_is_ok THEN
      RAISE EXCEPTION 'UNAUTHORIZED: no tienes permiso para ver la cartera de este vendedor';
    END IF;
  END IF;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', i.id::text,
      'nombreCliente', COALESCE(cl.nombre, ''),
      'apellidoCliente', COALESCE(cl.apellido, ''),
      'aliasCliente', COALESCE(cl.alias, ''),
      'documentoCliente', COALESCE(cl.documento, ''),
      'telefonocliente', COALESCE(cl.telefono, ''),
      'direccion', COALESCE(cl.direccion, ''),
      'cuotasPagas', COALESCE(
        NULLIF((SELECT COUNT(*) FROM public.cuotas cu WHERE cu.invoice_id = i.id AND cu.estado = 'pagada'), 0),
        (SELECT COUNT(*) FROM public.payments pay WHERE pay.invoice_id = i.id AND pay.amount > 0),
        0
      ),
      'cuotasVencidas', COALESCE((
        SELECT COUNT(*)
        FROM public.cuotas cu
        WHERE cu.invoice_id = i.id AND cu.estado IN ('pendiente','parcial','abonada') AND cu.fecha_vencimiento < CURRENT_DATE
      ), 0),
      'detalles', COALESCE((
        SELECT cp.valor
        FROM public.concepts cp
        WHERE cp.id = i.plazo_id
      ), ''),
      'estado', COALESCE(i.status, 'pendiente'),
      'estadoUsuario', COALESCE(p.rol, 'vendedor'),
      'facturaWriteDate', (EXTRACT(EPOCH FROM i.created_at) * 1000)::bigint,
      'latitud', COALESCE(i.latitud, cl.latitud),
      'longitud', COALESCE(i.longitud, cl.longitud),
      'previous_invoice_id', i.previous_invoice_id::text,
      'nombreUno', COALESCE(p.nombre || ' ' || COALESCE(p.apellido, ''), ''),
      'nombreDos', NULL,
      'nombreUsuario', COALESCE(p.nombre || ' ' || COALESCE(p.apellido, ''), ''),
      'pagos', COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', pay.id::text,
            'amount', pay.amount,
            'payment_date', pay.payment_date,
            'method', pay.method
          ) ORDER BY pay.payment_date ASC, pay.created_at ASC
        )
        FROM public.payments pay
        WHERE pay.invoice_id = i.id
      ), '[]'::json),
      'cuotas', COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', cu.id::text,
            'numero', cu.numero,
            'fecha_vencimiento', cu.fecha_vencimiento,
            'monto', cu.monto,
            'estado', cu.estado,
            'monto_pagado', COALESCE(cu.monto_pagado, 0)
          ) ORDER BY cu.numero ASC
        )
        FROM public.cuotas cu
        WHERE cu.invoice_id = i.id
      ), '[]'::json),
      'partnerId', i.client_id::text,
      'paymentTermId', i.plazo_id,
      'saldo', COALESCE(i.saldo, 0),
      'saldoVencido', COALESCE((
        SELECT SUM(cu.monto - COALESCE(cu.monto_pagado, 0))
        FROM public.cuotas cu
        WHERE cu.invoice_id = i.id AND cu.estado IN ('pendiente','parcial','abonada') AND cu.fecha_vencimiento < CURRENT_DATE
      ), 0),
      'usuarioId', i.usuario_id::text,
      'idVendedor', i.usuario_id::text,
      'valorCuota', COALESCE(
        (SELECT cu.monto FROM public.cuotas cu WHERE cu.invoice_id = i.id ORDER BY cu.numero LIMIT 1),
        CASE
          WHEN (SELECT cp.valor FROM public.concepts cp WHERE cp.id = i.plazo_id) ~ '^\d+'
            THEN ROUND(i.amount / GREATEST(1, (regexp_match((SELECT cp.valor FROM public.concepts cp WHERE cp.id = i.plazo_id), '(\d+)'))[1]::numeric), 2)
          ELSE i.amount
        END
      ),
      'valorInicial', COALESCE(i.amount, 0),
      'estadoMovil', 'pendiente',
      'fecha_vencimiento', (SELECT MAX(cu.fecha_vencimiento)::text FROM public.cuotas cu WHERE cu.invoice_id = i.id),
      'fecha', i.created_at::text,
      'num_cuotas', COALESCE(
        (SELECT cp.valor FROM public.concepts cp WHERE cp.id = i.plazo_id),
        (SELECT COUNT(*)::text FROM public.cuotas cu WHERE cu.invoice_id = i.id)
      )
    )
    ORDER BY i.created_at DESC
  ), '[]'::json) INTO v_result
  FROM public.invoice i
  JOIN public.clients cl ON cl.id = i.client_id
  LEFT JOIN public.profiles p ON p.id = i.usuario_id
  WHERE i.usuario_id = v_target_id
    AND i.saldo > 0
    AND COALESCE(i.castigado, false) = false;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoices_vendedor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoices_vendedor(uuid) TO service_role;

