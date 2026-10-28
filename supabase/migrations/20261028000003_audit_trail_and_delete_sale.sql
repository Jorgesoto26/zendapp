-- =====================================================================
-- ZENDA - MIGRACIÓN: Trazabilidad / Auditoría, Edición de Movimientos y Delete Sale
-- Fecha: 2026-10-28
-- =====================================================================

-- 1. TABLA DE AUDITORÍA DE MOVIMIENTOS DE CAJA
CREATE TABLE IF NOT EXISTS public.cash_movement_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id     uuid NOT NULL REFERENCES public.cash_movements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id),
  tipo_anterior   text,
  tipo_nuevo      text,
  monto_anterior  numeric,
  monto_nuevo     numeric,
  motivo          text,
  origen          text DEFAULT 'app_movil', -- 'app_movil', 'panel_admin', 'sincronizacion'
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_movement_id ON public.cash_movement_audit(movement_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.cash_movement_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.cash_movement_audit(created_at DESC);

-- Habilitar RLS
ALTER TABLE public.cash_movement_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_policy" ON public.cash_movement_audit;
CREATE POLICY "audit_select_policy" ON public.cash_movement_audit
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_same_hierarchy(user_id)
  );

DROP POLICY IF EXISTS "audit_insert_policy" ON public.cash_movement_audit;
CREATE POLICY "audit_insert_policy" ON public.cash_movement_audit
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );


-- 2. RPC PARA SINCRONIZAR AUDITORÍA DE MOVIMIENTOS GENERADA OFFLINE
CREATE OR REPLACE FUNCTION public.rpc_sync_movement_audit(
  p_movement_id   uuid,
  p_tipo_anterior text,
  p_tipo_nuevo    text,
  p_monto_anterior numeric,
  p_monto_nuevo   numeric,
  p_motivo        text DEFAULT NULL,
  p_origen        text DEFAULT 'app_movil',
  p_created_at    timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_id uuid;
BEGIN
  -- Validar que el movimiento exista
  IF NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE id = p_movement_id) THEN
    RETURN json_build_object('success', false, 'error', 'MOVIMIENTO_NOT_FOUND');
  END IF;

  INSERT INTO public.cash_movement_audit (
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
    p_movement_id,
    auth.uid(),
    p_tipo_anterior,
    p_tipo_nuevo,
    p_monto_anterior,
    p_monto_nuevo,
    p_motivo,
    COALESCE(p_origen, 'app_movil'),
    COALESCE(p_created_at, NOW())
  )
  RETURNING id INTO v_audit_id;

  RETURN json_build_object('success', true, 'id', v_audit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_sync_movement_audit(uuid, text, text, numeric, numeric, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_sync_movement_audit(uuid, text, text, numeric, numeric, text, text, timestamptz) TO service_role;


-- 3. RPC PARA CONSULTAR HISTORIAL DE AUDITORÍA DE UN MOVIMIENTO
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
  SELECT
    a.id,
    a.movement_id,
    a.user_id,
    TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellido, '')) as user_nombre,
    a.tipo_anterior,
    a.tipo_nuevo,
    a.monto_anterior,
    a.monto_nuevo,
    a.motivo,
    a.origen,
    a.created_at
  FROM public.cash_movement_audit a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE a.movement_id = p_movement_id
  ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_movement_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_movement_audit(uuid) TO service_role;


-- 4. ELIMINAR SOBRECARGAS PREVIAS DE rpc_update_cash_movement
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'rpc_update_cash_movement'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;


-- 5. RPC CANÓNICA rpc_update_cash_movement CON REGLAS ESTRICTAS DE NEGOCIO Y AUDITORÍA
CREATE OR REPLACE FUNCTION public.rpc_update_cash_movement(
  p_movement_id uuid,
  p_descripcion text,
  p_monto       numeric,
  p_tipo        text DEFAULT NULL,
  p_motivo      text DEFAULT NULL
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
BEGIN
  v_new_amount := ROUND(p_monto, 2);

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

    -- Ajustar caja (los gastos restan saldo de la caja)
    UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - v_delta
    WHERE id = v_caja.id;

    -- Auditoría
    INSERT INTO public.cash_movement_audit (
      movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen
    ) VALUES (
      p_movement_id, auth.uid(), 'gasto', 'gasto', v_old_monto, v_new_amount, p_motivo, 'app_movil'
    );

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
      -- Buscar factura referenciada en la descripción
      SELECT * INTO v_inv FROM public.invoice WHERE v_mov.descripcion LIKE '%' || id::text || '%' LIMIT 1;
      IF v_inv.id IS NOT NULL THEN
        SELECT * INTO v_pay FROM public.payments WHERE invoice_id = v_inv.id ORDER BY payment_date DESC LIMIT 1;
      END IF;
    END IF;

    -- Validar que no supere el saldo pendiente más el pago actual
    IF v_inv.id IS NOT NULL THEN
      v_saldo_disponible := ROUND(v_inv.saldo + v_mov.monto, 2);
      IF v_new_amount > v_saldo_disponible THEN
        RAISE EXCEPTION 'MONTO_EXCEDE_SALDO: El nuevo monto (%) excede el saldo pendiente total del crédito (%)', v_new_amount, v_saldo_disponible;
      END IF;
    END IF;

    -- CASO 1: Pago se edita con monto 0 -> Se convierte automáticamente a 'nopago'
    IF v_mov.tipo = 'pago' AND v_new_amount = 0 THEN
      v_target_tipo := 'nopago';
      v_delta := -v_mov.monto; -- Se resta del total ingresado en caja

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

      INSERT INTO public.cash_movement_audit (
        movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen
      ) VALUES (
        p_movement_id, auth.uid(), 'pago', 'nopago', v_old_monto, 0, p_motivo, 'app_movil'
      );

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

      INSERT INTO public.cash_movement_audit (
        movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen
      ) VALUES (
        p_movement_id, auth.uid(), 'nopago', 'pago', 0, v_new_amount, p_motivo, 'app_movil'
      );

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

      INSERT INTO public.cash_movement_audit (
        movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen
      ) VALUES (
        p_movement_id, auth.uid(), 'pago', 'pago', v_old_monto, v_new_amount, p_motivo, 'app_movil'
      );
    END IF;

  ELSE
    RAISE EXCEPTION 'TIPO_NO_EDITABLE: Tipo de movimiento no soportado para edición: %', v_mov.tipo;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', p_movement_id,
    'tipo', v_target_tipo,
    'monto', v_new_amount,
    'delta', v_delta
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_cash_movement(uuid, text, numeric, text, text) TO service_role;


-- 6. RPC CANÓNICA rpc_delete_sale CON VALIDACIÓN DE PERMISOS, SIN PAGOS Y REVERSIÓN DE CAJA
CREATE OR REPLACE FUNCTION public.rpc_delete_sale(
  p_invoice_id uuid,
  p_motivo     text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile           RECORD;
  v_status            text;
  v_usuario_id        uuid;
  v_capital           numeric;
  v_caja_id           uuid;
  v_caja_estado       text;
  v_pagos_count       integer;
  v_mov_id            uuid;
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
  SET status = 'cancel', saldo = 0
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
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_sale(uuid, text) TO service_role;


-- 7. ALIAS CANÓNICO rpc_cancel_sale
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
