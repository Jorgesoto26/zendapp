-- =====================================================================
-- MIGRACIÓN: 20261104000005_fix_admin_cajas_gastos_counter.sql
-- Corrección de Contadores y Métricas en Tarjetas de Caja (Admin)
--
-- PROBLEMA IDENTIFICADO:
-- 1. admin_get_cajas calculaba valor_gastos buscando solo:
--    m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'
--    ignorando los movimientos donde m.tipo = 'gasto' (los que crea la app).
--    Por eso la tarjeta de caja mostraba "Gastos: $0" a pesar de que el vendedor
--    había registrado un gasto de $5.000 (Alimentación).
-- 2. No se incluía la columna total_movimientos en la vista de cajas, por lo
--    que la tarjeta no mostraba cuántos movimientos llevaba la caja en el día.
-- 3. admin_reporte_consolidado tenía la misma omisión para el conteo de gastos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ACTUALIZAR admin_get_cajas
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_cajas(date, date);

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
  progreso_visitas numeric,
  total_movimientos bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden consultar cajas.';
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
    -- Reconocer gastos tanto por m.tipo = 'gasto' como por m.tipo = 'retiro' con descripcion gasto
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
    COALESCE((SELECT COUNT(*) FROM public.cash_movements m WHERE m.caja_id = c.id), 0)::bigint AS total_movimientos
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

GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. ACTUALIZAR admin_reporte_consolidado
-- ---------------------------------------------------------------------
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
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden consultar reportes.';
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
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'pago'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_recaudado,
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo IN ('venta', 'renovacion')
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_ventas,
    -- Gastos reconocidos por m.tipo = 'gasto' o 'retiro' con descripcion gasto
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND (m.tipo = 'gasto' OR (m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'))
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_gastos,
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'ingreso'
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_ingresos,
    COALESCE((
      SELECT SUM(m.monto)
      FROM public.cash_movements m
      JOIN public.cajas c ON c.id = m.caja_id
      WHERE c.usuario_id = p.id
        AND m.tipo = 'retiro'
        AND (m.descripcion IS NULL OR m.descripcion NOT ILIKE '%gasto%')
        AND m.fecha::date >= p_fecha_ini
        AND m.fecha::date <= p_fecha_fin
    ), 0) AS total_retiros,
    COALESCE((
      SELECT COUNT(*)
      FROM public.payments pay
      JOIN public.invoice inv ON inv.id = pay.invoice_id
      WHERE inv.usuario_id = p.id
        AND pay.method = 'nopago'
        AND pay.payment_date >= p_fecha_ini
        AND pay.payment_date <= p_fecha_fin
    ), 0) AS total_nopagos,
    COALESCE((
      SELECT SUM(inv.saldo)
      FROM public.invoice inv
      WHERE inv.usuario_id = p.id
        AND inv.status = 'pendiente'
        AND inv.castigado = false
    ), 0) AS saldo_cartera_actual
  FROM public.profiles p
  WHERE p.id IN (SELECT id FROM all_users);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reporte_consolidado(date, date) TO authenticated, service_role;

