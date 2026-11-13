-- =====================================================================
-- ZENDA - MIGRACIÓN: 20261114000001_internationalization_geo_currency.sql
-- Internacionalización geográfica y monetaria multi-empresa
-- Fecha: Noviembre 2026
-- Idempotente y 100% compatible con esquemas y datos existentes
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATÁLOGO DE MONEDAS (ISO 4217)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY,
  nombre text NOT NULL,
  symbol text NOT NULL,
  decimal_digits integer NOT NULL DEFAULT 2,
  enabled boolean NOT NULL DEFAULT true
);

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "currencies_read_authenticated" ON public.currencies;
CREATE POLICY "currencies_read_authenticated" ON public.currencies
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.currencies (code, nombre, symbol, decimal_digits, enabled)
VALUES
  ('COP', 'Peso colombiano', '$', 0, true),
  ('MXN', 'Peso mexicano', '$', 2, true),
  ('PEN', 'Sol peruano', 'S/', 2, true),
  ('CLP', 'Peso chileno', '$', 0, true),
  ('BRL', 'Real brasileño', 'R$', 2, true),
  ('ARS', 'Peso argentino', '$', 2, true),
  ('USD', 'Dólar estadounidense', '$', 2, true)
ON CONFLICT (code) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  symbol = EXCLUDED.symbol,
  decimal_digits = EXCLUDED.decimal_digits,
  enabled = EXCLUDED.enabled;


