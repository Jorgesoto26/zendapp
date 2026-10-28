-- =====================================================================
-- ZENDA - MIGRACIÓN: Correcciones Vendedor (create_sale, cash_movements, fecha, edición)
-- Fecha: 2026-10-28
-- =====================================================================

-- 1. ELIMINAR TODAS LAS SOBRECARGAS DE create_sale PARA RESOLVER ERROR PGRST203
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'create_sale'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;

-- 2. CREAR FUNCIÓN ÚNICA Y CANÓNICA create_sale (16 parámetros con defaults seguros)
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
  previous_invoice_id uuid DEFAULT NULL,
  fecha               timestamptz DEFAULT NULL
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
  v_fecha_efectiva  timestamptz;
  i                 integer;
BEGIN
  v_fecha_efectiva := COALESCE(create_sale.fecha, NOW());

  -- Idempotencia: si client_uuid ya existe, retornar id existente sin duplicar
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
    capital_amount, interest_amount, latitud, longitud, previous_invoice_id, created_at
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
    create_sale.previous_invoice_id,
    v_fecha_efectiva
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
      (v_fecha_efectiva::date + (i * INTERVAL '1 day'))::date,
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
    v_fecha_efectiva,
    create_sale.client_uuid
  )
  RETURNING cash_movements.id INTO v_mov_id;

  -- Actualizar Saldo de Caja: resta el capital entregado en efectivo
  UPDATE public.cajas AS ca
    SET saldo_final = COALESCE(ca.saldo_final, ca.saldo_inicial, 0) - v_capital
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

