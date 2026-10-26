-- =====================================================================
-- ZENDA - MIGRACIÓN: Mejoras Vendedor (Ubicación, Renovación de Créditos y Cartera)
-- =====================================================================

-- 1. Agregar columnas de latitud y longitud a clients e invoice si no existen
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS latitud NUMERIC;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS longitud NUMERIC;

ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS latitud NUMERIC;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS longitud NUMERIC;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS previous_invoice_id UUID REFERENCES public.invoice(id);

-- 2. Actualizar create_sale para registrar ubicacion y previous_invoice_id
CREATE OR REPLACE FUNCTION public.create_sale(
  nombre              text,
  apellido            text,
  alias               text,
  email               text,
  telefono            text,
  direccion           text,
  documento           text,
  monto               numeric, -- Capital solicitado
  vendedor_id         uuid,
  caja_id             uuid,
  plazo_id            integer,
  interes_id          integer,
  client_uuid         uuid DEFAULT NULL,
  latitud             numeric DEFAULT NULL,
  longitud            numeric DEFAULT NULL,
  previous_invoice_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
#variable_conflict use_column
DECLARE
  v_client_id       uuid;
  v_invoice_id      uuid;
  v_mov_id          uuid;
  v_plazo_val       text;
  v_interes_val     text;
  v_tasa            numeric;
  v_capital         numeric;
  v_interes_monto   numeric;
  v_total_factura   numeric;
  v_num_cuotas      integer;
  v_cuota_monto     numeric;
  v_cuota_resto     numeric;
  v_caja_estado     text;
  v_vendedor_ok     boolean;
  i                 integer;
BEGIN
  -- Idempotencia: si client_uuid ya existe, retornar id existente
  IF create_sale.client_uuid IS NOT NULL THEN
    SELECT m.id, i.id INTO v_mov_id, v_invoice_id
    FROM public.cash_movements m
    JOIN public.invoice i ON m.descripcion LIKE '%' || i.id::text || '%'
    WHERE m.client_uuid = create_sale.client_uuid
    LIMIT 1;

    IF v_mov_id IS NOT NULL THEN
      RETURN json_build_object(
        'success', true,
        'id_factura', v_invoice_id,
        'id_movimiento', v_mov_id,
        'idempotente', true
      );
    END IF;
  END IF;

  -- Seguridad: verificar que el vendedor_id sea el autenticado o subordinado
  IF create_sale.vendedor_id <> auth.uid() THEN
    SELECT public.is_same_hierarchy(create_sale.vendedor_id) INTO v_vendedor_ok;
    IF NOT v_vendedor_ok THEN
      RAISE EXCEPTION 'UNAUTHORIZED: no tienes permiso para crear ventas en nombre de ese vendedor';
    END IF;
  END IF;

  -- Validar caja abierta
  SELECT cj.estado INTO v_caja_estado
  FROM public.cajas cj
  WHERE cj.id = create_sale.caja_id AND cj.usuario_id = create_sale.vendedor_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND: caja no encontrada o no pertenece al vendedor';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: debes abrir una caja antes de registrar una venta';
  END IF;

  -- Validar monto
  IF create_sale.monto IS NULL OR create_sale.monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: el monto de la venta debe ser mayor que 0';
  END IF;

  -- Calculo de Capital e Interes
  SELECT cp.valor INTO v_interes_val
  FROM public.concepts cp WHERE cp.id = create_sale.interes_id;

  v_tasa := COALESCE(
    CASE 
      WHEN v_interes_val ~ '^\s*0\.' THEN (regexp_match(v_interes_val, '([0-9]+\.[0-9]+)'))[1]::numeric
      ELSE (regexp_match(v_interes_val, '([0-9]+(?:\.[0-9]+)?)'))[1]::numeric / 100.0
    END,
    0
  );

  v_capital := ROUND(create_sale.monto, 2);
  v_interes_monto := ROUND(v_capital * v_tasa, 2);
  v_total_factura := v_capital + v_interes_monto;

  -- Cliente: buscar por documento del vendedor o crear nuevo
  SELECT cl.id INTO v_client_id
  FROM public.clients cl
  WHERE cl.documento = create_sale.documento
    AND cl.vendedor_id = create_sale.vendedor_id
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (
      nombre, apellido, alias, email, telefono, direccion, documento, vendedor_id, latitud, longitud
    ) VALUES (
      create_sale.nombre,
      create_sale.apellido,
      create_sale.alias,
      create_sale.email,
      create_sale.telefono,
      create_sale.direccion,
      create_sale.documento,
      create_sale.vendedor_id,
      create_sale.latitud,
      create_sale.longitud
    )
    RETURNING clients.id INTO v_client_id;
  ELSE
    UPDATE public.clients AS cl SET
      nombre    = create_sale.nombre,
      apellido  = create_sale.apellido,
      alias     = create_sale.alias,
      email     = COALESCE(NULLIF(create_sale.email, ''), cl.email),
      telefono  = COALESCE(NULLIF(create_sale.telefono, ''), cl.telefono),
      direccion = COALESCE(NULLIF(create_sale.direccion, ''), cl.direccion),
      latitud   = COALESCE(create_sale.latitud, cl.latitud),
      longitud  = COALESCE(create_sale.longitud, cl.longitud)
    WHERE cl.id = v_client_id;
  END IF;

  -- Factura: crear con estado 'pendiente' y saldo total, vinculando previous_invoice_id y coords
  INSERT INTO public.invoice (
    client_id, amount, saldo, status, usuario_id, plazo_id, interes_id,
    capital_amount, interest_amount, latitud, longitud, previous_invoice_id
  ) VALUES (
    v_client_id,
    v_total_factura,
    v_total_factura,
    'pendiente',
    create_sale.vendedor_id,
    create_sale.plazo_id,
    create_sale.interes_id,
    v_capital,
    v_interes_monto,
    create_sale.latitud,
    create_sale.longitud,
    create_sale.previous_invoice_id
  )
  RETURNING invoice.id INTO v_invoice_id;

  -- Cuotas: calculadas sobre el total a cobrar
  SELECT cp.valor INTO v_plazo_val
  FROM public.concepts cp WHERE cp.id = create_sale.plazo_id;

  v_num_cuotas := COALESCE(
    (regexp_match(v_plazo_val, '(\d+)'))[1]::integer,
    1
  );
  IF v_num_cuotas <= 0 THEN v_num_cuotas := 1; END IF;

  v_cuota_monto := FLOOR(v_total_factura / v_num_cuotas);
  v_cuota_resto := v_total_factura - (v_cuota_monto * (v_num_cuotas - 1));

  FOR i IN 1..v_num_cuotas LOOP
    INSERT INTO public.cuotas (
      invoice_id,
      numero,
      fecha_vencimiento,
      monto,
      estado,
      monto_pagado
    ) VALUES (
      v_invoice_id,
      i,
      CURRENT_DATE + (i * INTERVAL '1 day'),
      CASE WHEN i = v_num_cuotas THEN v_cuota_resto ELSE v_cuota_monto END,
      'pendiente',
      0
    );
  END LOOP;

  -- Movimiento de Caja: egreso de efectivo (venta)
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, fecha, client_uuid
  ) VALUES (
    create_sale.caja_id,
    'venta',
    'Venta factura ' || v_invoice_id::text,
    v_capital,
    NOW(),
    create_sale.client_uuid
  )
  RETURNING cash_movements.id INTO v_mov_id;

  -- Actualizar Saldo de Caja: resta el capital entregado en efectivo
  UPDATE public.cajas AS ca
    SET saldo_final = COALESCE(ca.saldo_final, 0) - v_capital
    WHERE ca.id = create_sale.caja_id;

  RETURN json_build_object(
    'success',        true,
    'id_factura',     v_invoice_id,
    'id_cliente',     v_client_id,
    'id_movimiento',  v_mov_id,
    'capital',        v_capital,
    'interes',        v_interes_monto,
    'total_factura',  v_total_factura,
    'es_cliente_nuevo', v_client_id IS NOT NULL
  );
