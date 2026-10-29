-- =====================================================================
-- ZENDA - MIGRACIÓN: Multimedia (Storage), Comprobantes, Plazos (D/S/M),
-- Intereses Personalizados, Pago Adelantado, Conceptos y Apertura de Cajas
-- Fecha: 2026-10-29
-- =====================================================================

-- 1. BUCKET DE SUPABASE STORAGE 'Evidencias'
-- Asegurar que el bucket 'Evidencias' exista como privado (máx 10MB por archivo)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('Evidencias', 'Evidencias', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

-- Políticas RLS sobre storage.objects para el bucket 'Evidencias'
DROP POLICY IF EXISTS "evidencias_insert_authenticated" ON storage.objects;
CREATE POLICY "evidencias_insert_authenticated" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'Evidencias');

DROP POLICY IF EXISTS "evidencias_select_authenticated" ON storage.objects;
CREATE POLICY "evidencias_select_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'Evidencias');

DROP POLICY IF EXISTS "evidencias_update_authenticated" ON storage.objects;
CREATE POLICY "evidencias_update_authenticated" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'Evidencias');

DROP POLICY IF EXISTS "evidencias_delete_authenticated" ON storage.objects;
CREATE POLICY "evidencias_delete_authenticated" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'Evidencias');


-- 2. TABLA DE ORGANIZACIONES Y PERSONALIZACIÓN DE EMPRESA
CREATE TABLE IF NOT EXISTS public.organizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  nit text,
  telefono text,
  direccion text,
  logo_path text,
  admin_id uuid REFERENCES public.profiles(id),
  modo_apertura_caja text NOT NULL DEFAULT 'admin_masivo', -- 'admin_masivo' | 'vendedor_dia'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.organizaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizaciones_select_authenticated" ON public.organizaciones;