-- ---------------------------------------------------------------------
-- 2. CATÁLOGO DE PAÍSES (ISO 3166-1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.countries (
  id text PRIMARY KEY, -- 'CO', 'MX', 'PE', 'CL'
  iso2 text UNIQUE NOT NULL,
  iso3 text UNIQUE NOT NULL,
  nombre text NOT NULL,
  currency_code text NOT NULL REFERENCES public.currencies(code),
  locale text NOT NULL,
  timezone_default text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "countries_read_authenticated" ON public.countries;
CREATE POLICY "countries_read_authenticated" ON public.countries
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.countries (id, iso2, iso3, nombre, currency_code, locale, timezone_default, enabled)
VALUES
  ('CO', 'CO', 'COL', 'Colombia', 'COP', 'es-CO', 'America/Bogota', true),
  ('MX', 'MX', 'MEX', 'México', 'MXN', 'es-MX', 'America/Mexico_City', true),
  ('PE', 'PE', 'PER', 'Perú', 'PEN', 'es-PE', 'America/Lima', true),
  ('CL', 'CL', 'CHL', 'Chile', 'CLP', 'es-CL', 'America/Santiago', true),
  ('BR', 'BR', 'BRA', 'Brasil', 'BRL', 'pt-BR', 'America/Sao_Paulo', true),
  ('AR', 'AR', 'ARG', 'Argentina', 'ARS', 'es-AR', 'America/Argentina/Buenos_Aires', true)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  currency_code = EXCLUDED.currency_code,
  locale = EXCLUDED.locale,
  timezone_default = EXCLUDED.timezone_default,
  enabled = EXCLUDED.enabled;


-- ---------------------------------------------------------------------
-- 3. CATÁLOGO DE DIVISIONES ADMINISTRATIVAS (Departamentos, Estados, Regiones)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.administrative_divisions (
  id text PRIMARY KEY,
  country_id text NOT NULL REFERENCES public.countries(id),
  parent_id text REFERENCES public.administrative_divisions(id),
  nombre text NOT NULL,
  division_type text NOT NULL, -- 'departamento', 'estado', 'region', 'provincia'
  source text DEFAULT 'geonames',
  source_id text
);

CREATE INDEX IF NOT EXISTS idx_admin_div_country ON public.administrative_divisions(country_id);

ALTER TABLE public.administrative_divisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "divisions_read_authenticated" ON public.administrative_divisions;
CREATE POLICY "divisions_read_authenticated" ON public.administrative_divisions
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.administrative_divisions (id, country_id, parent_id, nombre, division_type, source, source_id)
VALUES
  -- Colombia
  ('CO-CAL', 'CO', NULL, 'Caldas', 'departamento', 'geonames', '3687925'),
  ('CO-ANT', 'CO', NULL, 'Antioquia', 'departamento', 'geonames', '3689815'),
  ('CO-DC',  'CO', NULL, 'Bogotá D.C.', 'departamento', 'geonames', '3688689'),
  ('CO-CUN', 'CO', NULL, 'Cundinamarca', 'departamento', 'geonames', '3685533'),
  ('CO-VAL', 'CO', NULL, 'Valle del Cauca', 'departamento', 'geonames', '3666311'),
  ('CO-RIS', 'CO', NULL, 'Risaralda', 'departamento', 'geonames', '3670747'),
  ('CO-QUI', 'CO', NULL, 'Quindío', 'departamento', 'geonames', '3671178'),
  ('CO-SAN', 'CO', NULL, 'Santander', 'departamento', 'geonames', '3669681'),
  ('CO-ATL', 'CO', NULL, 'Atlántico', 'departamento', 'geonames', '3689147'),
  ('CO-BOL', 'CO', NULL, 'Bolívar', 'departamento', 'geonames', '3688612'),
  -- México
  ('MX-CMX', 'MX', NULL, 'Ciudad de México', 'estado', 'geonames', '3530597'),
  ('MX-JAL', 'MX', NULL, 'Jalisco', 'estado', 'geonames', '3995402'),
  ('MX-NLE', 'MX', NULL, 'Nuevo León', 'estado', 'geonames', '3995398'),
  ('MX-MEX', 'MX', NULL, 'Estado de México', 'estado', 'geonames', '3527645'),
  ('MX-PUE', 'MX', NULL, 'Puebla', 'estado', 'geonames', '3521081'),
  -- Perú
  ('PE-LIM', 'PE', NULL, 'Lima', 'departamento', 'geonames', '3936452'),
  ('PE-ARE', 'PE', NULL, 'Arequipa', 'departamento', 'geonames', '3947322'),
  ('PE-CUS', 'PE', NULL, 'Cusco', 'departamento', 'geonames', '3941584'),
  ('PE-PIU', 'PE', NULL, 'Piura', 'departamento', 'geonames', '3692873'),
  ('PE-LAL', 'PE', NULL, 'La Libertad', 'departamento', 'geonames', '3695507'),
  -- Chile
  ('CL-RM',  'CL', NULL, 'Región Metropolitana', 'region', 'geonames', '3871336'),
  ('CL-VAL', 'CL', NULL, 'Valparaíso', 'region', 'geonames', '3868626'),
  ('CL-BIO', 'CL', NULL, 'Biobío', 'region', 'geonames', '3897771'),
  ('CL-ANT', 'CL', NULL, 'Antofagasta', 'region', 'geonames', '3899539'),
  -- Brasil
  ('BR-SP', 'BR', NULL, 'São Paulo', 'estado', 'geonames', '3448433'),
  ('BR-RJ', 'BR', NULL, 'Rio de Janeiro', 'estado', 'geonames', '3451189'),
  ('BR-MG', 'BR', NULL, 'Minas Gerais', 'estado', 'geonames', '3457419'),
  ('BR-PR', 'BR', NULL, 'Paraná', 'estado', 'geonames', '3455077'),
  ('BR-RS', 'BR', NULL, 'Rio Grande do Sul', 'estado', 'geonames', '3451138'),
  ('BR-BA', 'BR', NULL, 'Bahia', 'estado', 'geonames', '3471168'),
  -- Argentina
  ('AR-C',  'AR', NULL, 'Ciudad Autónoma de Buenos Aires', 'caba', 'geonames', '3433955'),
  ('AR-B',  'AR', NULL, 'Buenos Aires', 'provincia', 'geonames', '3435907'),
  ('AR-X',  'AR', NULL, 'Córdoba', 'provincia', 'geonames', '3860255'),
  ('AR-S',  'AR', NULL, 'Santa Fe', 'provincia', 'geonames', '3836276'),
  ('AR-M',  'AR', NULL, 'Mendoza', 'provincia', 'geonames', '3844419')
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  division_type = EXCLUDED.division_type,
  source = EXCLUDED.source,
  source_id = EXCLUDED.source_id;


-- ---------------------------------------------------------------------
-- 4. CATÁLOGO DE CIUDADES Y MUNICIPIOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cities (
  id text PRIMARY KEY,
  country_id text NOT NULL REFERENCES public.countries(id),
  administrative_division_id text NOT NULL REFERENCES public.administrative_divisions(id),
  nombre text NOT NULL,
  geoname_id text,
  latitude numeric,
  longitude numeric,
  timezone text,
  source text DEFAULT 'geonames',
  enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_cities_country ON public.cities(country_id);
CREATE INDEX IF NOT EXISTS idx_cities_admin_div ON public.cities(administrative_division_id);

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cities_read_authenticated" ON public.cities;
CREATE POLICY "cities_read_authenticated" ON public.cities
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.cities (id, country_id, administrative_division_id, nombre, geoname_id, latitude, longitude, timezone, source, enabled)
VALUES
  -- Caldas, Colombia (Cobertura para Escenarios 1 y 5)
  ('CO-CAL-MNZ', 'CO', 'CO-CAL', 'Manizales', '3675443', 5.0689, -75.5174, 'America/Bogota', 'geonames', true),
  ('CO-CAL-VMA', 'CO', 'CO-CAL', 'Villamaría', '3666270', 5.0456, -75.5153, 'America/Bogota', 'geonames', true),
  ('CO-CAL-NEI', 'CO', 'CO-CAL', 'Neira', '3674170', 5.1664, -75.5222, 'America/Bogota', 'geonames', true),
  ('CO-CAL-CHI', 'CO', 'CO-CAL', 'Chinchiná', '3687029', 4.9814, -75.6036, 'America/Bogota', 'geonames', true),
  ('CO-CAL-LDO', 'CO', 'CO-CAL', 'La Dorada', '3679808', 5.4538, -74.6647, 'America/Bogota', 'geonames', true),
  ('CO-CAL-RIO', 'CO', 'CO-CAL', 'Riosucio', '3670783', 5.4217, -75.7031, 'America/Bogota', 'geonames', true),
  ('CO-CAL-ANS', 'CO', 'CO-CAL', 'Anserma', '3689871', 5.2344, -75.7836, 'America/Bogota', 'geonames', true),

  -- Otras ciudades Colombia
  ('CO-DC-BOG',  'CO', 'CO-DC',  'Bogotá D.C.', '3688689', 4.6097, -74.0817, 'America/Bogota', 'geonames', true),
  ('CO-ANT-MED', 'CO', 'CO-ANT', 'Medellín', '3674962', 6.2518, -75.5636, 'America/Bogota', 'geonames', true),
  ('CO-ANT-ENV', 'CO', 'CO-ANT', 'Envigado', '3682972', 6.1759, -75.5917, 'America/Bogota', 'geonames', true),
  ('CO-VAL-CAL', 'CO', 'CO-VAL', 'Cali', '3687925', 3.4372, -76.5225, 'America/Bogota', 'geonames', true),
  ('CO-RIS-PER', 'CO', 'CO-RIS', 'Pereira', '3672486', 4.8133, -75.6961, 'America/Bogota', 'geonames', true),
  ('CO-QUI-ARM', 'CO', 'CO-QUI', 'Armenia', '3689718', 4.5339, -75.6811, 'America/Bogota', 'geonames', true),
  ('CO-SAN-BUC', 'CO', 'CO-SAN', 'Bucaramanga', '3688465', 7.1254, -73.1198, 'America/Bogota', 'geonames', true),
  ('CO-ATL-BAR', 'CO', 'CO-ATL', 'Barranquilla', '3689147', 10.9685, -74.7813, 'America/Bogota', 'geonames', true),

  -- México (Cobertura Escenario 2)
  ('MX-CMX-CDMX', 'MX', 'MX-CMX', 'Ciudad de México', '3530597', 19.4285, -99.1277, 'America/Mexico_City', 'geonames', true),
  ('MX-CMX-CUAU', 'MX', 'MX-CMX', 'Cuauhtémoc', '3530597', 19.4326, -99.1332, 'America/Mexico_City', 'geonames', true),
  ('MX-CMX-BJU',  'MX', 'MX-CMX', 'Benito Juárez', '3532394', 19.3792, -99.1585, 'America/Mexico_City', 'geonames', true),
  ('MX-CMX-COY',  'MX', 'MX-CMX', 'Coyoacán', '3530342', 19.3467, -99.1617, 'America/Mexico_City', 'geonames', true),
  ('MX-JAL-GDL',  'MX', 'MX-JAL', 'Guadalajara', '4005539', 20.6668, -103.3918, 'America/Mexico_City', 'geonames', true),
  ('MX-JAL-ZAP',  'MX', 'MX-JAL', 'Zapopan', '3979770', 20.7167, -103.4000, 'America/Mexico_City', 'geonames', true),
  ('MX-NLE-MTY',  'MX', 'MX-NLE', 'Monterrey', '3995465', 25.6751, -100.3185, 'America/Monterrey', 'geonames', true),

  -- Perú (Cobertura Escenario 3)
  ('PE-LIM-LIM',  'PE', 'PE-LIM', 'Lima', '3936456', -12.0432, -77.0282, 'America/Lima', 'geonames', true),
  ('PE-LIM-MIR',  'PE', 'PE-LIM', 'Miraflores', '3934985', -12.1226, -77.0305, 'America/Lima', 'geonames', true),
  ('PE-LIM-SIS',  'PE', 'PE-LIM', 'San Isidro', '3930438', -12.0984, -77.0353, 'America/Lima', 'geonames', true),
  ('PE-ARE-ARE',  'PE', 'PE-ARE', 'Arequipa', '3947322', -16.3989, -71.5350, 'America/Lima', 'geonames', true),
  ('PE-CUS-CUS',  'PE', 'PE-CUS', 'Cusco', '3941584', -13.5226, -71.9673, 'America/Lima', 'geonames', true),
  ('PE-PIU-PIU',  'PE', 'PE-PIU', 'Piura', '3692873', -5.1945, -80.6328, 'America/Lima', 'geonames', true),

  -- Chile (Cobertura Escenario 4)
  ('CL-RM-STG',   'CL', 'CL-RM',  'Santiago', '3871336', -33.4569, -70.6483, 'America/Santiago', 'geonames', true),
  ('CL-RM-PRO',   'CL', 'CL-RM',  'Providencia', '3874088', -33.4314, -70.6094, 'America/Santiago', 'geonames', true),
  ('CL-RM-LCO',   'CL', 'CL-RM',  'Las Condes', '3884373', -33.4117, -70.5808, 'America/Santiago', 'geonames', true),
  ('CL-RM-PAL',   'CL', 'CL-RM',  'Puente Alto', '3874052', -33.6167, -70.5833, 'America/Santiago', 'geonames', true),
  ('CL-VAL-VAL',  'CL', 'CL-VAL', 'Valparaíso', '3868626', -33.0472, -71.6127, 'America/Santiago', 'geonames', true),
  ('CL-VAL-VMA',  'CL', 'CL-VAL', 'Viña del Mar', '3868124', -33.0246, -71.5518, 'America/Santiago', 'geonames', true),

  -- Brasil
  ('BR-SP-SAO',  'BR', 'BR-SP', 'São Paulo', '3448439', -23.5505, -46.6333, 'America/Sao_Paulo', 'geonames', true),
  ('BR-SP-CAM',  'BR', 'BR-SP', 'Campinas', '3467865', -22.9056, -47.0608, 'America/Sao_Paulo', 'geonames', true),
  ('BR-SP-SAN',  'BR', 'BR-SP', 'Santos', '3451328', -23.9608, -46.3336, 'America/Sao_Paulo', 'geonames', true),
  ('BR-RJ-RIO',  'BR', 'BR-RJ', 'Rio de Janeiro', '3451190', -22.9068, -43.1729, 'America/Sao_Paulo', 'geonames', true),
  ('BR-RJ-NIT',  'BR', 'BR-RJ', 'Niterói', '3456282', -22.8833, -43.1036, 'America/Sao_Paulo', 'geonames', true),
  ('BR-MG-BHO',  'BR', 'BR-MG', 'Belo Horizonte', '3470127', -19.9208, -43.9378, 'America/Sao_Paulo', 'geonames', true),
  ('BR-PR-CUR',  'BR', 'BR-PR', 'Curitiba', '3464975', -25.4284, -49.2733, 'America/Sao_Paulo', 'geonames', true),
  ('BR-RS-POA',  'BR', 'BR-RS', 'Porto Alegre', '3452925', -30.0346, -51.2177, 'America/Sao_Paulo', 'geonames', true),
  ('BR-BA-SAL',  'BR', 'BR-BA', 'Salvador', '3450554', -12.9714, -38.5014, 'America/Bahia', 'geonames', true),

  -- Argentina
  ('AR-C-BUE',   'AR', 'AR-C', 'Buenos Aires', '3435910', -34.6037, -58.3816, 'America/Argentina/Buenos_Aires', 'geonames', true),
  ('AR-B-LPL',   'AR', 'AR-B', 'La Plata', '3432039', -34.9215, -57.9545, 'America/Argentina/Buenos_Aires', 'geonames', true),
  ('AR-B-MDP',   'AR', 'AR-B', 'Mar del Plata', '3430863', -38.0004, -57.5562, 'America/Argentina/Buenos_Aires', 'geonames', true),
  ('AR-X-COR',   'AR', 'AR-X', 'Córdoba', '3860259', -31.4201, -64.1888, 'America/Argentina/Cordoba', 'geonames', true),
  ('AR-S-ROS',   'AR', 'AR-S', 'Rosario', '3838583', -32.9468, -60.6393, 'America/Argentina/Cordoba', 'geonames', true),
  ('AR-S-SFE',   'AR', 'AR-S', 'Santa Fe', '3836277', -31.6333, -60.7000, 'America/Argentina/Cordoba', 'geonames', true),
  ('AR-M-MDZ',   'AR', 'AR-M', 'Mendoza', '3844421', -32.8895, -68.8458, 'America/Argentina/Mendoza', 'geonames', true)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  geoname_id = EXCLUDED.geoname_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  timezone = EXCLUDED.timezone,
  enabled = EXCLUDED.enabled;


-- ---------------------------------------------------------------------
-- 5. EXTENDER TABLAS EXISTENTES CON CONFIGURACIÓN TERRITORIAL Y MONEDA
-- ---------------------------------------------------------------------

-- 5.1. PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_id text REFERENCES public.countries(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS administrative_division_id text REFERENCES public.administrative_divisions(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city_id text REFERENCES public.cities(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es-CO';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Bogota';

-- 5.2. INVOICE
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';

-- 5.3. CUOTAS
ALTER TABLE public.cuotas ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';

-- 5.4. PAYMENTS
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';

-- 5.5. CAJAS
ALTER TABLE public.cajas ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';

-- 5.6. CASH_MOVEMENTS
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS currency_code text REFERENCES public.currencies(code) DEFAULT 'COP';

-- Índices de moneda para acelerar consultas por divisa
CREATE INDEX IF NOT EXISTS idx_invoice_currency ON public.invoice(currency_code);
CREATE INDEX IF NOT EXISTS idx_payments_currency ON public.payments(currency_code);
CREATE INDEX IF NOT EXISTS idx_cajas_currency ON public.cajas(currency_code);
CREATE INDEX IF NOT EXISTS idx_cash_movements_currency ON public.cash_movements(currency_code);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON public.profiles(country_id);


-- ---------------------------------------------------------------------
-- 6. ASIGNACIÓN RETROACTIVA SEGURA PARA REGISTROS PREEXISTENTES (COLOMBIA / COP)
-- ---------------------------------------------------------------------
-- Solo se actualizan registros donde country_id o currency_code sean NULL.
-- No se tocan montos, estados ni saldos existentes.
UPDATE public.profiles
SET
  country_id = 'CO',
  administrative_division_id = COALESCE(administrative_division_id, 'CO-CAL'),
  city_id = COALESCE(city_id, 'CO-CAL-MNZ'),
  currency_code = 'COP',
  locale = 'es-CO',
  timezone = 'America/Bogota'
WHERE country_id IS NULL OR currency_code IS NULL;

UPDATE public.invoice        SET currency_code = 'COP' WHERE currency_code IS NULL;
UPDATE public.cuotas         SET currency_code = 'COP' WHERE currency_code IS NULL;
UPDATE public.payments       SET currency_code = 'COP' WHERE currency_code IS NULL;
UPDATE public.cajas          SET currency_code = 'COP' WHERE currency_code IS NULL;
UPDATE public.cash_movements SET currency_code = 'COP' WHERE currency_code IS NULL;


-- ---------------------------------------------------------------------
-- 7. ACTUALIZAR TRIGGER DE CAJA DIARIA: ZONA HORARIA DINÁMICA POR USUARIO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._check_single_caja_per_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz text;
  v_fecha_nueva date;
  v_count integer;
BEGIN
  -- Consultar zona horaria configurada en el perfil del usuario (fallback a America/Bogota)
  SELECT COALESCE(p.timezone, 'America/Bogota') INTO v_tz
  FROM public.profiles p
  WHERE p.id = NEW.usuario_id;

  IF v_tz IS NULL OR v_tz = '' THEN
    v_tz := 'America/Bogota';
  END IF;

  -- Calcular fecha calendario local del registro entrante
  v_fecha_nueva := (COALESCE(NEW.fecha_apertura, now()) AT TIME ZONE v_tz)::date;

  -- Verificar si ya existe CUALQUIER caja para este usuario en su fecha local correspondiente
  SELECT COUNT(*) INTO v_count
  FROM public.cajas
  WHERE usuario_id = NEW.usuario_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (fecha_apertura AT TIME ZONE v_tz)::date = v_fecha_nueva;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_CAJA_PER_DAY: El usuario ya tiene una caja registrada para el día % (Zona Horaria %). Bajo ninguna circunstancia se permiten dos cajas en el mismo día.', v_fecha_nueva, v_tz;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. ACTUALIZAR RPC admin_create_user CON CONFIGURACIÓN TERRITORIAL
-- ---------------------------------------------------------------------
-- Eliminamos firmas previas de admin_create_user de forma segura
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'admin_create_user'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_nombre text,
  p_apellido text DEFAULT '',
  p_rol text DEFAULT 'vendedor',
  p_dinero_max_caja numeric DEFAULT 0,
  p_dinero_max_venta numeric DEFAULT 0,
  p_dinero_max_gasto numeric DEFAULT 0,
  p_max_cuotas integer DEFAULT 30,
  p_permite_borrar_venta boolean DEFAULT false,
  p_permite_modificar_pagos boolean DEFAULT false,
  p_saldo_inicial numeric DEFAULT 0,
  p_superior_id uuid DEFAULT NULL,
  p_country_id text DEFAULT 'CO',
  p_administrative_division_id text DEFAULT NULL,
  p_city_id text DEFAULT NULL,
  p_timezone text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
  v_encrypted_pw text;
  v_now timestamptz;
  v_admin_org_id uuid;
  v_target_superior_id uuid;
  v_country_rec RECORD;
  v_city_rec RECORD;
  v_currency_code text;
  v_locale text;
  v_timezone text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden crear usuarios';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS: ya existe un usuario con este correo';
  END IF;

  v_target_superior_id := COALESCE(p_superior_id, auth.uid());

  IF v_target_superior_id <> auth.uid() AND NOT public._is_descendant_of(v_target_superior_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para asignar este superior jerárquico';
  END IF;

  -- Obtener la organización del administrador creador para heredarla
  SELECT organizacion_id INTO v_admin_org_id 
  FROM public.profiles 
  WHERE id = auth.uid();

  -- Obtener configuración del país seleccionado
  SELECT * INTO v_country_rec
  FROM public.countries
  WHERE id = COALESCE(p_country_id, 'CO');

  IF v_country_rec.id IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_NOT_FOUND: País % no encontrado en el catálogo', p_country_id;
  END IF;

  -- Moneda y Locale se derivan obligatoriamente del país (el usuario no puede alterarla a mano)
  v_currency_code := v_country_rec.currency_code;
  v_locale := v_country_rec.locale;

  -- Zona horaria: se deriva de la ciudad seleccionada si existe, o del timezone por defecto del país
  IF p_city_id IS NOT NULL THEN
    SELECT * INTO v_city_rec FROM public.cities WHERE id = p_city_id;
    IF v_city_rec.timezone IS NOT NULL AND v_city_rec.timezone <> '' THEN
      v_timezone := v_city_rec.timezone;
    END IF;
  END IF;

  IF v_timezone IS NULL THEN
    v_timezone := COALESCE(p_timezone, v_country_rec.timezone_default, 'America/Bogota');
  END IF;

  v_new_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_password), gen_salt('bf', 10));
  v_now := now();

  -- 1. Insertar en auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    p_email, v_encrypted_pw, v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false, 'nombre', p_nombre, 'apellido', COALESCE(p_apellido, ''))::jsonb,
    v_now, v_now, '', '', '', '', '', '', '', '', false, false
  );

  -- 2. Insertar en auth.identities
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_new_id::text, v_new_id,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false)::jsonb,
    'email', v_now, v_now, v_now
  );

  -- 3. Insertar o actualizar en public.profiles con configuración territorial
  INSERT INTO public.profiles (
    id, nombre, apellido, rol, superior_id, activo, dinero_max_caja, dinero_max_venta,
    dinero_max_gasto, max_cuotas, permite_borrar_venta, permite_modificar_pagos,
    organizacion_id, updated_at, update_at,
    country_id, administrative_division_id, city_id, currency_code, locale, timezone
  ) VALUES (
    v_new_id, p_nombre, COALESCE(p_apellido, ''), COALESCE(p_rol, 'vendedor'), v_target_superior_id, true,
    COALESCE(p_dinero_max_caja, 0), COALESCE(p_dinero_max_venta, 0), COALESCE(p_dinero_max_gasto, 0),
    COALESCE(p_max_cuotas, 30), COALESCE(p_permite_borrar_venta, false), COALESCE(p_permite_modificar_pagos, false),
    v_admin_org_id, v_now, v_now,
    v_country_rec.id, p_administrative_division_id, p_city_id, v_currency_code, v_locale, v_timezone
  )
  ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido,
    rol = EXCLUDED.rol,
    superior_id = EXCLUDED.superior_id,
    activo = true,
    dinero_max_caja = EXCLUDED.dinero_max_caja,
    dinero_max_venta = EXCLUDED.dinero_max_venta,
    dinero_max_gasto = EXCLUDED.dinero_max_gasto,
    max_cuotas = EXCLUDED.max_cuotas,
    permite_borrar_venta = EXCLUDED.permite_borrar_venta,
    permite_modificar_pagos = EXCLUDED.permite_modificar_pagos,
    organizacion_id = EXCLUDED.organizacion_id,
    updated_at = v_now,
    update_at = v_now,
    country_id = EXCLUDED.country_id,
    administrative_division_id = EXCLUDED.administrative_division_id,
    city_id = EXCLUDED.city_id,
    currency_code = EXCLUDED.currency_code,
    locale = EXCLUDED.locale,
    timezone = EXCLUDED.timezone;

  -- 4. Crear caja inicial si es vendedor con la moneda correspondiente
  IF COALESCE(p_rol, 'vendedor') = 'vendedor' THEN
    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, currency_code
    ) VALUES (
      v_new_id, 'abierta', COALESCE(p_saldo_inicial, 0), COALESCE(p_saldo_inicial, 0), v_now, v_currency_code
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'user_id', v_new_id,
    'email', p_email,
    'rol', COALESCE(p_rol, 'vendedor'),
    'superior_id', v_target_superior_id,
    'country_id', v_country_rec.id,
    'currency_code', v_currency_code,
    'locale', v_locale,
    'timezone', v_timezone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric, uuid, text, text, text, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 9. ACTUALIZAR RPC admin_update_user CON CONFIGURACIÓN TERRITORIAL
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'admin_update_user'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_nombre text DEFAULT NULL,
  p_apellido text DEFAULT NULL,
  p_dinero_max_caja numeric DEFAULT NULL,
  p_dinero_max_venta numeric DEFAULT NULL,
  p_dinero_max_gasto numeric DEFAULT NULL,
  p_max_cuotas integer DEFAULT NULL,
  p_permite_borrar_venta boolean DEFAULT NULL,
  p_permite_modificar_pagos boolean DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_country_id text DEFAULT NULL,
  p_administrative_division_id text DEFAULT NULL,
  p_city_id text DEFAULT NULL,
  p_timezone text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_country_rec RECORD;
  v_city_rec RECORD;
  v_currency_code text;
  v_locale text;
  v_timezone text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden actualizar usuarios';
  END IF;

  -- Si se actualiza el país, la moneda y el locale se recalculan automáticamente
  IF p_country_id IS NOT NULL THEN
    SELECT * INTO v_country_rec FROM public.countries WHERE id = p_country_id;
    IF v_country_rec.id IS NOT NULL THEN
      v_currency_code := v_country_rec.currency_code;
      v_locale := v_country_rec.locale;
      v_timezone := v_country_rec.timezone_default;
    END IF;
  END IF;

  IF p_city_id IS NOT NULL THEN
    SELECT * INTO v_city_rec FROM public.cities WHERE id = p_city_id;
    IF v_city_rec.timezone IS NOT NULL AND v_city_rec.timezone <> '' THEN
      v_timezone := v_city_rec.timezone;
    END IF;
  END IF;

  IF p_timezone IS NOT NULL THEN
    v_timezone := p_timezone;
  END IF;

  UPDATE public.profiles
  SET
    nombre = COALESCE(p_nombre, nombre),
    apellido = COALESCE(p_apellido, apellido),
    dinero_max_caja = COALESCE(p_dinero_max_caja, dinero_max_caja),
    dinero_max_venta = COALESCE(p_dinero_max_venta, dinero_max_venta),
    dinero_max_gasto = COALESCE(p_dinero_max_gasto, dinero_max_gasto),
    max_cuotas = COALESCE(p_max_cuotas, max_cuotas),
    permite_borrar_venta = COALESCE(p_permite_borrar_venta, permite_borrar_venta),
    permite_modificar_pagos = COALESCE(p_permite_modificar_pagos, permite_modificar_pagos),
    country_id = COALESCE(p_country_id, country_id),
    administrative_division_id = COALESCE(p_administrative_division_id, administrative_division_id),
    city_id = COALESCE(p_city_id, city_id),
    currency_code = COALESCE(v_currency_code, currency_code),
    locale = COALESCE(v_locale, locale),
    timezone = COALESCE(v_timezone, timezone),
    updated_at = now(),
    update_at = now()
  WHERE id = p_user_id;

  -- Si se proporcionó password, actualizar en auth.users
  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET
      encrypted_password = crypt(trim(p_password), gen_salt('bf', 10)),
      updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text, text, text, text, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 10. ACTUALIZAR admin_get_subordinates PARA RETORNAR CONFIGURACIÓN REGIONAL
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_subordinates();
DROP FUNCTION IF EXISTS public.admin_get_subordinates(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_subordinates(
  p_parent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  nombre text,
  apellido text,
  email text,
  rol text,
  superior_id uuid,
  activo boolean,
  dinero_max_caja numeric,
  dinero_max_venta numeric,
  dinero_max_gasto numeric,
  max_cuotas integer,
  permite_borrar_venta boolean,
  permite_modificar_pagos boolean,
  tiene_subordinados boolean,
  cantidad_subordinados integer,
  country_id text,
  country_nombre text,
  administrative_division_id text,
  division_nombre text,
  city_id text,
  city_nombre text,
  currency_code text,
  currency_symbol text,
  locale text,
  timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden ver subordinados';
  END IF;

  v_target_id := COALESCE(p_parent_id, auth.uid());

  IF v_target_id <> auth.uid() AND NOT public._is_descendant_of(v_target_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para consultar este nivel jerárquico';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid,
    COALESCE(p.nombre, '')::text,
    COALESCE(p.apellido, '')::text,
    COALESCE(au.email, '')::text AS email,
    COALESCE(p.rol, 'vendedor')::text,
    p.superior_id::uuid,
    COALESCE(p.activo, true)::boolean,
    COALESCE(p.dinero_max_caja, 0)::numeric,
    COALESCE(p.dinero_max_venta, 0)::numeric,
    COALESCE(p.dinero_max_gasto, 0)::numeric,
    COALESCE(p.max_cuotas, 30)::integer,
    COALESCE(p.permite_borrar_venta, false)::boolean,
    COALESCE(p.permite_modificar_pagos, false)::boolean,
    (EXISTS(SELECT 1 FROM public.profiles sub WHERE sub.superior_id = p.id))::boolean AS tiene_subordinados,
    (SELECT COUNT(*)::integer FROM public.profiles sub WHERE sub.superior_id = p.id) AS cantidad_subordinados,
    p.country_id::text,
    co.nombre::text AS country_nombre,
    p.administrative_division_id::text,
    ad.nombre::text AS division_nombre,
    p.city_id::text,
    ci.nombre::text AS city_nombre,
    COALESCE(p.currency_code, 'COP')::text AS currency_code,
    COALESCE(cu.symbol, '$')::text AS currency_symbol,
    COALESCE(p.locale, 'es-CO')::text AS locale,
    COALESCE(p.timezone, 'America/Bogota')::text AS timezone
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN public.countries co ON co.id = p.country_id
  LEFT JOIN public.administrative_divisions ad ON ad.id = p.administrative_division_id
  LEFT JOIN public.cities ci ON ci.id = p.city_id
  LEFT JOIN public.currencies cu ON cu.code = p.currency_code
  WHERE p.superior_id = v_target_id
  ORDER BY
    (p.rol = 'admin') DESC,
    p.nombre ASC,
    p.apellido ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_subordinates(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 11. ACTUALIZAR CANÓNICA create_sale CON PRESERVACIÓN DE MONEDA E INTEGRIDAD
-- ---------------------------------------------------------------------
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
  monto               numeric,
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
  foto_documento      text DEFAULT NULL,
  currency_code       text DEFAULT NULL
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
  v_caja_currency      text;
  v_vendedor_currency  text;
  v_vendedor_ok        boolean;
  v_fecha_efectiva     timestamptz;
  v_periodo            text;
  v_fecha_venc_cuota   date;
  v_proximo_recaudo    date;
  v_monto_adelantado   numeric;
  v_saldo_inicial_inv  numeric;
  v_op_currency        text;
  i                    integer;
BEGIN
  v_fecha_efectiva := COALESCE(create_sale.fecha, NOW());
  v_periodo := LOWER(COALESCE(create_sale.periodicidad, 'diario'));

  IF v_periodo NOT IN ('diario', 'semanal', 'mensual') THEN
    v_periodo := 'diario';
  END IF;

  -- 1. Idempotencia
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

  -- 2. Seguridad jerárquica
  IF create_sale.vendedor_id <> auth.uid() THEN
    SELECT public.is_same_hierarchy(create_sale.vendedor_id) INTO v_vendedor_ok;
    IF NOT v_vendedor_ok THEN
      RAISE EXCEPTION 'UNAUTHORIZED: no tienes permiso para crear ventas en nombre de ese vendedor';
    END IF;
  END IF;

  -- 3. Determinar moneda operativa del vendedor
  SELECT COALESCE(p.currency_code, 'COP') INTO v_vendedor_currency
  FROM public.profiles p
  WHERE p.id = create_sale.vendedor_id;

  v_op_currency := COALESCE(create_sale.currency_code, v_vendedor_currency, 'COP');

  -- 4. Validar caja y coherencia monetaria con la caja
  SELECT cj.estado, COALESCE(cj.currency_code, 'COP') INTO v_caja_estado, v_caja_currency
  FROM public.cajas cj
  WHERE cj.id = create_sale.caja_id AND cj.usuario_id = create_sale.vendedor_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND: caja no encontrada o no pertenece al vendedor';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: debes abrir una caja antes de registrar una venta';
  END IF;

  IF v_caja_currency <> v_op_currency THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: La moneda de la operación (%) no coincide con la moneda de la caja (%)', v_op_currency, v_caja_currency;
  END IF;

  -- 5. Validar monto
  IF create_sale.monto IS NULL OR create_sale.monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: el monto de la venta debe ser mayor que 0';
  END IF;

  -- 6. Cálculo de interés
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

  -- 7. Cuotas
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

  -- 8. Cliente: sin restricción de ciudad/municipio
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

  -- 9. Factura con moneda explícita
  v_monto_adelantado := CASE WHEN create_sale.pago_adelantado THEN v_cuota_monto ELSE 0 END;
  v_saldo_inicial_inv := v_total_factura - v_monto_adelantado;

  INSERT INTO public.invoice (
    client_id, amount, saldo, status, usuario_id, plazo_id, interes_id,
    capital_amount, interest_amount, latitud, longitud, previous_invoice_id,
    periodicidad, num_cuotas, tasa_interes, pago_adelantado, created_at, currency_code
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
    v_fecha_efectiva,
    v_op_currency
  )
  RETURNING invoice.id INTO v_invoice_id;

  -- 10. Cuotas con moneda
  FOR i IN 1..v_num_cuotas LOOP
    IF v_periodo = 'semanal' THEN
      v_fecha_venc_cuota := (v_fecha_efectiva::date + (i * INTERVAL '7 days'))::date;
    ELSIF v_periodo = 'mensual' THEN
      v_fecha_venc_cuota := (v_fecha_efectiva::date + (i * INTERVAL '1 month'))::date;
    ELSE
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
      monto_pagado,
      currency_code
    ) VALUES (
      v_invoice_id,
      i,
      v_fecha_venc_cuota,
      CASE WHEN i = v_num_cuotas THEN v_cuota_resto ELSE v_cuota_monto END,
      CASE WHEN i = 1 AND create_sale.pago_adelantado THEN 'pagada' ELSE 'pendiente' END,
      CASE WHEN i = 1 AND create_sale.pago_adelantado THEN v_cuota_monto ELSE 0 END,
      v_op_currency
    );
  END LOOP;

  -- 11. Movimiento de Caja de la Venta (con moneda)
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, fecha, client_uuid, currency_code
  ) VALUES (
    create_sale.caja_id,
    'venta',
    'Venta factura ' || v_invoice_id::text,
    v_capital,
    v_fecha_efectiva,
    create_sale.client_uuid,
    v_op_currency
  )
  RETURNING cash_movements.id INTO v_mov_id;

  -- Actualizar Saldo de Caja
  UPDATE public.cajas AS ca
    SET saldo_final = COALESCE(ca.saldo_final, ca.saldo_inicial, 0) - v_capital
    WHERE ca.id = create_sale.caja_id;

  -- 12. Manejo de Pago Adelantado
  IF create_sale.pago_adelantado AND v_cuota_monto > 0 THEN
    INSERT INTO public.payments (
      invoice_id, client_id, amount, payment_date, method, client_uuid, currency_code
    ) VALUES (
      v_invoice_id,
      v_client_id,
      v_cuota_monto,
      v_proximo_recaudo,
      'pago_adelantado',
      CASE WHEN create_sale.client_uuid IS NOT NULL THEN
        ('00000000-0000-4000-9000-' || SUBSTRING(create_sale.client_uuid::text, 25))::uuid
      ELSE NULL END,
      v_op_currency
    )
    RETURNING id INTO v_adv_pay_id;

    INSERT INTO public.cash_movements (
      caja_id, tipo, descripcion, monto, fecha, client_uuid, currency_code
    ) VALUES (
      create_sale.caja_id,
      'pago',
      'Cobro anticipado cuota #1 factura ' || v_invoice_id::text,
      v_cuota_monto,
      v_proximo_recaudo,
      CASE WHEN create_sale.client_uuid IS NOT NULL THEN
        ('00000000-0000-4000-9000-' || SUBSTRING(create_sale.client_uuid::text, 25))::uuid
      ELSE NULL END,
      v_op_currency
    )
    RETURNING id INTO v_adv_mov_id;

    UPDATE public.cuotas
      SET payment_id = v_adv_pay_id
      WHERE invoice_id = v_invoice_id AND numero = 1;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id_factura', v_invoice_id,
    'id_movimiento', v_mov_id,
    'client_id', v_client_id,
    'capital', v_capital,
    'interes', v_interes_monto,
    'total', v_total_factura,
    'num_cuotas', v_num_cuotas,
    'valor_cuota', v_cuota_monto,
    'periodicidad', v_periodo,
    'currency_code', v_op_currency
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_sale(text, text, text, text, text, text, text, numeric, uuid, uuid, integer, integer, uuid, numeric, numeric, uuid, timestamptz, text, integer, numeric, boolean, text, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 12. ACTUALIZAR create_payment CON VALIDACIÓN ESTRICTA DE MONEDA
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname = 'create_payment'
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_payment(
  p_invoice_id   uuid,
  p_client_id    uuid,
  p_amount       numeric,
  p_payment_date date,
  p_method       text,
  p_caja_id      uuid,
  p_client_uuid  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_saldo           numeric;
  v_status          text;
  v_usuario_id      uuid;
  v_inv_currency    text;
  v_caja_estado     text;
  v_caja_usuario_id uuid;
  v_caja_currency   text;
  v_mov_id          uuid;
  v_pay_id          uuid;
  v_nuevo_saldo     numeric;
  v_monto_restante  numeric;
  v_saldo_cuota     numeric;
  r_cuota           RECORD;
BEGIN
  -- 1. Validar que el usuario que ejecuta la operación no esté inhabilitado
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND activo IS FALSE) THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- 2. Idempotencia por client_uuid
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_pay_id
    FROM public.payments
    WHERE client_uuid = p_client_uuid
      AND invoice_id = p_invoice_id
    LIMIT 1;

    IF v_pay_id IS NOT NULL THEN
      RETURN v_pay_id;
    END IF;
  END IF;

  -- 3. Idempotencia de ventana de 5 minutos
  IF p_client_uuid IS NULL THEN
    SELECT id INTO v_pay_id
    FROM public.payments
    WHERE invoice_id = p_invoice_id
      AND amount = ROUND(p_amount, 2)
      AND method = p_method
      AND payment_date = p_payment_date
      AND created_at >= (now() - interval '5 minutes')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_pay_id IS NOT NULL THEN
      RETURN v_pay_id;
    END IF;
  END IF;

  -- 4. Validación de monto no negativo
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor o igual a 0';
  END IF;

  -- 5. Obtener factura con moneda y bloqueo FOR UPDATE
  SELECT saldo, status, usuario_id, COALESCE(currency_code, 'COP')
  INTO v_saldo, v_status, v_usuario_id, v_inv_currency
  FROM public.invoice
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'FACTURA_NOT_FOUND: factura % no existe', p_invoice_id;
  END IF;

  -- 6. Validar caja y coherencia de moneda entre caja y factura
  SELECT estado, usuario_id, COALESCE(currency_code, 'COP')
  INTO v_caja_estado, v_caja_usuario_id, v_caja_currency
  FROM public.cajas WHERE id = p_caja_id;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND: la caja % no existe', p_caja_id;
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: no se pueden registrar pagos en una caja cerrada';
  END IF;

  -- REGLA DE INTEGRIDAD FINANCIERA: La factura y la caja deben tener la misma moneda
  IF v_inv_currency <> v_caja_currency THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: La moneda de la factura (%) no coincide con la moneda de la caja (%)', v_inv_currency, v_caja_currency;
  END IF;

  -- CASO 1: NO PAGO
  IF p_amount = 0 OR p_method = 'nopago' THEN
    INSERT INTO public.payments (
      invoice_id, client_id, amount, payment_date, method, client_uuid, currency_code
    ) VALUES (
      p_invoice_id,
      p_client_id,
      0,
      p_payment_date,
      'nopago',
      p_client_uuid,
      v_inv_currency
    )
    RETURNING id INTO v_pay_id;

    IF p_caja_id IS NOT NULL THEN
      INSERT INTO public.cash_movements (caja_id, tipo, descripcion, monto, client_uuid, currency_code)
      VALUES (
        p_caja_id,
        'nopago',
        'Visita sin cobro - factura ' || p_invoice_id::text,
        0,
        p_client_uuid,
        v_inv_currency
      );
    END IF;

    RETURN v_pay_id;
  END IF;

  -- CASO 2: ABONO / PAGO REAL
  IF v_status = 'pagado' OR v_status = 'pagada' THEN
    RAISE EXCEPTION 'FACTURA_PAGADA: la factura % ya está completamente pagada', p_invoice_id;
  END IF;

  IF p_amount > v_saldo THEN
    IF (p_amount - v_saldo) <= 1.0 THEN
      p_amount := v_saldo;
    ELSE
      RAISE EXCEPTION 'El monto del pago (%) excede el saldo de la factura (%)', p_amount, v_saldo;
    END IF;
  END IF;

  -- Insertar movimiento real de caja con la moneda correspondiente
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid, currency_code
  ) VALUES (
    p_caja_id,
    'pago',
    'Cobro factura ' || p_invoice_id::text,
    ROUND(p_amount, 2),
    p_client_uuid,
    v_inv_currency
  )
  RETURNING id INTO v_mov_id;

  -- Sumar saldo a la caja
  UPDATE public.cajas
    SET saldo_final = COALESCE(saldo_final, 0) + ROUND(p_amount, 2)
    WHERE id = p_caja_id;

  -- Insertar pago con moneda de la factura
  INSERT INTO public.payments (
    invoice_id, client_id, amount, payment_date, method, cash_movement_id, client_uuid, currency_code
  ) VALUES (
    p_invoice_id,
    p_client_id,
    ROUND(p_amount, 2),
    p_payment_date,
    p_method,
    v_mov_id,
    p_client_uuid,
    v_inv_currency
  )
  RETURNING id INTO v_pay_id;

  -- Descontar saldo de la factura
  v_nuevo_saldo := GREATEST(ROUND(v_saldo - p_amount, 2), 0);

  UPDATE public.invoice
    SET
      saldo  = v_nuevo_saldo,
      status = CASE WHEN v_nuevo_saldo <= 0 THEN 'pagado' ELSE status END
    WHERE id = p_invoice_id;

  -- Distribuir entre cuotas
  v_monto_restante := ROUND(p_amount, 2);

  FOR r_cuota IN (
    SELECT id, monto, COALESCE(monto_pagado, 0) AS monto_pagado
    FROM public.cuotas
    WHERE invoice_id = p_invoice_id
      AND estado IN ('pendiente', 'parcial', 'abonada')
    ORDER BY numero ASC
    FOR UPDATE
  ) LOOP
    EXIT WHEN v_monto_restante <= 0;

    v_saldo_cuota := r_cuota.monto - r_cuota.monto_pagado;
    IF v_saldo_cuota <= 0 THEN
      CONTINUE;
    END IF;

    IF v_monto_restante >= v_saldo_cuota THEN
      UPDATE public.cuotas
      SET
        estado       = 'pagada',
        monto_pagado = r_cuota.monto,
        payment_id   = v_pay_id
      WHERE id = r_cuota.id;

      v_monto_restante := v_monto_restante - v_saldo_cuota;
    ELSE
      UPDATE public.cuotas
      SET
        estado       = 'parcial',
        monto_pagado = r_cuota.monto_pagado + v_monto_restante,
        payment_id   = v_pay_id
      WHERE id = r_cuota.id;

      v_monto_restante := 0;
    END IF;
  END LOOP;

  RETURN v_pay_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_payment(uuid, uuid, numeric, date, text, uuid, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 13. ACTUALIZAR admin_get_cajas CON ZONA HORARIA Y MONEDA DINÁMICAS
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_cajas(date, date);
DROP FUNCTION IF EXISTS public.admin_get_cajas(date, date, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_cajas(
  p_fecha_ini date DEFAULT NULL,
  p_fecha_fin date DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL
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
  total_movimientos bigint,
  tiene_subordinados boolean,
  cantidad_subordinados integer,
  currency_code text,
  currency_symbol text,
  timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden consultar cajas.';
  END IF;

  v_target_id := COALESCE(p_parent_id, auth.uid());

  IF v_target_id <> auth.uid() AND NOT public._is_descendant_of(v_target_id, auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tiene permiso para consultar este nivel jerárquico.';
  END IF;

  RETURN QUERY
  WITH direct_users AS (
    SELECT p.id FROM public.profiles p WHERE p.superior_id = v_target_id
    UNION
    SELECT v_target_id AS id
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
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND (m.tipo = 'gasto' OR (m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'))), 0)::numeric AS valor_gastos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'ingreso'), 0)::numeric AS valor_ingresos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro' AND (m.descripcion IS NULL OR m.descripcion NOT ILIKE '%gasto%')), 0)::numeric AS valor_retiros,
    (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)::bigint AS total_clientes,
    COALESCE((SELECT COUNT(*) FROM public.payments pay
      JOIN public.invoice inv ON inv.id = pay.invoice_id
      WHERE inv.usuario_id = c.usuario_id AND pay.method = 'nopago'
        AND pay.payment_date = (c.fecha_apertura AT TIME ZONE COALESCE(p.timezone, 'America/Bogota'))::date), 0)::bigint AS cantidad_nopagos,
    CASE WHEN (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false) > 0
    THEN ROUND(
      (SELECT COUNT(DISTINCT pay.invoice_id)::numeric FROM public.payments pay
       JOIN public.invoice inv ON inv.id = pay.invoice_id
       WHERE inv.usuario_id = c.usuario_id AND pay.payment_date = (c.fecha_apertura AT TIME ZONE COALESCE(p.timezone, 'America/Bogota'))::date) * 100.0 /
      (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)
    , 1)::numeric
    ELSE 0::numeric END AS progreso_visitas,
    COALESCE((SELECT COUNT(*) FROM public.cash_movements m WHERE m.caja_id = c.id), 0)::bigint AS total_movimientos,
    (EXISTS(SELECT 1 FROM public.profiles sub WHERE sub.superior_id = c.usuario_id))::boolean AS tiene_subordinados,
    (SELECT COUNT(*)::integer FROM public.profiles sub WHERE sub.superior_id = c.usuario_id) AS cantidad_subordinados,
    COALESCE(c.currency_code, p.currency_code, 'COP')::text AS currency_code,
    COALESCE(cur.symbol, '$')::text AS currency_symbol,
    COALESCE(p.timezone, 'America/Bogota')::text AS timezone
  FROM public.cajas c
  JOIN public.profiles p ON p.id = c.usuario_id
  LEFT JOIN public.currencies cur ON cur.code = COALESCE(c.currency_code, p.currency_code, 'COP')
  WHERE c.usuario_id IN (SELECT id FROM direct_users)
    AND (p_fecha_ini IS NULL OR (c.fecha_apertura AT TIME ZONE COALESCE(p.timezone, 'America/Bogota'))::date >= p_fecha_ini)
    AND (p_fecha_fin IS NULL OR (c.fecha_apertura AT TIME ZONE COALESCE(p.timezone, 'America/Bogota'))::date <= p_fecha_fin)
  ORDER BY
    CASE WHEN c.usuario_id = v_target_id THEN 0 ELSE 1 END,
    c.estado ASC,
    c.fecha_apertura DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 14. ACTUALIZAR rpc_create_cash_movement CON PRESERVACIÓN DE MONEDA
-- ---------------------------------------------------------------------
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
  v_caja_currency       text;
  v_admin_caja_id       uuid;
  v_admin_caja_estado   text;
  v_admin_caja_currency text;
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

  -- 3. Validar caja abierta y obtener moneda
  SELECT estado, usuario_id, admin_caja_id, COALESCE(currency_code, 'COP')
  INTO v_caja_estado, v_caja_usuario_id, v_admin_caja_id, v_caja_currency
  FROM public.cajas WHERE id = p_caja_id FOR UPDATE;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: La caja debe estar abierta para registrar movimientos';
  END IF;

  -- 4. Insertar movimiento en la caja principal con su respectiva moneda
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid, external_caja_id, fecha,
    concepto_id, evidencia_path, currency_code
  ) VALUES (
    p_caja_id, p_tipo, p_descripcion, ROUND(p_monto, 2), p_client_uuid, v_admin_caja_id, v_fecha_efectiva,
    p_concepto_id, p_evidencia_path, v_caja_currency
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
    SELECT estado, COALESCE(currency_code, 'COP')
    INTO v_admin_caja_estado, v_admin_caja_currency
    FROM public.cajas WHERE id = v_admin_caja_id;

    IF v_admin_caja_estado = 'abierta' THEN
      -- Validar integridad monetaria entre cajas vinculadas
      IF v_admin_caja_currency <> v_caja_currency THEN
        RAISE EXCEPTION 'CURRENCY_MISMATCH_CAJA_ESPEJO: La caja admin (%) opera en % y la caja operativa (%) en %',
          v_admin_caja_id, v_admin_caja_currency, p_caja_id, v_caja_currency;
      END IF;

      IF p_tipo = 'retiro' THEN
        v_mirror_desc := 'Entrega vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                         CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

        INSERT INTO public.cash_movements (
          caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id, fecha, currency_code
        ) VALUES (
          v_admin_caja_id, 'ingreso', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id, v_fecha_efectiva, v_admin_caja_currency
        )
        RETURNING id INTO v_mirror_mov_id;

        UPDATE public.cash_movements SET paired_movement_id = v_mirror_mov_id WHERE id = v_mov_id;
        UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ROUND(p_monto, 2) WHERE id = v_admin_caja_id;

      ELSIF p_tipo = 'ingreso' THEN
        v_mirror_desc := 'Base a vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                         CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

        INSERT INTO public.cash_movements (
          caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id, fecha, currency_code
        ) VALUES (
          v_admin_caja_id, 'retiro', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id, v_fecha_efectiva, v_admin_caja_currency
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
    'currency_code', v_caja_currency,
    'fecha', v_fecha_efectiva,
    'concepto_id', p_concepto_id,
    'evidencia_path', p_evidencia_path
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid, timestamptz, integer, text) TO authenticated, service_role;