GRANT EXECUTE ON FUNCTION public.create_sale(text, text, text, text, text, text, text, numeric, uuid, uuid, integer, integer, uuid, numeric, numeric, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(text, text, text, text, text, text, text, numeric, uuid, uuid, integer, integer, uuid, numeric, numeric, uuid, timestamptz) TO service_role;


-- 3. ELIMINAR SOBRECARGAS DE rpc_create_cash_movement Y SOPORTAR FECHA
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'rpc_create_cash_movement'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_create_cash_movement(
  p_caja_id     uuid,
  p_tipo        text,
  p_descripcion text,
  p_monto       numeric,
  p_client_uuid uuid DEFAULT NULL,
  p_fecha       timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_mov_id              uuid;
  v_mirror_mov_id       uuid;
  v_caja_estado         text;
  v_caja_usuario_id     uuid;
  v_admin_caja_id       uuid;
  v_admin_caja_estado   text;
  v_max_gasto           numeric;
  v_activo              boolean;
  v_user_nombre         text;
  v_mirror_desc         text;
  v_fecha_efectiva      timestamptz;
BEGIN
  v_fecha_efectiva := COALESCE(p_fecha, NOW());

  -- 1. Idempotencia por client_uuid
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_mov_id
    FROM public.cash_movements
    WHERE client_uuid = p_client_uuid
    LIMIT 1;

    IF v_mov_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'id', v_mov_id, 'idempotente', true);
    END IF;
  END IF;

  -- 2. Validar usuario activo
  SELECT activo, dinero_max_gasto, TRIM(COALESCE(nombre, '') || ' ' || COALESCE(apellido, ''))
  INTO v_activo, v_max_gasto, v_user_nombre
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- 3. Validar limite de gasto si tipo es retiro o gasto
  IF (p_tipo = 'retiro' OR p_tipo = 'gasto') AND v_max_gasto IS NOT NULL AND v_max_gasto > 0 AND p_monto > v_max_gasto THEN
    RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) excede tu límite permitido por gasto (%)', p_monto, v_max_gasto;
  END IF;

  -- 4. Validar caja abierta
  SELECT estado, usuario_id, admin_caja_id
  INTO v_caja_estado, v_caja_usuario_id, v_admin_caja_id
  FROM public.cajas WHERE id = p_caja_id FOR UPDATE;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: La caja debe estar abierta para registrar movimientos';
  END IF;

  -- Si no tiene admin_caja_id explícito en la fila, buscar la caja abierta del superior
  IF v_admin_caja_id IS NULL THEN
    SELECT c.id INTO v_admin_caja_id
    FROM public.cajas c
    JOIN public.profiles p ON p.superior_id = c.usuario_id
    WHERE p.id = v_caja_usuario_id
      AND c.estado = 'abierta'
    ORDER BY c.fecha_apertura DESC
    LIMIT 1;

    IF v_admin_caja_id IS NOT NULL THEN
      UPDATE public.cajas SET admin_caja_id = v_admin_caja_id WHERE id = p_caja_id;
    END IF;
  END IF;

  -- Si existe admin_caja_id, validar que siga abierta
  IF v_admin_caja_id IS NOT NULL AND v_admin_caja_id <> p_caja_id THEN
    SELECT estado INTO v_admin_caja_estado FROM public.cajas WHERE id = v_admin_caja_id FOR UPDATE;
  END IF;

  -- 5. Insertar movimiento en la caja principal con la fecha efectiva
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid, external_caja_id, fecha
  ) VALUES (
    p_caja_id, p_tipo, p_descripcion, ROUND(p_monto, 2), p_client_uuid, v_admin_caja_id, v_fecha_efectiva
  )
  RETURNING id INTO v_mov_id;

  -- 6. Actualizar saldo_final de la caja principal
  IF p_tipo = 'ingreso' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ROUND(p_monto, 2) WHERE id = p_caja_id;
  ELSIF p_tipo = 'retiro' OR p_tipo = 'gasto' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ROUND(p_monto, 2) WHERE id = p_caja_id;
  END IF;

  -- 7. Movimiento Espejo con la Caja del Admin (si aplica)
  IF v_admin_caja_id IS NOT NULL AND v_admin_caja_estado = 'abierta' AND v_admin_caja_id <> p_caja_id THEN
    IF p_tipo = 'retiro' THEN
      v_mirror_desc := 'Entrega vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                       CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

      INSERT INTO public.cash_movements (
        caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id, fecha
      ) VALUES (
        v_admin_caja_id, 'ingreso', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id, v_fecha_efectiva
      )
      RETURNING id INTO v_mirror_mov_id;

      UPDATE public.cash_movements SET paired_movement_id = v_mirror_mov_id WHERE id = v_mov_id;
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ROUND(p_monto, 2) WHERE id = v_admin_caja_id;

    ELSIF p_tipo = 'ingreso' THEN
      v_mirror_desc := 'Base a vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                       CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

      INSERT INTO public.cash_movements (
        caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id, fecha
      ) VALUES (
        v_admin_caja_id, 'retiro', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id, v_fecha_efectiva
      )
      RETURNING id INTO v_mirror_mov_id;

      UPDATE public.cash_movements SET paired_movement_id = v_mirror_mov_id WHERE id = v_mov_id;
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ROUND(p_monto, 2) WHERE id = v_admin_caja_id;
    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'monto', p_monto,
    'fecha', v_fecha_efectiva
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid, timestamptz) TO service_role;