CREATE POLICY "organizaciones_select_authenticated" ON public.organizaciones
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "organizaciones_update_admin" ON public.organizaciones;
CREATE POLICY "organizaciones_update_admin" ON public.organizaciones
  FOR UPDATE TO authenticated
  USING (admin_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "organizaciones_insert_admin" ON public.organizaciones;
CREATE POLICY "organizaciones_insert_admin" ON public.organizaciones
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Extender profiles con organizacion_id, modo_apertura_caja y updated_at
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organizacion_id uuid REFERENCES public.organizaciones(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS modo_apertura_caja text DEFAULT 'admin_masivo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();


-- 3. TABLA DE METADATOS MULTIMEDIA (EVIDENCIAS)
CREATE TABLE IF NOT EXISTS public.multimedia_evidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL DEFAULT 'Evidencias',
  file_path text NOT NULL,
  original_name text,
  mime_type text DEFAULT 'image/jpeg',
  size_original numeric,
  size_compressed numeric,
  usuario_id uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  organizacion_id uuid REFERENCES public.organizaciones(id),
  tipo_evidencia text NOT NULL, -- 'documento_identidad' | 'gasto' | 'comprobante_pago' | 'organizacion'
  tabla_relacionada text NOT NULL, -- 'clients' | 'cash_movements' | 'payments' | 'organizaciones'
  registro_id text NOT NULL, -- UUID o ID del registro asociado
  estado_sync text DEFAULT 'sincronizado',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_multimedia_registro ON public.multimedia_evidencias(registro_id);
CREATE INDEX IF NOT EXISTS idx_multimedia_tipo ON public.multimedia_evidencias(tipo_evidencia);
CREATE INDEX IF NOT EXISTS idx_multimedia_usuario ON public.multimedia_evidencias(usuario_id);

ALTER TABLE public.multimedia_evidencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "multimedia_select_authenticated" ON public.multimedia_evidencias;
CREATE POLICY "multimedia_select_authenticated" ON public.multimedia_evidencias
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "multimedia_insert_authenticated" ON public.multimedia_evidencias;
CREATE POLICY "multimedia_insert_authenticated" ON public.multimedia_evidencias
  FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated');


-- 4. COLUMNAS ADICIONALES EN INVOICE, CLIENTS Y CASH_MOVEMENTS
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS periodicidad text DEFAULT 'diario';
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS num_cuotas integer;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS tasa_interes numeric;
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS pago_adelantado boolean DEFAULT false;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS foto_documento_path text;

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS concepto_id integer REFERENCES public.concepts(id);
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS evidencia_path text;


-- 5. CATÁLOGO PARAMETRIZADO DE CONCEPTOS DE MOVIMIENTOS
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS nombre text;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS tipo_movimiento text;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS activo boolean DEFAULT true;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS orden integer DEFAULT 0;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS organizacion_id uuid REFERENCES public.organizaciones(id);

UPDATE public.concepts SET nombre = valor WHERE nombre IS NULL;

INSERT INTO public.concepts (id, tipo, valor, nombre, tipo_movimiento, activo, orden)
VALUES
  (1001, 'gasto', 'Alimentación', 'Alimentación', 'gasto', true, 1),
  (1002, 'gasto', 'Combustible', 'Combustible', 'gasto', true, 2),
  (1003, 'gasto', 'Bienestar', 'Bienestar', 'gasto', true, 3),
  (1004, 'gasto', 'Pinchazo', 'Pinchazo', 'gasto', true, 4),
  (1005, 'gasto', 'Mantenimiento', 'Mantenimiento', 'gasto', true, 5),
  (1006, 'gasto', 'Papelería', 'Papelería', 'gasto', true, 6),
  (1007, 'gasto', 'Transporte / Pasajes', 'Transporte / Pasajes', 'gasto', true, 7),
  (1008, 'gasto', 'Otros', 'Otros', 'gasto', true, 8)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  tipo_movimiento = EXCLUDED.tipo_movimiento;


-- 6. CANÓNICA CREATE_SALE CON PERIODICIDAD, PAGO ADELANTADO Y MULTIMEDIA
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
  fecha               timestamptz DEFAULT NULL,
  periodicidad        text DEFAULT 'diario',
  num_cuotas          integer DEFAULT NULL,
  tasa_interes        numeric DEFAULT NULL,
  pago_adelantado     boolean DEFAULT false,
  foto_documento      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
#variable_conflict use_column
DECLARE
  v_client_id          uuid;
  v_invoice_id         uuid;
  v_mov_id             uuid;
  v_adv_mov_id         uuid;
  v_adv_pay_id         uuid;
  v_plazo_val          text;
  v_interes_val        text;
  v_tasa               numeric;
  v_capital            numeric;
  v_interes_monto      numeric;
  v_total_factura      numeric;
  v_num_cuotas         integer;
  v_cuota_monto        numeric;
  v_cuota_resto        numeric;
  v_caja_estado        text;
  v_vendedor_ok        boolean;
  v_fecha_efectiva     timestamptz;
  v_periodo            text;
  v_interval_step      interval;
  v_fecha_venc_cuota   date;
  v_proximo_recaudo    date;
  v_monto_adelantado   numeric;
  v_saldo_inicial_inv  numeric;
  i                    integer;
BEGIN
  v_fecha_efectiva := COALESCE(create_sale.fecha, NOW());
  v_periodo := LOWER(COALESCE(create_sale.periodicidad, 'diario'));

  -- Validar periodicidad
  IF v_periodo NOT IN ('diario', 'semanal', 'mensual') THEN
    v_periodo := 'diario';
  END IF;

  -- 1. Idempotencia: si client_uuid ya existe, retornar id existente sin duplicar
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

  -- 2. Seguridad: verificar jerarquía
  IF create_sale.vendedor_id <> auth.uid() THEN
    SELECT public.is_same_hierarchy(create_sale.vendedor_id) INTO v_vendedor_ok;
    IF NOT v_vendedor_ok THEN
      RAISE EXCEPTION 'UNAUTHORIZED: no tienes permiso para crear ventas en nombre de ese vendedor';
    END IF;
  END IF;

  -- 3. Validar caja abierta
  SELECT cj.estado INTO v_caja_estado
  FROM public.cajas cj
  WHERE cj.id = create_sale.caja_id AND cj.usuario_id = create_sale.vendedor_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND: caja no encontrada o no pertenece al vendedor';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: debes abrir una caja antes de registrar una venta';
  END IF;

  -- 4. Validar monto
  IF create_sale.monto IS NULL OR create_sale.monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: el monto de la venta debe ser mayor que 0';
  END IF;

  -- 5. Cálculo de tasa de interés
  IF create_sale.tasa_interes IS NOT NULL AND create_sale.tasa_interes >= 0 THEN
    IF create_sale.tasa_interes > 1 THEN
      v_tasa := create_sale.tasa_interes / 100.0;
    ELSE
      v_tasa := create_sale.tasa_interes;
    END IF;
  ELSE
    SELECT cp.valor INTO v_interes_val
    FROM public.concepts cp WHERE cp.id = create_sale.interes_id;

    v_tasa := COALESCE(
      CASE 
        WHEN v_interes_val ~ '^\s*0\.' THEN (regexp_match(v_interes_val, '([0-9]+\.[0-9]+)'))[1]::numeric
        ELSE (regexp_match(v_interes_val, '([0-9]+(?:\.[0-9]+)?)'))[1]::numeric / 100.0
      END,
      0
    );
  END IF;

  v_capital := ROUND(create_sale.monto, 2);
  v_interes_monto := ROUND(v_capital * v_tasa, 2);
  v_total_factura := v_capital + v_interes_monto;

  -- 6. Cantidad de cuotas
  IF create_sale.num_cuotas IS NOT NULL AND create_sale.num_cuotas >= 1 AND create_sale.num_cuotas <= 90 THEN
    v_num_cuotas := create_sale.num_cuotas;
  ELSE
    SELECT cp.valor INTO v_plazo_val
    FROM public.concepts cp WHERE cp.id = create_sale.plazo_id;

    v_num_cuotas := COALESCE(
      (regexp_match(v_plazo_val, '(\d+)'))[1]::integer,
      1
    );
  END IF;

  IF v_num_cuotas < 1 THEN v_num_cuotas := 1; END IF;
  IF v_num_cuotas > 90 THEN v_num_cuotas := 90; END IF;

  v_cuota_monto := FLOOR(v_total_factura / v_num_cuotas);
  v_cuota_resto := v_total_factura - (v_cuota_monto * (v_num_cuotas - 1));

  -- 7. Cliente: buscar por documento del vendedor o crear nuevo
  SELECT cl.id INTO v_client_id
  FROM public.clients cl
  WHERE cl.documento = create_sale.documento
    AND cl.vendedor_id = create_sale.vendedor_id
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (
      nombre, apellido, alias, email, telefono, direccion, documento, vendedor_id,
      latitud, longitud, foto_documento_path
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
      create_sale.longitud,
      create_sale.foto_documento
    )
    RETURNING clients.id INTO v_client_id;
  ELSE
    UPDATE public.clients AS cl SET
      nombre              = create_sale.nombre,
      apellido            = create_sale.apellido,
      alias               = create_sale.alias,
      email               = COALESCE(NULLIF(create_sale.email, ''), cl.email),
      telefono            = COALESCE(NULLIF(create_sale.telefono, ''), cl.telefono),
      direccion           = COALESCE(NULLIF(create_sale.direccion, ''), cl.direccion),
      latitud             = COALESCE(create_sale.latitud, cl.latitud),
      longitud            = COALESCE(create_sale.longitud, cl.longitud),
      foto_documento_path = COALESCE(create_sale.foto_documento, cl.foto_documento_path)
    WHERE cl.id = v_client_id;
  END IF;

  -- 8. Determinar saldo inicial de la factura (descontando cuota si hay pago adelantado)
  v_monto_adelantado := CASE WHEN create_sale.pago_adelantado THEN v_cuota_monto ELSE 0 END;
  v_saldo_inicial_inv := v_total_factura - v_monto_adelantado;

  -- Factura: crear con estado pendiente y registrar periodicidad, cuotas y tasa
  INSERT INTO public.invoice (
    client_id, amount, saldo, status, usuario_id, plazo_id, interes_id,
    capital_amount, interest_amount, latitud, longitud, previous_invoice_id,
    periodicidad, num_cuotas, tasa_interes, pago_adelantado, created_at
  ) VALUES (
    v_client_id,
    v_total_factura,
    v_saldo_inicial_inv,
    CASE WHEN v_saldo_inicial_inv <= 0 THEN 'pagado' ELSE 'pendiente' END,
    create_sale.vendedor_id,
    create_sale.plazo_id,
    create_sale.interes_id,
    v_capital,
    v_interes_monto,
    create_sale.latitud,
    create_sale.longitud,
    create_sale.previous_invoice_id,
    v_periodo,
    v_num_cuotas,
    ROUND(v_tasa * 100, 2),
    COALESCE(create_sale.pago_adelantado, false),
    v_fecha_efectiva
  )
  RETURNING invoice.id INTO v_invoice_id;

  -- 9. Generación de Cuotas según Periodicidad (Diario, Semanal, Mensual)
  FOR i IN 1..v_num_cuotas LOOP
    IF v_periodo = 'semanal' THEN
      v_fecha_venc_cuota := (v_fecha_efectiva::date + (i * INTERVAL '7 days'))::date;
    ELSIF v_periodo = 'mensual' THEN
      v_fecha_venc_cuota := (v_fecha_efectiva::date + (i * INTERVAL '1 month'))::date;
    ELSE
      -- diario por defecto
      v_fecha_venc_cuota := (v_fecha_efectiva::date + (i * INTERVAL '1 day'))::date;
    END IF;

    IF i = 1 THEN
      v_proximo_recaudo := v_fecha_venc_cuota;
    END IF;

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
      v_fecha_venc_cuota,
      CASE WHEN i = v_num_cuotas THEN v_cuota_resto ELSE v_cuota_monto END,
      CASE WHEN i = 1 AND create_sale.pago_adelantado THEN 'pagada' ELSE 'pendiente' END,
      CASE WHEN i = 1 AND create_sale.pago_adelantado THEN v_cuota_monto ELSE 0 END
    );
  END LOOP;

  -- 10. Movimiento de Caja de la Venta: egreso de efectivo (venta) por el monto del capital
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

  -- Actualizar Saldo de Caja: resta el capital entregado
  UPDATE public.cajas AS ca
    SET saldo_final = COALESCE(ca.saldo_final, ca.saldo_inicial, 0) - v_capital
    WHERE ca.id = create_sale.caja_id;

  -- 11. Manejo de Pago Adelantado (asociado al próximo día de recaudo)
  IF create_sale.pago_adelantado AND v_cuota_monto > 0 THEN
    -- Registrar pago imputado a la fecha del primer vencimiento
    INSERT INTO public.payments (
      invoice_id, client_id, amount, payment_date, method, client_uuid
    ) VALUES (
      v_invoice_id,
      v_client_id,
      v_cuota_monto,
      v_proximo_recaudo,
      'pago_adelantado',
      CASE WHEN create_sale.client_uuid IS NOT NULL THEN
        ('00000000-0000-4000-9000-' || SUBSTRING(create_sale.client_uuid::text, 25))::uuid
      ELSE NULL END
    )
    RETURNING id INTO v_adv_pay_id;

    -- Movimiento de pago fechado en el próximo día de recaudo
    INSERT INTO public.cash_movements (
      caja_id, tipo, descripcion, monto, fecha, client_uuid
    ) VALUES (
      create_sale.caja_id,
      'pago',
      'Pago adelantado cuota 1 - factura ' || v_invoice_id::text,
      v_cuota_monto,
      (v_proximo_recaudo::text || ' 08:00:00')::timestamptz,
      CASE WHEN create_sale.client_uuid IS NOT NULL THEN
        ('00000000-0000-4000-9000-' || SUBSTRING(create_sale.client_uuid::text, 25))::uuid
      ELSE NULL END
    )
    RETURNING id INTO v_adv_mov_id;
  END IF;

  RETURN json_build_object(
    'success',            true,
    'id_factura',         v_invoice_id,
    'id_cliente',         v_client_id,
    'id_movimiento',      v_mov_id,
    'capital',            v_capital,
    'interes',            v_interes_monto,
    'total_factura',      v_total_factura,
    'periodicidad',       v_periodo,
    'num_cuotas',         v_num_cuotas,
    'pago_adelantado',    create_sale.pago_adelantado,
    'monto_adelantado',   v_monto_adelantado,
    'proximo_recaudo',    v_proximo_recaudo,
    'es_cliente_nuevo',   v_client_id IS NOT NULL
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_sale(text, text, text, text, text, text, text, numeric, uuid, uuid, integer, integer, uuid, numeric, numeric, uuid, timestamptz, text, integer, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(text, text, text, text, text, text, text, numeric, uuid, uuid, integer, integer, uuid, numeric, numeric, uuid, timestamptz, text, integer, numeric, boolean, text) TO service_role;


-- 7. ACTUALIZAR RPC_CREATE_CASH_MOVEMENT PARA SOPORTAR CONCEPTO Y EVIDENCIA
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
  p_caja_id        uuid,
  p_tipo           text,
  p_descripcion    text,
  p_monto          numeric,
  p_client_uuid    uuid DEFAULT NULL,
  p_fecha          timestamptz DEFAULT NULL,
  p_concepto_id    integer DEFAULT NULL,
  p_evidencia_path text DEFAULT NULL
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

  -- 2. Validar usuario activo y límite de gasto
  SELECT activo, dinero_max_gasto, TRIM(COALESCE(nombre, '') || ' ' || COALESCE(apellido, ''))
  INTO v_activo, v_max_gasto, v_user_nombre
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  IF (p_tipo = 'retiro' OR p_tipo = 'gasto') AND v_max_gasto IS NOT NULL AND v_max_gasto > 0 AND p_monto > v_max_gasto THEN
    RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) excede tu límite permitido por gasto (%)', p_monto, v_max_gasto;
  END IF;

  -- 3. Validar caja abierta
  SELECT estado, usuario_id, admin_caja_id
  INTO v_caja_estado, v_caja_usuario_id, v_admin_caja_id
  FROM public.cajas WHERE id = p_caja_id FOR UPDATE;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: La caja debe estar abierta para registrar movimientos';
  END IF;

  -- 4. Insertar movimiento en la caja principal
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid, external_caja_id, fecha,
    concepto_id, evidencia_path
  ) VALUES (
    p_caja_id, p_tipo, p_descripcion, ROUND(p_monto, 2), p_client_uuid, v_admin_caja_id, v_fecha_efectiva,
    p_concepto_id, p_evidencia_path
  )
  RETURNING id INTO v_mov_id;

  -- 5. Actualizar saldo_final de la caja principal
  IF p_tipo = 'ingreso' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ROUND(p_monto, 2) WHERE id = p_caja_id;
  ELSIF p_tipo = 'retiro' OR p_tipo = 'gasto' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ROUND(p_monto, 2) WHERE id = p_caja_id;
  END IF;

  -- 6. Movimiento Espejo con la Caja del Admin (si aplica)
  IF v_admin_caja_id IS NOT NULL AND v_admin_caja_id <> p_caja_id THEN
    SELECT estado INTO v_admin_caja_estado FROM public.cajas WHERE id = v_admin_caja_id;
    IF v_admin_caja_estado = 'abierta' THEN
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
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'monto', p_monto,
    'fecha', v_fecha_efectiva,
    'concepto_id', p_concepto_id,
    'evidencia_path', p_evidencia_path
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid, timestamptz, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid, timestamptz, integer, text) TO service_role;

