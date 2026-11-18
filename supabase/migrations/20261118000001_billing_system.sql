-- supabase/migrations/20261118000001_billing_system.sql
-- ============================================================================
-- SISTEMA DE FACTURACIÓN POR ORGANIZACIÓN (ZENDA - REACTIVA)
-- ============================================================================

-- 1. TABLA: billing_config (Configuración bancaria y parámetros de facturación)
CREATE TABLE IF NOT EXISTS public.billing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid UNIQUE NOT NULL REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  
  -- Datos bancarios de Reactiva para transferencias
  banco text NOT NULL DEFAULT 'Bancolombia',
  tipo_cuenta text NOT NULL DEFAULT 'Ahorros',
  numero_cuenta text NOT NULL DEFAULT '123-456789-00',
  titular_cuenta text NOT NULL DEFAULT 'REACTIVA S.A.S',
  nit_titular text NOT NULL DEFAULT '901.XXX.XXX-X',
  
  -- Parámetros de facturación
  precio_por_ruta numeric NOT NULL DEFAULT 40000,
  dia_facturacion integer NOT NULL DEFAULT 28,
  dias_alerta_previo integer NOT NULL DEFAULT 10,
  dias_gracia_lectura integer NOT NULL DEFAULT 10,
  dias_bloqueo_total integer NOT NULL DEFAULT 18,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_config_select_auth" ON public.billing_config;
