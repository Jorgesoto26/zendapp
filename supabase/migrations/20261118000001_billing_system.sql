-- ============================================================================
-- SISTEMA DE FACTURACIÓN POR ORGANIZACIÓN (ZENDA - ZENDA MANAGER)
-- Archivo: 20261118000001_billing_system.sql
-- ============================================================================

-- 1. TABLA: billing_config_global (Parámetros globales parametrizables del sistema)
CREATE TABLE IF NOT EXISTS public.billing_config_global (
  id integer PRIMARY KEY DEFAULT 1,
  precio_por_ruta_defecto numeric NOT NULL DEFAULT 40000,
  dia_facturacion integer NOT NULL DEFAULT 28,
  dias_alerta_previo integer NOT NULL DEFAULT 10,
  dias_gracia_lectura integer NOT NULL DEFAULT 10,
  dias_bloqueo_total integer NOT NULL DEFAULT 18,
  
  -- Datos bancarios oficiales de Reactiva para transferencias
  banco text NOT NULL DEFAULT 'Bancolombia',
  tipo_cuenta text NOT NULL DEFAULT 'Ahorros',
  numero_cuenta text NOT NULL DEFAULT '123-456789-00',
  titular_cuenta text NOT NULL DEFAULT 'REACTIVA S.A.S',
  nit_titular text NOT NULL DEFAULT '901.XXX.XXX-X',
  
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT chk_billing_config_global_single_row CHECK (id = 1)
);

ALTER TABLE public.billing_config_global ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_config_global_select_all" ON public.billing_config_global;
CREATE POLICY "billing_config_global_select_all" ON public.billing_config_global
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "billing_config_global_modify_soporte" ON public.billing_config_global;
CREATE POLICY "billing_config_global_modify_soporte" ON public.billing_config_global
  FOR ALL TO authenticated
  USING (public.is_soporte_superadmin())
  WITH CHECK (public.is_soporte_superadmin());

DROP POLICY IF EXISTS "billing_config_global_all_service_role" ON public.billing_config_global;
CREATE POLICY "billing_config_global_all_service_role" ON public.billing_config_global
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.billing_config_global (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- 2. TABLA: billing_config (Configuración por Organización: tarifa especial vs estándar)
CREATE TABLE IF NOT EXISTS public.billing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid UNIQUE NOT NULL REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  
  -- Control de tarifa especial
  tiene_precio_especial boolean NOT NULL DEFAULT false,
  precio_por_ruta numeric DEFAULT NULL, -- Si tiene_precio_especial=true se usa este valor; si es false, toma el global
  
  -- Datos bancarios específicos (o heredados del global)
  banco text NOT NULL DEFAULT 'Bancolombia',
  tipo_cuenta text NOT NULL DEFAULT 'Ahorros',
  numero_cuenta text NOT NULL DEFAULT '123-456789-00',
  titular_cuenta text NOT NULL DEFAULT 'REACTIVA S.A.S',
  nit_titular text NOT NULL DEFAULT '901.XXX.XXX-X',
  
  -- Parámetros de facturación específicos
  dia_facturacion integer NOT NULL DEFAULT 28,
  dias_alerta_previo integer NOT NULL DEFAULT 10,
  dias_gracia_lectura integer NOT NULL DEFAULT 10,
  dias_bloqueo_total integer NOT NULL DEFAULT 18,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Asegurar columna tiene_precio_especial si la tabla ya existía
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_config' AND column_name='tiene_precio_especial') THEN
    ALTER TABLE public.billing_config ADD COLUMN tiene_precio_especial boolean NOT NULL DEFAULT false;
  END IF;
END $$;

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
    OR public.is_soporte_user()
  );

DROP POLICY IF EXISTS "billing_config_all_soporte_superadmin" ON public.billing_config;
CREATE POLICY "billing_config_all_soporte_superadmin" ON public.billing_config
  FOR ALL TO authenticated
  USING (public.is_soporte_superadmin())
  WITH CHECK (public.is_soporte_superadmin());

DROP POLICY IF EXISTS "billing_config_all_service_role" ON public.billing_config;
CREATE POLICY "billing_config_all_service_role" ON public.billing_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- 3. TABLA: billing_invoices (Facturación mensual de organizaciones)
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
    OR public.is_soporte_user()
  );