-- 7.1 ACTUALIZACIÓN ROBUSTA DE USUARIO (ADMIN_UPDATE_USER)
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id                 uuid,
  p_nombre                  text,
  p_apellido                text,
  p_dinero_max_caja         numeric DEFAULT NULL,
  p_dinero_max_venta        numeric DEFAULT NULL,
  p_dinero_max_gasto        numeric DEFAULT NULL,
  p_max_cuotas              integer DEFAULT NULL,
  p_permite_borrar_venta    boolean DEFAULT NULL,
  p_permite_modificar_pagos boolean DEFAULT NULL,
  p_password                text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden editar usuarios';
  END IF;

  IF NOT public.is_same_hierarchy(p_user_id) AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no pertenece a tu jerarquía';
  END IF;

  UPDATE public.profiles
  SET
    nombre                  = p_nombre,
    apellido                = p_apellido,
    dinero_max_caja         = COALESCE(p_dinero_max_caja, dinero_max_caja),
    dinero_max_venta        = COALESCE(p_dinero_max_venta, dinero_max_venta),
    dinero_max_gasto        = COALESCE(p_dinero_max_gasto, dinero_max_gasto),
    max_cuotas              = COALESCE(p_max_cuotas, max_cuotas),
    permite_borrar_venta    = COALESCE(p_permite_borrar_venta, permite_borrar_venta),
    permite_modificar_pagos = COALESCE(p_permite_modificar_pagos, permite_modificar_pagos),
    updated_at              = now()
  WHERE id = p_user_id;

  -- Actualizar contraseña en auth.users si se proporcionó una nueva válida
  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO service_role;

