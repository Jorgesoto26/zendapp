-- =====================================================================
-- ZENDA - MIGRACIÓN: Deduplicación e Idempotencia de Auditoría de Movimientos
-- Fecha: 2026-10-28
-- =====================================================================

-- 1. ASEGURAR COLUMNA operation_id O RESTRICCIÓN ÚNICA EN cash_movement_audit
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'cash_movement_audit' 
          AND column_name = 'operation_id'
    ) THEN
        ALTER TABLE public.cash_movement_audit ADD COLUMN operation_id text;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_op_id ON public.cash_movement_audit(operation_id);


-- 2. ELIMINAR SOBRECARGAS PREVIAS DE rpc_update_cash_movement Y rpc_sync_movement_audit
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname IN ('rpc_update_cash_movement', 'rpc_sync_movement_audit', 'rpc_get_movement_audit')
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;


-- 3. RPC CANÓNICA rpc_update_cash_movement CON AUDITORÍA IDEMPOTENTE
CREATE OR REPLACE FUNCTION public.rpc_update_cash_movement(
  p_movement_id uuid,
  p_descripcion text,
  p_monto       numeric,
  p_tipo        text DEFAULT NULL,
  p_motivo      text DEFAULT NULL,
  p_audit_id    uuid DEFAULT NULL,
  p_created_at  timestamptz DEFAULT NULL
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
  v_saldo_disponible  numeric;
  v_target_tipo       text;
  v_old_tipo          text;
  v_old_monto         numeric;
  v_audit_uuid        uuid;
  v_audit_motivo      text;
  v_audit_created_at  timestamptz;
BEGIN
  v_new_amount       := ROUND(p_monto, 2);
  v_audit_uuid       := COALESCE(p_audit_id, gen_random_uuid());
  v_audit_motivo     := COALESCE(NULLIF(TRIM(p_motivo), ''), 'Edición de movimiento');
  v_audit_created_at := COALESCE(p_created_at, NOW());

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

  v_old_tipo  := v_mov.tipo;
  v_old_monto := v_mov.monto;

  -- 3. Obtener la caja del movimiento
  SELECT * INTO v_caja FROM public.cajas WHERE id = v_mov.caja_id FOR UPDATE;
  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja.usuario_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: este movimiento pertenece a una caja de otro usuario';
  END IF;

  IF v_caja.estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: no se pueden editar movimientos de una caja cerrada';
  END IF;

  -- 4. REGLA 3.2: PROHIBIDO EDITAR INGRESO O RETIRO
  IF v_mov.tipo IN ('ingreso', 'retiro') THEN
    RAISE EXCEPTION 'TIPO_INMUTABLE: Los movimientos de ingreso y retiro no pueden ser modificados';
  END IF;

  -- REGLA VENTAS: Inmutables directamente
  IF v_mov.tipo = 'venta' THEN
    RAISE EXCEPTION 'VENTA_MONTO_INMUTABLE: El monto de una venta no se puede alterar directamente. Debe anularse la venta si tiene autorización.';
  END IF;

  -- 5. REGLA 3.3: EDICIÓN DE GASTOS CON LÍMITE dinero_max_gasto
  IF v_mov.tipo = 'gasto' THEN
    IF v_new_amount <= 0 THEN
      RAISE EXCEPTION 'MONTO_INVALIDO: el monto del gasto debe ser mayor que 0';
    END IF;

    IF v_profile.dinero_max_gasto IS NOT NULL AND v_profile.dinero_max_gasto > 0 AND v_new_amount > v_profile.dinero_max_gasto THEN
      RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) supera tu límite permitido por gasto (%)', v_new_amount, v_profile.dinero_max_gasto;
    END IF;

    v_delta := v_new_amount - v_mov.monto;

    UPDATE public.cash_movements
    SET monto = v_new_amount
    WHERE id = p_movement_id;

    UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - v_delta
    WHERE id = v_caja.id;

    v_target_tipo := 'gasto';

  -- 6. REGLA 3.4: EDICIÓN DE PAGOS Y NO PAGOS CON CONVERSIÓN
  ELSIF v_mov.tipo IN ('pago', 'nopago') THEN
    IF NOT COALESCE(v_profile.permite_modificar_pagos, false) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'PERMISO_DENEGADO: No tienes autorización para modificar pagos.';
    END IF;

    IF v_new_amount < 0 THEN
      RAISE EXCEPTION 'MONTO_INVALIDO: el monto no puede ser negativo';
    END IF;

    -- Localizar pago y factura asociada
    SELECT * INTO v_pay FROM public.payments WHERE cash_movement_id = v_mov.id LIMIT 1;
    IF v_pay.id IS NOT NULL THEN
      SELECT * INTO v_inv FROM public.invoice WHERE id = v_pay.invoice_id FOR UPDATE;
    ELSE
      SELECT * INTO v_inv FROM public.invoice WHERE v_mov.descripcion LIKE '%' || id::text || '%' LIMIT 1;
      IF v_inv.id IS NOT NULL THEN
        SELECT * INTO v_pay FROM public.payments WHERE invoice_id = v_inv.id ORDER BY payment_date DESC LIMIT 1;
      END IF;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      v_saldo_disponible := ROUND(v_inv.saldo + v_mov.monto, 2);
      IF v_new_amount > v_saldo_disponible THEN
        RAISE EXCEPTION 'MONTO_EXCEDE_SALDO: El nuevo monto (%) excede el saldo pendiente total del crédito (%)', v_new_amount, v_saldo_disponible;
      END IF;
    END IF;

    -- CASO 1: Pago se edita con monto 0 -> Se convierte automáticamente a 'nopago'
    IF v_mov.tipo = 'pago' AND v_new_amount = 0 THEN
      v_target_tipo := 'nopago';
      v_delta := -v_mov.monto;

      UPDATE public.cash_movements
      SET tipo = 'nopago',
          monto = 0,
          descripcion = REPLACE(v_mov.descripcion, 'Pago', 'No pago')
      WHERE id = p_movement_id;

      UPDATE public.cajas
      SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + v_delta
      WHERE id = v_caja.id;

      IF v_pay.id IS NOT NULL THEN
        DELETE FROM public.payments WHERE id = v_pay.id;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.invoice
        SET saldo = v_saldo_disponible,
            status = 'pendiente'
        WHERE id = v_inv.id;
      END IF;

    -- CASO 2: 'nopago' se edita con monto > 0 -> Se convierte automáticamente a 'pago'
    ELSIF v_mov.tipo = 'nopago' AND v_new_amount > 0 THEN
      v_target_tipo := 'pago';
      v_delta := v_new_amount;

      UPDATE public.cash_movements
      SET tipo = 'pago',
          monto = v_new_amount,
          descripcion = REPLACE(v_mov.descripcion, 'No pago', 'Pago')
      WHERE id = p_movement_id;

      UPDATE public.cajas
      SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + v_delta
      WHERE id = v_caja.id;

      IF v_inv.id IS NOT NULL THEN
        v_inv_nuevo_saldo := ROUND(v_inv.saldo - v_new_amount, 2);
        UPDATE public.invoice
        SET saldo = v_inv_nuevo_saldo,
            status = CASE WHEN v_inv_nuevo_saldo <= 0 THEN 'pagado' ELSE 'pendiente' END
        WHERE id = v_inv.id;

        INSERT INTO public.payments (
          invoice_id, amount, payment_date, method, cash_movement_id, client_uuid
        ) VALUES (
          v_inv.id, v_new_amount, NOW(), 'efectivo', p_movement_id, v_mov.client_uuid
        );
      END IF;

    -- CASO 3: 'pago' se edita con nuevo monto > 0
    ELSE
      v_target_tipo := 'pago';
      v_delta := v_new_amount - v_mov.monto;

      UPDATE public.cash_movements
      SET monto = v_new_amount
      WHERE id = p_movement_id;

      UPDATE public.cajas
      SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + v_delta
      WHERE id = v_caja.id;

      IF v_pay.id IS NOT NULL THEN
        UPDATE public.payments
        SET amount = v_new_amount
        WHERE id = v_pay.id;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        v_inv_nuevo_saldo := ROUND(v_inv.saldo - v_delta, 2);
        UPDATE public.invoice
        SET saldo = v_inv_nuevo_saldo,
            status = CASE WHEN v_inv_nuevo_saldo <= 0 THEN 'pagado' ELSE 'pendiente' END
        WHERE id = v_inv.id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'TIPO_NO_EDITABLE: Tipo de movimiento no soportado para edición: %', v_mov.tipo;
  END IF;

  -- 7. AUDITORÍA IDEMPOTENTE: REGISTRO ÚNICO
  IF EXISTS (
    SELECT 1 FROM public.cash_movement_audit
    WHERE id = v_audit_uuid
       OR (movement_id = p_movement_id
           AND monto_nuevo = v_new_amount
           AND tipo_nuevo = v_target_tipo
           AND ABS(EXTRACT(EPOCH FROM (created_at - v_audit_created_at))) < 10)
  ) THEN
    UPDATE public.cash_movement_audit
    SET motivo = v_audit_motivo
    WHERE id = v_audit_uuid
       OR (movement_id = p_movement_id
           AND monto_nuevo = v_new_amount
           AND tipo_nuevo = v_target_tipo
           AND ABS(EXTRACT(EPOCH FROM (created_at - v_audit_created_at))) < 10);
  ELSE
    INSERT INTO public.cash_movement_audit (
      id, movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen, created_at
    ) VALUES (
      v_audit_uuid, p_movement_id, auth.uid(), v_old_tipo, v_target_tipo, v_old_monto, v_new_amount, v_audit_motivo, 'app_movil', v_audit_created_at
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', p_movement_id,
    'audit_id', v_audit_uuid,
    'tipo', v_target_tipo,
    'monto', v_new_amount,
    'delta', v_delta
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric, text, text, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric, text, text, uuid, timestamptz) TO service_role;