CREATE POLICY "billing_config_select_auth" ON public.billing_config
  FOR SELECT TO authenticated
  USING (
    organizacion_id IN (
      SELECT COALESCE(p.organizacion_id, o.id)
      FROM public.profiles p
      LEFT JOIN public.organizaciones o ON o.admin_id = COALESCE(p.superior_id, p.id)
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "billing_config_all_service_role" ON public.billing_config;
CREATE POLICY "billing_config_all_service_role" ON public.billing_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- 2. TABLA: billing_invoices (Facturación mensual de organizaciones)
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  
  periodo_mes integer NOT NULL,
  periodo_anio integer NOT NULL,
  fecha_emision date NOT NULL,
  fecha_vencimiento date NOT NULL,
  
  num_vendedores integer NOT NULL DEFAULT 0,
  vendedores_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  precio_unitario numeric NOT NULL DEFAULT 40000,
  total numeric NOT NULL DEFAULT 0,
  
  -- Estados: 'pendiente' | 'confirmado_cliente' | 'pagado' | 'anulado'
  estado text NOT NULL DEFAULT 'pendiente',
  
  referencia_pago text,
  comprobante_url text,
  fecha_confirmacion_cliente timestamptz,
  
  fecha_validacion timestamptz,
  validado_por text,
  notas_admin text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT uq_billing_invoice_periodo UNIQUE (organizacion_id, periodo_anio, periodo_mes)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_org ON public.billing_invoices(organizacion_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_estado ON public.billing_invoices(estado);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_venc ON public.billing_invoices(fecha_vencimiento);

ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_invoices_select_auth" ON public.billing_invoices;
CREATE POLICY "billing_invoices_select_auth" ON public.billing_invoices
  FOR SELECT TO authenticated
  USING (
    organizacion_id IN (
      SELECT COALESCE(p.organizacion_id, o.id)
      FROM public.profiles p
      LEFT JOIN public.organizaciones o ON o.admin_id = COALESCE(p.superior_id, p.id)
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "billing_invoices_all_service_role" ON public.billing_invoices;
CREATE POLICY "billing_invoices_all_service_role" ON public.billing_invoices
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- 3. FUNCIÓN AUXILIAR: Resolver organizacion_id de un usuario
CREATE OR REPLACE FUNCTION public.billing_get_user_org_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_org_id uuid;
BEGIN
  -- 1. Buscar en profiles.organizacion_id
  SELECT p.organizacion_id INTO v_org_id
  FROM public.profiles p
  WHERE p.id = p_user_id;
  
  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;
  
  -- 2. Si es null, buscar por organizaciones.admin_id
  SELECT o.id INTO v_org_id
  FROM public.profiles p
  JOIN public.organizaciones o ON o.admin_id = COALESCE(p.superior_id, p.id)
  WHERE p.id = p_user_id
  LIMIT 1;
  
  -- 3. Si no existe organización, crear una por defecto
  IF v_org_id IS NULL THEN
    INSERT INTO public.organizaciones (
      nombre, admin_id, modo_apertura_caja
    ) VALUES (
      'ZENDA - Mi Organización', p_user_id, 'admin_masivo'
    )
    RETURNING id INTO v_org_id;
    
    UPDATE public.profiles SET organizacion_id = v_org_id WHERE id = p_user_id;
  END IF;
  
  RETURN v_org_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_get_user_org_id(uuid) TO authenticated, service_role;


-- 4. FUNCIÓN: Generar factura mensual para una organización
-- Aplica la regla: vendedores creados durante el mes en curso NO se cobran este mes,
-- sino a partir del 28 del mes siguiente.
CREATE OR REPLACE FUNCTION public.billing_generar_factura_mensual(
  p_org_id uuid,
  p_fecha_corte date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_fecha_corte      date := COALESCE(p_fecha_corte, CURRENT_DATE);
  v_mes              integer := EXTRACT(MONTH FROM v_fecha_corte)::integer;
  v_anio             integer := EXTRACT(YEAR FROM v_fecha_corte)::integer;
  v_dia_fact         integer := 28;
  v_fecha_venc       date;
  v_inicio_mes       date;
  v_precio_unitario  numeric := 40000;
  v_num_vendedores   integer := 0;
  v_vendedores_json  jsonb := '[]'::jsonb;
  v_total            numeric := 0;
  v_invoice_rec      RECORD;
BEGIN
  -- 1. Asegurar billing_config
  INSERT INTO public.billing_config (organizacion_id)
  VALUES (p_org_id)
  ON CONFLICT (organizacion_id) DO NOTHING;
  
  SELECT precio_por_ruta, dia_facturacion
  INTO v_precio_unitario, v_dia_fact
  FROM public.billing_config
  WHERE organizacion_id = p_org_id;
  
  v_dia_fact := COALESCE(v_dia_fact, 28);
  v_precio_unitario := COALESCE(v_precio_unitario, 40000);
  
  -- Fecha de vencimiento fijada al día de corte del mes
  v_fecha_venc := make_date(v_anio, v_mes, LEAST(v_dia_fact, 28));
  
  -- Regla: Excluir vendedores creados este mes
  -- Solo se facturan los vendedores creados ANTES del 1er día del mes en curso
  v_inicio_mes := date_trunc('month', v_fecha_corte)::date;
  
  SELECT 
    COUNT(*)::integer,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nombre', TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellido, '')),
          'created_at', p.created_at
        )
      ),
      '[]'::jsonb
    )
  INTO v_num_vendedores, v_vendedores_json
  FROM public.profiles p
  WHERE p.organizacion_id = p_org_id
    AND p.rol = 'vendedor'
    AND COALESCE(p.activo, true) = true
    AND p.created_at < v_inicio_mes;
    
  v_total := v_num_vendedores * v_precio_unitario;
  
  -- Insertar o actualizar factura pendiente para el ciclo
  INSERT INTO public.billing_invoices (
    organizacion_id,
    periodo_mes,
    periodo_anio,
    fecha_emision,
    fecha_vencimiento,
    num_vendedores,
    vendedores_ids,
    precio_unitario,
    total,
    estado
  ) VALUES (
    p_org_id,
    v_mes,
    v_anio,
    v_fecha_corte,
    v_fecha_venc,
    v_num_vendedores,
    v_vendedores_json,
    v_precio_unitario,
    v_total,
    'pendiente'
  )
  ON CONFLICT (organizacion_id, periodo_anio, periodo_mes) DO UPDATE
  SET
    num_vendedores = EXCLUDED.num_vendedores,
    vendedores_ids = EXCLUDED.vendedores_ids,
    precio_unitario = EXCLUDED.precio_unitario,
    total = CASE 
              WHEN billing_invoices.estado = 'pagado' THEN billing_invoices.total
              ELSE EXCLUDED.total 
            END,
    updated_at = now()
  RETURNING * INTO v_invoice_rec;
  
  RETURN row_to_json(v_invoice_rec);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_generar_factura_mensual(uuid, date) TO authenticated, service_role;


-- 5. RPC: Obtener estado completo de facturación para la app
-- Consultable por Administradores y Vendedores de la organización
CREATE OR REPLACE FUNCTION public.billing_get_organization_status()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_user_id           uuid := auth.uid();
  v_org_id            uuid;
  v_org_nombre        text;
  v_config            RECORD;
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'No autenticado');
  END IF;

  v_org_id := public.billing_get_user_org_id(v_user_id);
  
  SELECT nombre INTO v_org_nombre FROM public.organizaciones WHERE id = v_org_id;

  -- 1. Asegurar y obtener billing_config
  INSERT INTO public.billing_config (organizacion_id)
  VALUES (v_org_id)
  ON CONFLICT (organizacion_id) DO NOTHING;
  
  SELECT * INTO v_config
  FROM public.billing_config
  WHERE organizacion_id = v_org_id;
  
  v_dias_bloqueo := COALESCE(v_config.dias_bloqueo_total, 18);

  -- 2. Si estamos en ventana de facturación (día >= 18) y no existe factura para este mes, auto-generarla
  IF v_dia_actual >= (COALESCE(v_config.dia_facturacion, 28) - COALESCE(v_config.dias_alerta_previo, 10)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.billing_invoices 
      WHERE organizacion_id = v_org_id AND periodo_mes = v_mes_actual AND periodo_anio = v_anio_actual
    ) THEN
      PERFORM public.billing_generar_factura_mensual(v_org_id, v_hoy);
    END IF;
  END IF;

  -- 3. Buscar factura activa: primero buscar la pendiente o confirmada más antigua
  SELECT * INTO v_factura
  FROM public.billing_invoices
  WHERE organizacion_id = v_org_id
    AND estado IN ('pendiente', 'confirmado_cliente')
  ORDER BY fecha_vencimiento ASC
  LIMIT 1;

  -- Si no hay pendiente/confirmada, buscar la última pagada
  IF v_factura.id IS NULL THEN
    SELECT * INTO v_factura
    FROM public.billing_invoices
    WHERE organizacion_id = v_org_id
    ORDER BY fecha_vencimiento DESC
    LIMIT 1;
  END IF;

  -- 4. Calcular estado y morosidad
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
      -- Durante revisión del pago se mantiene operable si no excede los días de bloqueo
      v_is_read_only := (v_dias_mora > v_dias_bloqueo);
      v_is_suspended := (v_dias_mora > v_dias_bloqueo);
    ELSE
      -- Estado 'pendiente'
      IF v_hoy <= v_vencimiento THEN
        IF (v_vencimiento - v_hoy) <= COALESCE(v_config.dias_alerta_previo, 10) THEN
          v_billing_status := 'alerta_previa';
        ELSE
          v_billing_status := 'al_dia';
        END IF;
        v_is_read_only := false;
        v_is_suspended := false;
      ELSE
        -- Vencido
        IF v_dias_mora <= COALESCE(v_config.dias_gracia_lectura, 10) THEN
          v_billing_status := 'gracia_lectura';
          v_is_read_only := true;
          v_is_suspended := false;
        ELSIF v_dias_mora <= v_dias_bloqueo THEN
          v_billing_status := 'mora_critica';
          v_is_read_only := true;
          v_is_suspended := false;
        ELSE
          -- Superó 18 días de mora
          v_billing_status := 'suspendido';
          v_is_read_only := true;
          v_is_suspended := true;
        END IF;
      END IF;
    END IF;
  ELSE
    -- Sin facturas registradas aún
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
    'config', json_build_object(
      'banco', v_config.banco,
      'tipo_cuenta', v_config.tipo_cuenta,
      'numero_cuenta', v_config.numero_cuenta,
      'titular_cuenta', v_config.titular_cuenta,
      'nit_titular', v_config.nit_titular,
      'precio_por_ruta', v_config.precio_por_ruta,
      'dia_facturacion', v_config.dia_facturacion,
      'dias_gracia_lectura', v_config.dias_gracia_lectura,
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


-- 6. RPC: Confirmar pago por parte del Administrador
CREATE OR REPLACE FUNCTION public.billing_confirmar_pago(
  p_invoice_id uuid,
  p_referencia text DEFAULT NULL,
  p_comprobante_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_rol      text;
  v_inv_org  uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT rol, organizacion_id INTO v_rol, v_org_id
  FROM public.profiles WHERE id = v_user_id;

  IF v_rol NOT IN ('admin', 'superadmin') THEN
    RETURN json_build_object('success', false, 'error', 'Solo los administradores pueden confirmar pagos');
  END IF;

  SELECT organizacion_id INTO v_inv_org
  FROM public.billing_invoices
  WHERE id = p_invoice_id;

  IF v_inv_org IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Factura no encontrada');
  END IF;

  -- Validar que la factura pertenezca a la organización del admin
  IF v_inv_org != v_org_id AND v_rol != 'superadmin' THEN
    RETURN json_build_object('success', false, 'error', 'Acceso no autorizado a esta factura');
  END IF;

  UPDATE public.billing_invoices
  SET
    estado = 'confirmado_cliente',
    referencia_pago = COALESCE(p_referencia, referencia_pago),
    comprobante_url = COALESCE(p_comprobante_url, comprobante_url),
    fecha_confirmacion_cliente = now(),
    updated_at = now()
  WHERE id = p_invoice_id;

  RETURN json_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'estado', 'confirmado_cliente',
    'message', 'Pago confirmado exitosamente. En proceso de validación por Zenda Manager.'
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_confirmar_pago(uuid, text, text) TO authenticated, service_role;


-- 7. RPC: Validación / Aprobación desde Zenda Manager
CREATE OR REPLACE FUNCTION public.billing_validar_pago_manager(
  p_invoice_id uuid,
  p_aprobado   boolean,
  p_notas      text DEFAULT NULL,
  p_validador  text DEFAULT 'Zenda Manager'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_nuevo_estado text;
BEGIN
  IF p_aprobado THEN
    v_nuevo_estado := 'pagado';
  ELSE
    v_nuevo_estado := 'pendiente';
  END IF;

  UPDATE public.billing_invoices
  SET
    estado = v_nuevo_estado,
    fecha_validacion = now(),
    validado_por = p_validador,
    notas_admin = COALESCE(p_notas, notas_admin),
    updated_at = now()
  WHERE id = p_invoice_id;

  RETURN json_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'nuevo_estado', v_nuevo_estado
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_validar_pago_manager(uuid, boolean, text, text) TO authenticated, service_role;
