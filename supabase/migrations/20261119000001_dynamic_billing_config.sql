-- ============================================================================
-- DINAMISMO Y PARAMETRIZACIÓN DE DATOS DE FACTURACIÓN (ZENDA - ZENDA MANAGER)
-- Archivo: 20261119000001_dynamic_billing_config.sql
-- ============================================================================

-- 1. Modificar columnas de billing_config para que hereden por defecto (NULL) de billing_config_global
ALTER TABLE public.billing_config ALTER COLUMN banco DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN banco SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN tipo_cuenta DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN tipo_cuenta SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN numero_cuenta DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN numero_cuenta SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN titular_cuenta DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN titular_cuenta SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN nit_titular DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN nit_titular SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN dia_facturacion DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN dia_facturacion SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN dias_alerta_previo DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN dias_alerta_previo SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN dias_gracia_lectura DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN dias_gracia_lectura SET DEFAULT NULL;

ALTER TABLE public.billing_config ALTER COLUMN dias_bloqueo_total DROP NOT NULL;
ALTER TABLE public.billing_config ALTER COLUMN dias_bloqueo_total SET DEFAULT NULL;

-- 2. Limpiar registros que tengan los valores dummy/placeholder quemados previamente en billing_config
-- para que hereden automáticamente los valores configurados en Zenda Manager (billing_config_global)
UPDATE public.billing_config
SET 
  banco = NULL,
  tipo_cuenta = NULL,
  numero_cuenta = NULL,
  titular_cuenta = NULL,
  nit_titular = NULL
WHERE (banco = 'Bancolombia' AND numero_cuenta = '123-456789-00')
   OR titular_cuenta = 'REACTIVA S.A.S';