-- 4. RPC CANÓNICA rpc_sync_movement_audit CON DEDUPLICACIÓN IDEMPOTENTE
CREATE OR REPLACE FUNCTION public.rpc_sync_movement_audit(
  p_movement_id    uuid,
  p_tipo_anterior  text,
  p_tipo_nuevo     text,
  p_monto_anterior numeric,
  p_monto_nuevo    numeric,
  p_motivo         text DEFAULT NULL,
  p_origen         text DEFAULT 'app_movil',
  p_created_at     timestamptz DEFAULT NULL,
  p_audit_id       uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_uuid       uuid;
  v_audit_motivo     text;
  v_audit_created_at timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE id = p_movement_id) THEN
    RETURN json_build_object('success', false, 'error', 'MOVIMIENTO_NOT_FOUND');
  END IF;

  v_audit_uuid       := COALESCE(p_audit_id, gen_random_uuid());
  v_audit_motivo     := COALESCE(NULLIF(TRIM(p_motivo), ''), 'Edición de movimiento');
  v_audit_created_at := COALESCE(p_created_at, NOW());

  -- Deduplicación idempotente: si ya fue registrado previamente por rpc_update_cash_movement
  -- o por un reintento de sync anterior, actualizar motivo sin duplicar fila
  IF EXISTS (
    SELECT 1 FROM public.cash_movement_audit
    WHERE id = v_audit_uuid
       OR (movement_id = p_movement_id
           AND monto_nuevo = p_monto_nuevo
           AND tipo_nuevo = p_tipo_nuevo
           AND ABS(EXTRACT(EPOCH FROM (created_at - v_audit_created_at))) < 10)
  ) THEN
    UPDATE public.cash_movement_audit
    SET motivo = v_audit_motivo
    WHERE id = v_audit_uuid
       OR (movement_id = p_movement_id
           AND monto_nuevo = p_monto_nuevo
           AND tipo_nuevo = p_tipo_nuevo
           AND ABS(EXTRACT(EPOCH FROM (created_at - v_audit_created_at))) < 10);

    RETURN json_build_object('success', true, 'id', v_audit_uuid, 'deduplicated', true);
  END IF;

  INSERT INTO public.cash_movement_audit (
    id,
    movement_id,
    user_id,
    tipo_anterior,
    tipo_nuevo,
    monto_anterior,
    monto_nuevo,
    motivo,
    origen,
    created_at
  ) VALUES (
    v_audit_uuid,
    p_movement_id,
    auth.uid(),
    p_tipo_anterior,
    p_tipo_nuevo,
    p_monto_anterior,
    p_monto_nuevo,
    v_audit_motivo,
    COALESCE(p_origen, 'app_movil'),
    v_audit_created_at
  )
  ON CONFLICT (id) DO UPDATE SET motivo = EXCLUDED.motivo;

  RETURN json_build_object('success', true, 'id', v_audit_uuid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_sync_movement_audit(uuid, text, text, numeric, numeric, text, text, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_sync_movement_audit(uuid, text, text, numeric, numeric, text, text, timestamptz, uuid) TO service_role;


-- 5. RPC CANÓNICA rpc_get_movement_audit CON CONSULTA DEDUPLICADA
CREATE OR REPLACE FUNCTION public.rpc_get_movement_audit(
  p_movement_id uuid
)
RETURNS TABLE (
  id             uuid,
  movement_id    uuid,
  user_id        uuid,
  user_nombre    text,
  tipo_anterior  text,
  tipo_nuevo     text,
  monto_anterior numeric,
  monto_nuevo    numeric,
  motivo         text,
  origen         text,
  created_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH distinct_audits AS (
    SELECT DISTINCT ON (a.movement_id, a.tipo_anterior, a.tipo_nuevo, a.monto_anterior, a.monto_nuevo, date_trunc('minute', a.created_at))
      a.id,
      a.movement_id,
      a.user_id,
      TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellido, '')) as user_nombre,
      a.tipo_anterior,
      a.tipo_nuevo,
      a.monto_anterior,
      a.monto_nuevo,
      CASE
        WHEN a.motivo ILIKE '%aplicaci%' THEN a.motivo
        WHEN a.motivo ILIKE '%movimiento%' THEN a.motivo
        ELSE a.motivo
      END as motivo,
      a.origen,
      a.created_at
    FROM public.cash_movement_audit a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    WHERE a.movement_id = p_movement_id
    ORDER BY a.movement_id, a.tipo_anterior, a.tipo_nuevo, a.monto_anterior, a.monto_nuevo, date_trunc('minute', a.created_at), a.created_at DESC
  )
  SELECT * FROM distinct_audits
  ORDER BY distinct_audits.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_movement_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_movement_audit(uuid) TO service_role;