DROP POLICY IF EXISTS "billing_invoices_modify_soporte" ON public.billing_invoices;
CREATE POLICY "billing_invoices_modify_soporte" ON public.billing_invoices
  FOR ALL TO authenticated
  USING (public.is_soporte_user())
  WITH CHECK (public.is_soporte_user());

DROP POLICY IF EXISTS "billing_invoices_all_service_role" ON public.billing_invoices;
CREATE POLICY "billing_invoices_all_service_role" ON public.billing_invoices
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- 4. POLÍTICA DE STORAGE: Bucket Evidencias para comprobantes de facturación
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    DROP POLICY IF EXISTS "Evidencias_select_soporte" ON storage.objects;
    CREATE POLICY "Evidencias_select_soporte" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'Evidencias'
        AND (
          public.is_soporte_user()
          OR auth.role() = 'authenticated'
        )
      );
  END IF;
END $$;


-- 5. FUNCIÓN AUXILIAR: Resolver organizacion_id de un usuario
DROP FUNCTION IF EXISTS public.billing_get_user_org_id(uuid);
CREATE OR REPLACE FUNCTION public.billing_get_user_org_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT p.organizacion_id INTO v_org_id
  FROM public.profiles p
  WHERE p.id = p_user_id;
  
  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;
  
  SELECT o.id INTO v_org_id
  FROM public.profiles p
  JOIN public.organizaciones o ON o.admin_id = COALESCE(p.superior_id, p.id)
  WHERE p.id = p_user_id
  LIMIT 1;
  
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


