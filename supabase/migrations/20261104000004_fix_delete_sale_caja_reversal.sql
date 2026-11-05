-- =====================================================================
-- MIGRACIÓN: 20261104000004_fix_delete_sale_caja_reversal.sql
-- Corrección de Anulación de Ventas en Caja:
--
-- PROBLEMA IDENTIFICADO:
-- Al anular una venta sin abonos, rpc_delete_sale ejecutaba dos acciones contradictorias:
-- 1. Insertaba un movimiento 'ingreso' por el monto de la venta (+200.000).
-- 2. Eliminaba el movimiento 'venta' original (-200.000).
-- Al eliminarse el egreso (-200.000) y agregarse un nuevo ingreso (+200.000),
-- el saldo de caja quedaba duplicado (+400.000 relativo: 150.000 + 200.000 = 350.000).
--
-- SOLUCIÓN:
-- Al eliminar el movimiento de venta (egreso), el dinero queda restituido automáticamente
-- al balance de la caja. No debe crearse ningún movimiento de 'ingreso' fantasma.
-- El saldo final se recalcula con _calc_caja_saldo_actual() con precisión matemática.
-- =====================================================================

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
  v_nuevo_saldo       numeric;
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

  -- 5. Marcar factura y cuotas como canceladas
  UPDATE public.invoice
  SET status = 'cancelada', saldo = 0
  WHERE id = p_invoice_id;

  UPDATE public.cuotas
  SET estado = 'cancelada'
  WHERE invoice_id = p_invoice_id;

  -- 6. Eliminar el movimiento de venta original de cash_movements
  -- (Al eliminar el egreso de la venta, la salida de dinero desaparece y el saldo se restaura limpiamente)
  IF v_mov_id IS NOT NULL THEN
    DELETE FROM public.cash_movements WHERE id = v_mov_id;
  END IF;

  -- 7. Recalcular el saldo exacto de la caja abierta
  IF v_caja_id IS NOT NULL THEN
    SELECT estado INTO v_caja_estado FROM public.cajas WHERE id = v_caja_id;
    IF v_caja_estado = 'abierta' THEN
      v_nuevo_saldo := public._calc_caja_saldo_actual(v_caja_id);
      UPDATE public.cajas
      SET saldo_final = v_nuevo_saldo
      WHERE id = v_caja_id;
    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id_factura', p_invoice_id,
    'monto_revertido', COALESCE(v_capital, 0),
    'saldo_caja', v_nuevo_saldo
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_sale(uuid, text) TO authenticated, service_role;

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

GRANT EXECUTE ON FUNCTION public.rpc_cancel_sale(uuid, text) TO authenticated, service_role;

-- 8. Depurar cualquier movimiento residual de reversión generado previamente
DELETE FROM public.cash_movements
WHERE tipo = 'ingreso' AND descripcion LIKE 'Reversión anulación venta %';

-- 9. Sincronizar saldos de todas las cajas abiertas activas
UPDATE public.cajas c
SET saldo_final = public._calc_caja_saldo_actual(c.id)
WHERE c.estado = 'abierta';