-- 3. Actualizar RPC: billing_get_organization_status
-- Retorna configuración bancaria/tarifaria viva desde BD y cálculo de rutas activas
DROP FUNCTION IF EXISTS public.billing_get_organization_status();
CREATE OR REPLACE FUNCTION public.billing_get_organization_status()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_user_id           uuid := auth.uid();
  v_org_id            uuid;
  v_org_nombre        text;
  v_org_admin_id      uuid;
  v_config            RECORD;
  v_cfg_global        RECORD;
  v_factura           RECORD;
  v_hoy               date := CURRENT_DATE;
  v_dias_mora         integer := 0;
  v_dias_restantes    integer := 0;
  v_dias_bloqueo      integer := 18;
  v_billing_status    text := 'al_dia';
  v_is_read_only      boolean := false;
  v_is_suspended      boolean := false;
  v_vencimiento       date;
  v_mes_actual        integer := EXTRACT(MONTH FROM v_hoy)::integer;
  v_anio_actual       integer := EXTRACT(YEAR FROM v_hoy)::integer;
  v_dia_actual        integer := EXTRACT(DAY FROM v_hoy)::integer;
  v_precio_unitario   numeric := 40000;
  v_num_rutas_activas integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'No autenticado');
  END IF;

  v_org_id := public.billing_get_user_org_id(v_user_id);
  
  SELECT nombre, admin_id INTO v_org_nombre, v_org_admin_id 
  FROM public.organizaciones 
  WHERE id = v_org_id;

  INSERT INTO public.billing_config_global (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_cfg_global FROM public.billing_config_global WHERE id = 1;

  INSERT INTO public.billing_config (organizacion_id)
  VALUES (v_org_id)
  ON CONFLICT (organizacion_id) DO NOTHING;
  
  SELECT * INTO v_config
  FROM public.billing_config
  WHERE organizacion_id = v_org_id;

  -- Resolver precio por ruta: especial u original global de BD
  IF v_config.tiene_precio_especial = true AND v_config.precio_por_ruta IS NOT NULL AND v_config.precio_por_ruta > 0 THEN
    v_precio_unitario := v_config.precio_por_ruta;
  ELSE
    v_precio_unitario := COALESCE(v_cfg_global.precio_por_ruta_defecto, 40000);
  END IF;
  
  v_dias_bloqueo := COALESCE(v_config.dias_bloqueo_total, v_cfg_global.dias_bloqueo_total, 18);

  -- Contar rutas activas reales de la organización
  SELECT COUNT(*)::integer INTO v_num_rutas_activas
  FROM public.profiles p
  WHERE (p.organizacion_id = v_org_id OR p.superior_id = v_org_admin_id)
    AND p.rol = 'vendedor'
    AND COALESCE(p.activo, true) = true;

  -- Si estamos en ventana de cobro y no hay factura para este ciclo, crearla
  IF v_dia_actual >= (COALESCE(v_config.dia_facturacion, v_cfg_global.dia_facturacion, 28) - COALESCE(v_config.dias_alerta_previo, v_cfg_global.dias_alerta_previo, 10)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.billing_invoices 
      WHERE organizacion_id = v_org_id AND periodo_mes = v_mes_actual AND periodo_anio = v_anio_actual
    ) THEN
      PERFORM public.billing_generar_factura_mensual(v_org_id, v_hoy);
    END IF;
  END IF;

  SELECT * INTO v_factura
  FROM public.billing_invoices
  WHERE organizacion_id = v_org_id
    AND estado IN ('pendiente', 'confirmado_cliente')
  ORDER BY fecha_vencimiento ASC
  LIMIT 1;

  IF v_factura.id IS NULL THEN
    SELECT * INTO v_factura
    FROM public.billing_invoices
    WHERE organizacion_id = v_org_id
    ORDER BY fecha_vencimiento DESC
    LIMIT 1;
  END IF;

  IF v_factura.id IS NOT NULL THEN
    v_vencimiento := v_factura.fecha_vencimiento;
    v_dias_restantes := (v_vencimiento - v_hoy)::integer;
    v_dias_mora := GREATEST(0, (v_hoy - v_vencimiento)::integer);

    IF v_factura.estado = 'pagado' THEN
      v_billing_status := 'al_dia';
      v_is_read_only := false;
      v_is_suspended := false;
    ELSIF v_factura.estado = 'confirmado_cliente' THEN
      v_billing_status := 'en_revision';
      v_is_read_only := (v_dias_mora > v_dias_bloqueo);
      v_is_suspended := (v_dias_mora > v_dias_bloqueo);
    ELSE
      IF v_hoy <= v_vencimiento THEN
        IF (v_vencimiento - v_hoy) <= COALESCE(v_config.dias_alerta_previo, v_cfg_global.dias_alerta_previo, 10) THEN
          v_billing_status := 'alerta_previa';
        ELSE
          v_billing_status := 'al_dia';
        END IF;
        v_is_read_only := false;
        v_is_suspended := false;
      ELSE
        IF v_dias_mora <= COALESCE(v_config.dias_gracia_lectura, v_cfg_global.dias_gracia_lectura, 10) THEN
          v_billing_status := 'gracia_lectura';
          v_is_read_only := true;
          v_is_suspended := false;
        ELSIF v_dias_mora <= v_dias_bloqueo THEN
          v_billing_status := 'mora_critica';
          v_is_read_only := true;
          v_is_suspended := false;
        ELSE
          v_billing_status := 'suspendido';
          v_is_read_only := true;
          v_is_suspended := true;
        END IF;
      END IF;
    END IF;
  ELSE
    v_billing_status := 'al_dia';
    v_is_read_only := false;
    v_is_suspended := false;
  END IF;

  RETURN json_build_object(
    'organizacion_id', v_org_id,
    'org_nombre', COALESCE(v_org_nombre, 'ZENDA'),
    'billing_status', v_billing_status,
    'is_read_only', v_is_read_only,
    'is_suspended', v_is_suspended,
    'dias_para_pago', v_dias_restantes,
    'dias_mora', v_dias_mora,
    'dias_para_bloqueo', GREATEST(0, v_dias_bloqueo - v_dias_mora),
    'num_rutas_activas', COALESCE(v_num_rutas_activas, 0),
    'total_estimado', (COALESCE(v_num_rutas_activas, 0) * v_precio_unitario),
    'config', json_build_object(
      'banco', COALESCE(NULLIF(v_config.banco, ''), v_cfg_global.banco, 'Bancolombia'),
      'tipo_cuenta', COALESCE(NULLIF(v_config.tipo_cuenta, ''), v_cfg_global.tipo_cuenta, 'Ahorros'),
      'numero_cuenta', COALESCE(NULLIF(v_config.numero_cuenta, ''), v_cfg_global.numero_cuenta, '123-456789-00'),
      'titular_cuenta', COALESCE(NULLIF(v_config.titular_cuenta, ''), v_cfg_global.titular_cuenta, 'REACTIVA S.A.S'),
      'nit_titular', COALESCE(NULLIF(v_config.nit_titular, ''), v_cfg_global.nit_titular, '901.XXX.XXX-X'),
      'precio_por_ruta', v_precio_unitario,
      'tiene_precio_especial', COALESCE(v_config.tiene_precio_especial, false),
      'dia_facturacion', COALESCE(v_config.dia_facturacion, v_cfg_global.dia_facturacion, 28),
      'dias_alerta_previo', COALESCE(v_config.dias_alerta_previo, v_cfg_global.dias_alerta_previo, 10),
      'dias_gracia_lectura', COALESCE(v_config.dias_gracia_lectura, v_cfg_global.dias_gracia_lectura, 10),
      'dias_bloqueo_total', v_dias_bloqueo
    ),
    'factura_actual', CASE 
      WHEN v_factura.id IS NOT NULL THEN row_to_json(v_factura)
      ELSE NULL 
    END
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_get_organization_status() TO authenticated, service_role;