-- 7.2 REAPERTURA DE CAJA POR ADMINISTRADOR (ADMIN_REABRIR_CAJA)
CREATE OR REPLACE FUNCTION public.admin_reabrir_caja(
  p_caja_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_caja          record;
  v_otra_abierta  boolean;
  v_user_rol      text;
  v_superior_id   uuid;
  v_padre_id      uuid;
  v_padre_abierto boolean := false;
BEGIN
  -- Validar que quien invoca sea administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo los administradores pueden reabrir cajas';
  END IF;

  -- Obtener datos de la caja
  SELECT id, usuario_id, estado, saldo_inicial, fecha_apertura
  INTO v_caja
  FROM public.cajas
  WHERE id = p_caja_id;

  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NO_ENCONTRADA: La caja especificada no existe';
  END IF;

  -- Validar jerarquía: la caja debe pertenecer a su equipo
  IF NOT public.is_same_hierarchy(v_caja.usuario_id) AND v_caja.usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: La caja no pertenece a un usuario de tu equipo';
  END IF;

  -- Verificar que la caja esté cerrada
  IF v_caja.estado = 'abierta' THEN
    RAISE EXCEPTION 'CAJA_YA_ABIERTA: Esta caja ya se encuentra abierta';
  END IF;

  -- Validar si la caja pertenece a un vendedor: la caja padre (del administrador) DEBE estar ABIERTA
  SELECT rol, superior_id INTO v_user_rol, v_superior_id
  FROM public.profiles
  WHERE id = v_caja.usuario_id;

  IF v_user_rol = 'vendedor' OR (v_caja.usuario_id <> auth.uid()) THEN
    v_padre_id := COALESCE(v_superior_id, auth.uid());
    SELECT EXISTS(
      SELECT 1 FROM public.cajas
      WHERE usuario_id = v_padre_id
        AND estado = 'abierta'
    ) INTO v_padre_abierto;

    IF NOT v_padre_abierto THEN
      RAISE EXCEPTION 'CAJA_PADRE_CERRADA: No se puede reabrir la caja del vendedor porque la caja padre del administrador se encuentra cerrada. Debes abrir primero la caja del administrador.';
    END IF;
  END IF;

  -- Verificar que el usuario no tenga OTRA caja abierta actualmente
  SELECT EXISTS(
    SELECT 1 FROM public.cajas
    WHERE usuario_id = v_caja.usuario_id
      AND estado = 'abierta'
      AND id <> p_caja_id
  ) INTO v_otra_abierta;

  IF v_otra_abierta THEN
    RAISE EXCEPTION 'USUARIO_CON_CAJA_ABIERTA: El usuario ya tiene otra caja abierta actualmente. Debe cerrarla antes de reabrir esta.';
  END IF;

  -- Reabrir la caja
  UPDATE public.cajas
  SET estado = 'abierta',
      fecha_cierre = NULL,
      saldo_final = NULL
  WHERE id = p_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'usuario_id', v_caja.usuario_id,
    'estado', 'abierta',
    'fecha_apertura', v_caja.fecha_apertura
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO service_role;

-- 8. GESTIÓN DE ORGANIZACIÓN / LOGO (ADMIN)
CREATE OR REPLACE FUNCTION public.admin_get_organizacion()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_admin_id uuid;
  v_org      RECORD;
BEGIN
  -- Determinar el admin correspondiente
  SELECT COALESCE(p.superior_id, p.id) INTO v_admin_id
  FROM public.profiles p WHERE p.id = auth.uid();

  SELECT * INTO v_org
  FROM public.organizaciones o
  WHERE o.admin_id = v_admin_id
  LIMIT 1;

  IF v_org.id IS NULL THEN
    -- Crear organización por defecto si no existe aún
    INSERT INTO public.organizaciones (
      nombre, admin_id, modo_apertura_caja
    ) VALUES (
      'ZENDA - Mi Organización', v_admin_id, 'admin_masivo'
    )
    RETURNING * INTO v_org;
  END IF;

  RETURN row_to_json(v_org);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_get_organizacion() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_organizacion(
  p_nombre        text,
  p_nit           text,
  p_telefono      text,
  p_direccion     text,
  p_logo_path     text,
  p_modo_apertura text DEFAULT 'admin_masivo'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_admin_id uuid;
  v_org_id   uuid;
  v_modo     text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden gestionar la organización';
  END IF;

  v_admin_id := auth.uid();
  v_modo := CASE WHEN p_modo_apertura IN ('admin_masivo', 'vendedor_dia') THEN p_modo_apertura ELSE 'admin_masivo' END;

  SELECT id INTO v_org_id FROM public.organizaciones WHERE admin_id = v_admin_id;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizaciones (
      nombre, nit, telefono, direccion, logo_path, admin_id, modo_apertura_caja
    ) VALUES (
      p_nombre, p_nit, p_telefono, p_direccion, p_logo_path, v_admin_id, v_modo
    )
    RETURNING id INTO v_org_id;
  ELSE
    UPDATE public.organizaciones SET
      nombre             = COALESCE(p_nombre, nombre),
      nit                = p_nit,
      telefono           = p_telefono,
      direccion          = p_direccion,
      logo_path          = COALESCE(p_logo_path, logo_path),
      modo_apertura_caja = v_modo,
      updated_at         = now()
    WHERE id = v_org_id;
  END IF;

  -- Actualizar perfiles de los subordinados para sincronizar el modo de apertura
  UPDATE public.profiles
  SET modo_apertura_caja = v_modo,
      organizacion_id    = v_org_id
  WHERE id = v_admin_id OR superior_id = v_admin_id;

  RETURN json_build_object(
    'success', true,
    'org_id', v_org_id,
    'modo_apertura_caja', v_modo,
    'logo_path', p_logo_path
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_update_organizacion(text, text, text, text, text, text) TO authenticated;


-- 9. APERTURA DE CAJA VENDEDOR (MODO B: VENDEDOR AL CAMBIAR DE DÍA)
CREATE OR REPLACE FUNCTION public.rpc_check_or_open_vendedor_caja(
  p_vendedor_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_modo             text;
  v_caja_abierta     RECORD;
  v_ultima_caja      RECORD;
  v_nueva_caja_id    uuid;
  v_saldo_inicial    numeric := 0;
  v_max_caja         numeric;
  v_hoy_local        date;
BEGIN
  -- Calcular fecha de hoy en zona horaria de negocio (America/Bogota)
  v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;

  -- Obtener modo de apertura del perfil
  SELECT COALESCE(p.modo_apertura_caja, 'admin_masivo'), p.dinero_max_caja
  INTO v_modo, v_max_caja
  FROM public.profiles p
  WHERE p.id = p_vendedor_id;

  -- Verificar si ya existe una caja abierta para el vendedor
  SELECT * INTO v_caja_abierta
  FROM public.cajas
  WHERE usuario_id = p_vendedor_id AND estado = 'abierta'
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_caja_abierta.id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'caja', row_to_json(v_caja_abierta),
      'ya_abierta', true,
      'modo', v_modo
    );
  END IF;

  -- Si el modo es apertura masiva por admin, no permitir auto-apertura
  IF v_modo <> 'vendedor_dia' THEN
    RETURN json_build_object(
      'success', false,
      'requiere_admin', true,
      'message', 'El administrador debe abrir tu caja para iniciar la jornada.'
    );
  END IF;

  -- Modo B activo: obtener saldo final de la última caja cerrada para continuidad contable
  SELECT saldo_final INTO v_ultima_caja
  FROM public.cajas
  WHERE usuario_id = p_vendedor_id AND estado = 'cerrada'
  ORDER BY fecha_cierre DESC NULLS LAST, fecha_apertura DESC
  LIMIT 1;

  IF v_ultima_caja.saldo_final IS NOT NULL AND v_ultima_caja.saldo_final > 0 THEN
    v_saldo_inicial := v_ultima_caja.saldo_final;
  ELSE
    v_saldo_inicial := 0;
  END IF;

  IF v_max_caja IS NOT NULL AND v_max_caja > 0 AND v_saldo_inicial > v_max_caja THEN
    v_saldo_inicial := v_max_caja;
  END IF;

  INSERT INTO public.cajas (
    usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha
  ) VALUES (
    p_vendedor_id, 'abierta', v_saldo_inicial, v_saldo_inicial, now(), now()::date::text
  )
  RETURNING id INTO v_nueva_caja_id;

  SELECT * INTO v_caja_abierta FROM public.cajas WHERE id = v_nueva_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja', row_to_json(v_caja_abierta),
    'auto_abierta', true,
    'saldo_inicial', v_saldo_inicial,
    'modo', v_modo
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_vendedor_caja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_vendedor_caja(uuid) TO service_role;