-- 6. FUNCIÓN: Generar factura mensual para una organización
-- Aplica regla: Vendedores creados en el mes en curso NO se cobran este mes sino el 28 siguiente.
-- Aplica regla de costo: Si la organización tiene precio especial, usa ese; si no, usa el global parametrizado.
DROP FUNCTION IF EXISTS public.billing_generar_factura_mensual(uuid, date);
DROP FUNCTION IF EXISTS public.billing_generar_factura_mensual(uuid);
CREATE OR REPLACE FUNCTION public.billing_generar_factura_mensual(
  p_org_id uuid,
  p_fecha_corte date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_cfg_global       RECORD;
  v_cfg_org          RECORD;
BEGIN
  -- 1. Obtener o crear configuración global
  INSERT INTO public.billing_config_global (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_cfg_global FROM public.billing_config_global WHERE id = 1;

  -- 2. Asegurar y obtener billing_config de la organización
  INSERT INTO public.billing_config (organizacion_id)
  VALUES (p_org_id)
  ON CONFLICT (organizacion_id) DO NOTHING;
  
  SELECT * INTO v_cfg_org
  FROM public.billing_config
  WHERE organizacion_id = p_org_id;

  -- 3. Resolver precio por ruta:
  -- Si tiene precio especial activo y mayor a cero, usarlo. De lo contrario, usar tarifa global.
  IF v_cfg_org.tiene_precio_especial = true AND v_cfg_org.precio_por_ruta IS NOT NULL AND v_cfg_org.precio_por_ruta > 0 THEN
    v_precio_unitario := v_cfg_org.precio_por_ruta;
  ELSE
    v_precio_unitario := COALESCE(v_cfg_global.precio_por_ruta_defecto, 40000);
  END IF;

  v_dia_fact := COALESCE(v_cfg_org.dia_facturacion, v_cfg_global.dia_facturacion, 28);
  
  -- Fecha de vencimiento fijada al día de corte del mes
  v_fecha_venc := make_date(v_anio, v_mes, LEAST(v_dia_fact, 28));
  v_inicio_mes := date_trunc('month', v_fecha_corte)::date;
  
  -- Regla: Excluir vendedores creados este mes
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
  
  -- Insertar o actualizar factura para el ciclo
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


-- 7. RPC: Obtener estado completo de facturación para la app móvil
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'No autenticado');
  END IF;

  v_org_id := public.billing_get_user_org_id(v_user_id);
  
  SELECT nombre INTO v_org_nombre FROM public.organizaciones WHERE id = v_org_id;

  INSERT INTO public.billing_config_global (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_cfg_global FROM public.billing_config_global WHERE id = 1;

  INSERT INTO public.billing_config (organizacion_id)
  VALUES (v_org_id)
  ON CONFLICT (organizacion_id) DO NOTHING;
  
  SELECT * INTO v_config
  FROM public.billing_config
  WHERE organizacion_id = v_org_id;

  IF v_config.tiene_precio_especial = true AND v_config.precio_por_ruta IS NOT NULL AND v_config.precio_por_ruta > 0 THEN
    v_precio_unitario := v_config.precio_por_ruta;
  ELSE
    v_precio_unitario := COALESCE(v_cfg_global.precio_por_ruta_defecto, 40000);
  END IF;
  
  v_dias_bloqueo := COALESCE(v_config.dias_bloqueo_total, v_cfg_global.dias_bloqueo_total, 18);

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
        IF (v_vencimiento - v_hoy) <= COALESCE(v_config.dias_alerta_previo, 10) THEN
          v_billing_status := 'alerta_previa';
        ELSE
          v_billing_status := 'al_dia';
        END IF;
        v_is_read_only := false;
        v_is_suspended := false;
      ELSE
        IF v_dias_mora <= COALESCE(v_config.dias_gracia_lectura, 10) THEN
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
    'config', json_build_object(
      'banco', COALESCE(v_config.banco, v_cfg_global.banco),
      'tipo_cuenta', COALESCE(v_config.tipo_cuenta, v_cfg_global.tipo_cuenta),
      'numero_cuenta', COALESCE(v_config.numero_cuenta, v_cfg_global.numero_cuenta),
      'titular_cuenta', COALESCE(v_config.titular_cuenta, v_cfg_global.titular_cuenta),
      'nit_titular', COALESCE(v_config.nit_titular, v_cfg_global.nit_titular),
      'precio_por_ruta', v_precio_unitario,
      'tiene_precio_especial', COALESCE(v_config.tiene_precio_especial, false),
      'dia_facturacion', COALESCE(v_config.dia_facturacion, v_cfg_global.dia_facturacion),
      'dias_gracia_lectura', COALESCE(v_config.dias_gracia_lectura, v_cfg_global.dias_gracia_lectura),
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


-- 8. RPC: Confirmar pago por parte del Administrador (Zendapp)
DROP FUNCTION IF EXISTS public.billing_confirmar_pago(uuid, text, text);
CREATE OR REPLACE FUNCTION public.billing_confirmar_pago(
  p_invoice_id uuid,
  p_referencia text DEFAULT NULL,
  p_comprobante_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- 9. RPC: Validación / Aprobación desde Zenda Manager
DROP FUNCTION IF EXISTS public.billing_validar_pago_manager(uuid, boolean, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.billing_validar_pago_manager(uuid, boolean, text, text);
CREATE OR REPLACE FUNCTION public.billing_validar_pago_manager(
  p_invoice_id   uuid,
  p_aprobado     boolean DEFAULT NULL,
  p_notas        text DEFAULT NULL,
  p_validador    text DEFAULT 'Zenda Manager',
  p_es_valido    boolean DEFAULT NULL,
  p_validador_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_aprobado     boolean;
  v_validador    text;
  v_nuevo_estado text;
BEGIN
  v_aprobado := COALESCE(p_aprobado, p_es_valido, false);
  v_validador := COALESCE(p_validador, p_validador_id, 'Zenda Manager');

  IF v_aprobado THEN
    v_nuevo_estado := 'pagado';
  ELSE
    v_nuevo_estado := 'pendiente';
  END IF;

  UPDATE public.billing_invoices
  SET
    estado = v_nuevo_estado,
    fecha_validacion = now(),
    validado_por = v_validador,
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

GRANT EXECUTE ON FUNCTION public.billing_validar_pago_manager(uuid, boolean, text, text, boolean, text) TO authenticated, service_role;


-- 10. RPC: Bandeja de Aprobaciones para Zenda Manager (billing_get_pending_approvals)
DROP FUNCTION IF EXISTS public.billing_get_pending_approvals();
CREATE OR REPLACE FUNCTION public.billing_get_pending_approvals()
RETURNS TABLE (
  invoice_id uuid,
  periodo_mes integer,
  periodo_anio integer,
  num_vendedores integer,
  precio_unitario numeric,
  total numeric,
  estado text,
  comprobante_url text,
  referencia_pago text,
  fecha_confirmacion_cliente timestamptz,
  organizacion_id uuid,
  organizacion_nombre text,
  admin_nombre text,
  admin_email text,
  admin_telefono text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT 
    i.id AS invoice_id,
    i.periodo_mes,
    i.periodo_anio,
    i.num_vendedores,
    i.precio_unitario,
    i.total,
    i.estado,
    i.comprobante_url,
    i.referencia_pago,
    i.fecha_confirmacion_cliente,
    o.id AS organizacion_id,
    o.nombre AS organizacion_nombre,
    TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellido, '')) AS admin_nombre,
    COALESCE(au.email, o.email_contacto, '')::text AS admin_email,
    COALESCE(au.phone, o.telefono, '')::text AS admin_telefono
  FROM public.billing_invoices i
  JOIN public.organizaciones o ON o.id = i.organizacion_id
  LEFT JOIN public.profiles p ON p.id = o.admin_id
  LEFT JOIN auth.users au ON au.id = o.admin_id
  WHERE i.estado = 'confirmado_cliente'
  ORDER BY i.fecha_confirmacion_cliente ASC;
$$;

GRANT EXECUTE ON FUNCTION public.billing_get_pending_approvals() TO authenticated, service_role;


-- 11. RPC: Estado global de Facturación de Organizaciones para Zenda Manager
-- Incluye tarifa_ruta real (especial o estándar global) y flag tiene_precio_especial
DROP FUNCTION IF EXISTS public.billing_get_all_organizations_status();
CREATE OR REPLACE FUNCTION public.billing_get_all_organizations_status()
RETURNS TABLE (
  organizacion_id uuid,
  organizacion_nombre text,
  fecha_registro timestamptz,
  admin_nombre text,
  admin_email text,
  admin_telefono text,
  rutas_activas bigint,
  tarifa_ruta numeric,
  tiene_precio_especial boolean,
  factura_id uuid,
  factura_total numeric,
  factura_estado text,
  comprobante_url text,
  fecha_corte date,
  billing_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT 
    o.id AS organizacion_id,
    o.nombre AS organizacion_nombre,
    o.created_at AS fecha_registro,
    TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellido, '')) AS admin_nombre,
    COALESCE(au.email, o.email_contacto, '')::text AS admin_email,
    COALESCE(au.phone, o.telefono, '')::text AS admin_telefono,
    COUNT(v.id) FILTER (WHERE v.activo = true) AS rutas_activas,
    CASE 
      WHEN bc.tiene_precio_especial = true AND bc.precio_por_ruta IS NOT NULL AND bc.precio_por_ruta > 0 THEN bc.precio_por_ruta
      ELSE COALESCE(bg.precio_por_ruta_defecto, 40000)
    END AS tarifa_ruta,
    COALESCE(bc.tiene_precio_especial, false) AS tiene_precio_especial,
    i.id AS factura_id,
    i.total AS factura_total,
    i.estado AS factura_estado,
    i.comprobante_url,
    i.fecha_vencimiento AS fecha_corte,
    CASE 
      WHEN i.estado = 'pagado' THEN 'al_dia'
      WHEN i.estado = 'confirmado_cliente' THEN 'en_revision'
      WHEN i.fecha_vencimiento IS NOT NULL AND CURRENT_DATE > (i.fecha_vencimiento + 18) THEN 'suspendido'
      WHEN i.fecha_vencimiento IS NOT NULL AND CURRENT_DATE > (i.fecha_vencimiento + 10) THEN 'mora_critica'
      WHEN i.fecha_vencimiento IS NOT NULL AND CURRENT_DATE > i.fecha_vencimiento THEN 'gracia_lectura'
      WHEN i.fecha_vencimiento IS NOT NULL AND CURRENT_DATE >= (i.fecha_vencimiento - 10) THEN 'alerta_previa'
      ELSE 'al_dia'
    END AS billing_status
  FROM public.organizaciones o
  LEFT JOIN public.profiles p ON p.id = o.admin_id
  LEFT JOIN auth.users au ON au.id = o.admin_id
  LEFT JOIN public.profiles v ON (v.organizacion_id = o.id OR v.superior_id = o.admin_id) AND v.rol = 'vendedor'
  LEFT JOIN public.billing_config bc ON bc.organizacion_id = o.id
  CROSS JOIN (
    SELECT precio_por_ruta_defecto FROM public.billing_config_global WHERE id = 1 LIMIT 1
  ) bg
  LEFT JOIN LATERAL (
    SELECT * FROM public.billing_invoices bi
    WHERE bi.organizacion_id = o.id
    ORDER BY bi.fecha_vencimiento DESC
    LIMIT 1
  ) i ON true
  GROUP BY 
    o.id, 
    o.nombre, 
    o.created_at, 
    p.nombre, 
    p.apellido, 
    au.email, 
    o.email_contacto, 
    au.phone, 
    o.telefono, 
    bc.tiene_precio_especial,
    bc.precio_por_ruta,
    bg.precio_por_ruta_defecto,
    i.id, 
    i.total, 
    i.estado, 
    i.comprobante_url, 
    i.fecha_vencimiento
  ORDER BY o.nombre ASC;
$$;

GRANT EXECUTE ON FUNCTION public.billing_get_all_organizations_status() TO authenticated, service_role;


-- 12. RPCs: Consultar y Actualizar Parámetros Globales de Facturación
DROP FUNCTION IF EXISTS public.billing_get_global_config();
CREATE OR REPLACE FUNCTION public.billing_get_global_config()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT row_to_json(bg)
  FROM public.billing_config_global bg
  WHERE bg.id = 1
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.billing_get_global_config() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.billing_update_global_config(numeric, integer, integer, integer, integer, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.billing_update_global_config(
  p_precio_por_ruta numeric,
  p_dia_facturacion integer DEFAULT 28,
  p_dias_alerta_previo integer DEFAULT 10,
  p_dias_gracia_lectura integer DEFAULT 10,
  p_dias_bloqueo_total integer DEFAULT 18,
  p_banco text DEFAULT 'Bancolombia',
  p_tipo_cuenta text DEFAULT 'Ahorros',
  p_numero_cuenta text DEFAULT '123-456789-00',
  p_titular_cuenta text DEFAULT 'REACTIVA S.A.S',
  p_nit_titular text DEFAULT '901.XXX.XXX-X'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_rec RECORD;
BEGIN
  IF NOT public.is_soporte_superadmin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo los Superadministradores de Zenda Manager pueden modificar los parámetros globales de facturación';
  END IF;

  INSERT INTO public.billing_config_global (
    id,
    precio_por_ruta_defecto,
    dia_facturacion,
    dias_alerta_previo,
    dias_gracia_lectura,
    dias_bloqueo_total,
    banco,
    tipo_cuenta,
    numero_cuenta,
    titular_cuenta,
    nit_titular,
    updated_at
  ) VALUES (
    1,
    p_precio_por_ruta,
    COALESCE(p_dia_facturacion, 28),
    COALESCE(p_dias_alerta_previo, 10),
    COALESCE(p_dias_gracia_lectura, 10),
    COALESCE(p_dias_bloqueo_total, 18),
    COALESCE(p_banco, 'Bancolombia'),
    COALESCE(p_tipo_cuenta, 'Ahorros'),
    COALESCE(p_numero_cuenta, '123-456789-00'),
    COALESCE(p_titular_cuenta, 'REACTIVA S.A.S'),
    COALESCE(p_nit_titular, '901.XXX.XXX-X'),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    precio_por_ruta_defecto = EXCLUDED.precio_por_ruta_defecto,
    dia_facturacion = EXCLUDED.dia_facturacion,
    dias_alerta_previo = EXCLUDED.dias_alerta_previo,
    dias_gracia_lectura = EXCLUDED.dias_gracia_lectura,
    dias_bloqueo_total = EXCLUDED.dias_bloqueo_total,
    banco = EXCLUDED.banco,
    tipo_cuenta = EXCLUDED.tipo_cuenta,
    numero_cuenta = EXCLUDED.numero_cuenta,
    titular_cuenta = EXCLUDED.titular_cuenta,
    nit_titular = EXCLUDED.nit_titular,
    updated_at = now()
  RETURNING * INTO v_rec;

  RETURN row_to_json(v_rec);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.billing_update_global_config(numeric, integer, integer, integer, integer, text, text, text, text, text) TO authenticated, service_role;

-- 8. PREFERENCIA DE IDIOMA POR USUARIO (i18n: es, en, pt)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS idioma text DEFAULT 'es';