-- 4. RPC PARA EDITAR MOVIMIENTOS DESDE PERFIL VENDEDOR CON PERMISOS Y LÍMITES
CREATE OR REPLACE FUNCTION public.rpc_update_cash_movement(
  p_movement_id uuid,
  p_descripcion text,
  p_monto       numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_mov               RECORD;
  v_caja              RECORD;
  v_profile           RECORD;
  v_delta             numeric;
  v_new_amount        numeric;
  v_inv               RECORD;
  v_pay               RECORD;
  v_inv_nuevo_saldo   numeric;
BEGIN
  v_new_amount := ROUND(p_monto, 2);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: el monto debe ser mayor que 0';
  END IF;

  -- 1. Obtener perfil del usuario autenticado
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF v_profile.activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- 2. Obtener el movimiento a editar
  SELECT * INTO v_mov FROM public.cash_movements WHERE id = p_movement_id FOR UPDATE;
  IF v_mov.id IS NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_NOT_FOUND: No se encontró el movimiento';
  END IF;

  -- 3. Obtener la caja del movimiento
  SELECT * INTO v_caja FROM public.cajas WHERE id = v_mov.caja_id FOR UPDATE;
  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  -- Verificar propiedad de la caja (o jerarquía admin)
  IF v_caja.usuario_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: este movimiento pertenece a una caja de otro usuario';
  END IF;

  IF v_caja.estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: no se pueden editar movimientos de una caja cerrada';
  END IF;

  -- 4. Validar permisos según el tipo de movimiento
  IF v_mov.tipo = 'venta' THEN
    -- Las ventas no permiten alterar el monto directamente para preservar integridad de cuotas y contrato
    IF v_new_amount <> v_mov.monto THEN
      RAISE EXCEPTION 'VENTA_MONTO_INMUTABLE: El monto de una venta no se puede alterar directamente. Debe anularse la venta si tiene autorización.';
    END IF;
  ELSIF v_mov.tipo = 'pago' THEN
    IF NOT COALESCE(v_profile.permite_modificar_pagos, false) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'PERMISO_DENEGADO: No tienes autorización para modificar pagos.';
    END IF;

    -- Validar y actualizar registro en payments y factura
    SELECT * INTO v_pay FROM public.payments WHERE cash_movement_id = v_mov.id LIMIT 1;
    IF v_pay.id IS NOT NULL THEN
      SELECT * INTO v_inv FROM public.invoice WHERE id = v_pay.invoice_id FOR UPDATE;
      IF v_inv.id IS NOT NULL THEN
        v_delta := v_new_amount - v_mov.monto;
        v_inv_nuevo_saldo := ROUND(v_inv.saldo - v_delta, 2);
        IF v_inv_nuevo_saldo < 0 THEN
          RAISE EXCEPTION 'MONTO_EXCEDE_SALDO: El nuevo monto excede el saldo pendiente de la factura';
        END IF;

        UPDATE public.invoice
        SET saldo = v_inv_nuevo_saldo,
            status = CASE WHEN v_inv_nuevo_saldo <= 0 THEN 'pagado' ELSE 'pendiente' END
        WHERE id = v_inv.id;

        UPDATE public.payments
        SET amount = v_new_amount
        WHERE id = v_pay.id;
      END IF;
    END IF;
  ELSIF v_mov.tipo = 'retiro' OR v_mov.tipo = 'gasto' THEN
    IF v_profile.dinero_max_gasto IS NOT NULL AND v_profile.dinero_max_gasto > 0 AND v_new_amount > v_profile.dinero_max_gasto THEN
      RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) supera tu límite permitido por gasto (%)', v_new_amount, v_profile.dinero_max_gasto;
    END IF;
  END IF;

  -- 5. Calcular delta para la caja
  v_delta := v_new_amount - v_mov.monto;

  -- 6. Actualizar movimiento
  UPDATE public.cash_movements
  SET descripcion = TRIM(COALESCE(p_descripcion, descripcion)),
      monto = v_new_amount
  WHERE id = p_movement_id;

  -- 7. Ajustar saldo_final de la caja
  IF v_mov.tipo IN ('ingreso', 'pago') THEN
    UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + v_delta
    WHERE id = v_caja.id;
  ELSIF v_mov.tipo IN ('retiro', 'gasto', 'venta') THEN
    UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - v_delta
    WHERE id = v_caja.id;
  END IF;

  -- 8. Si tiene movimiento espejo vinculado (admin)
  IF v_mov.paired_movement_id IS NOT NULL THEN
    UPDATE public.cash_movements
    SET monto = v_new_amount
    WHERE id = v_mov.paired_movement_id;

    IF v_mov.tipo = 'retiro' THEN
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + v_delta WHERE id = v_mov.external_caja_id;
    ELSIF v_mov.tipo = 'ingreso' THEN
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - v_delta WHERE id = v_mov.external_caja_id;
    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', p_movement_id,
    'descripcion', p_descripcion,
    'monto', v_new_amount,
    'delta', v_delta
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric) TO service_role;