END;
$func$;

-- 3. Actualizar get_invoices_vendedor para retornar latitud y longitud reales
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
      'cuotasPagas', COALESCE((
        SELECT COUNT(*)
        FROM public.payments pay
        WHERE pay.invoice_id = i.id AND pay.amount > 0
      ), 0),
      'cuotasVencidas', COALESCE((
        SELECT COUNT(*)
        FROM public.cuotas cu
        WHERE cu.invoice_id = i.id AND cu.estado IN ('pendiente','parcial') AND cu.fecha_vencimiento < CURRENT_DATE
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
            'amount', pay.amount,
            'payment_date', pay.payment_date,
            'method', pay.method
          ) ORDER BY pay.payment_date ASC, pay.created_at ASC
        )
        FROM public.payments pay
        WHERE pay.invoice_id = i.id
      ), '[]'::json),
      'partnerId', i.client_id::text,
      'paymentTermId', i.plazo_id,
      'saldo', COALESCE(i.saldo, 0),
      'saldoVencido', COALESCE((
        SELECT SUM(cu.monto - COALESCE(cu.monto_pagado, 0))
        FROM public.cuotas cu
        WHERE cu.invoice_id = i.id AND cu.estado IN ('pendiente','parcial') AND cu.fecha_vencimiento < CURRENT_DATE
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
