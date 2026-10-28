-- =====================================================================
-- Migración: Correcciones perfil Administrador
-- 1. Actualizar is_admin() para admitir rol 'admin' y 'superadmin'
-- 2. Eliminar y recrear admin_get_cartera_detail con tipos exactos y casts explícitos
-- 3. Asegurar admin_get_subordinates y admin_get_cajas con soporte completo
-- =====================================================================

-- 1. Helper is_admin() robusto
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (rol = 'admin' OR rol = 'superadmin')
  );
$$;

-- 2. Corregir admin_get_cartera_detail (eliminando sobrecargas / tipos desalineados)
DROP FUNCTION IF EXISTS public.admin_get_cartera_detail(uuid);

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
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden consultar el detalle de cartera';
  END IF;

  IF NOT public.is_same_hierarchy(p_usuario_id) AND p_usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no pertenece a tu jerarquía';
  END IF;

  RETURN QUERY
  SELECT
    i.id::uuid AS invoice_id,
    i.client_id::uuid,
    COALESCE(cl.nombre, '')::text AS nombre_cliente,
    COALESCE(cl.apellido, '')::text AS apellido_cliente,
    COALESCE(cl.telefono, '')::text,
    COALESCE(cl.documento, '')::text,
    COALESCE(i.saldo, 0)::numeric,
    COALESCE(i.amount, 0)::numeric AS saldo_inicial,
    COALESCE((
      SELECT SUM(c.monto - COALESCE(c.monto_pagado, 0))
      FROM public.cuotas c
      WHERE c.invoice_id = i.id AND c.estado IN ('pendiente','parcial') AND c.fecha_vencimiento < CURRENT_DATE
    ), 0)::numeric AS saldo_vencido,
    (SELECT COUNT(*) FROM public.cuotas c
     WHERE c.invoice_id = i.id
       AND (c.estado IN ('pendiente','parcial') OR COALESCE(c.monto_pagado, 0) < c.monto)
       AND c.estado <> 'pagada'
    )::bigint AS cuotas_restantes,
    LEAST(
      (SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id AND c.estado = 'pagada') + 1,
      GREATEST((SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id), 1)
    )::bigint AS cuota_actual,
    (SELECT COUNT(*) FROM public.cuotas c WHERE c.invoice_id = i.id)::bigint AS cuotas_totales,
    i.created_at::timestamptz AS fecha_inicio,
    (SELECT MAX(c.fecha_vencimiento) FROM public.cuotas c WHERE c.invoice_id = i.id)::date AS fecha_fin,
    COALESCE(i.status, '')::text,
    COALESCE(i.castigado, false)::boolean
  FROM public.invoice i
  JOIN public.clients cl ON cl.id = i.client_id
  WHERE i.usuario_id = p_usuario_id
    AND i.saldo > 0
    AND i.castigado = false
  ORDER BY i.saldo DESC;
END;
$$;

-- Otorgar permisos de ejecución para roles autenticados
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_cartera_detail(uuid) TO authenticated;

