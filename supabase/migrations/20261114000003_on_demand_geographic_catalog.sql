-- =====================================================================
-- MIGRACIÓN CORRECTIVA Y REFORZADA: CATÁLOGO GEOGRÁFICO DINÁMICO (ZENDA)
-- Archivo: 20261114000003_on_demand_geographic_catalog.sql
--
-- REGLAS Y PRINCIPIOS DE INTEGRIDAD ARQUITECTÓNICA:
-- 1. NO modifica tablas financieras (invoice, payments, cuotas, cajas, cash_movements).
-- 2. NO modifica RPC financieras (create_sale, create_payment, etc.).
-- 3. NO altera registros ni identificadores históricos preexistentes (104 ciudades, 58 divisiones).
-- 4. Trazabilidad: Agrega created_by y created_at conservando registros antiguos
--    sin sobreescribirles fechas históricas ficticias (DEFAULT now() solo para nuevas).
--
-- 5. GOBERNANZA MULTIEMPRESA EN CATÁLOGO COMPARTIDO:
--    - En Zenda, public.profiles contiene: rol, superior_id, organizacion_id.
--    - Los roles válidos son exclusivamente: 'admin', 'vendedor', 'cliente'.
--    - 'rol = admin AND superior_id IS NULL' identifica al ADMINISTRADOR PRINCIPAL
--      de una organización específica (tenant), no a un superadministrador global.
--    - El catálogo geográfico es compartido y global entre todas las organizaciones.
--    - Por diseño y regla de gobernanza:
--        * Administradores principales de organizaciones distintas pueden registrar divisiones
--          en este catálogo global compartido, quedando registrado su user_id en 'created_by'.
--        * No existe aislamiento de catálogo territorial entre organizaciones (catálogo común).
--        * Administradores subordinados (superior_id IS NOT NULL) y vendedores: FORBIDDEN
--          para crear divisiones territoriales.
--        * Vendedores pueden registrar localidades/ciudades dentro de divisiones ya existentes.
--        * Clientes tienen denegada toda invocación a la RPC.
--
-- 6. LÍMITE DE CONFIANZA DE GEONAMES (CLIENTE REACT NATIVE):
--    - La aplicación consulta directamente la API pública de GeoNames desde React Native
--      con AbortController (timeout defensivo 6s), caché en memoria (TTL 10m) y normalización.
--    - No se introducen Edge Functions ni servidores backend Node.js intermedios.
--    - La RPC en PostgreSQL valida exhaustivamente la integridad relacional, formatos y unicidad,
--      pero 'source = geonames' representa una procedencia declarada por el cliente y no una
--      certificación criptográfica de un servidor central de GeoNames.
--
-- 7. ESTRATEGIA DE IDENTIFICADORES ROBUSTA (CERO COLISIONES):
--    - Ciudades GeoNames: [DIV]-GEO[geoname_id] (ej. CO-CAL-GEO3675443).
--    - Ciudades Manuales: [DIV]-MAN-[UUID] (ej. CO-CAL-MAN-B7F98C...). Se eliminan
--      definitivamente los fragmentos truncados de 3 letras que producían colisiones
--      entre localidades como San José y San Juan.
--    - Divisiones: No se truncan slugs a 3 letras. Se preservan códigos oficiales existentes
--      y se asigna [COUNTRY]-DIV-[ID_FUENTE] o [COUNTRY]-DIV-MAN-[UUID] para divisiones manuales.
--
-- 8. RESOLUCIÓN DE TIPOS TERRITORIALES SIN PREDETERMINADO UNIVERSAL:
--    - Se elimina 'p_division_type DEFAULT departamento'. La firma declara 'DEFAULT NULL'.
--    - Reglas por país: Colombia -> departamento; México -> estado; Argentina -> provincia;
--      Brasil -> estado; Perú -> departamento; Chile -> region.
--    - Para otros países, p_division_type debe ser provisto explícitamente; de lo contrario
--      la creación de divisiones es rechazada con BAD_REQUEST.
--
-- 9. COMPATIBILIDAD ESTRICTA Y RECUPERACIÓN ANTE unique_violation:
--    - Al reconciliar divisiones existentes (intentos 1, 2, 3), se valida país, division_type,
--      nombre normalizado y fuente/source_id. Ante cualquier contradicción se devuelve CONFLICT.
--    - Ante unique_violation, si el registro existente tiene source_id NULL y la solicitud
--      trae un identificador externo, se rechaza con CONFLICT por ambigüedad.
--
-- 10. ENDURECIMIENTO DE SECURITY DEFINER:
--     - SET search_path = pg_catalog, public, pg_temp;
--     - Cualificación explícita de todos los esquemas en llamadas y funciones.
-- =====================================================================

-- 1. EXTENDER COLUMNAS DE TRAZABILIDAD SIN MARCAR REGISTROS HISTÓRICOS
ALTER TABLE public.administrative_divisions 
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE public.administrative_divisions 
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.cities 
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE public.cities 
  ALTER COLUMN created_at SET DEFAULT now();


-- 2. HELPER DE NORMALIZACIÓN DE NOMBRES GEOGRÁFICOS (IMMUTABLE, DETERMINISTA)
CREATE OR REPLACE FUNCTION public.normalize_geo_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT lower(trim(regexp_replace(
    translate(
      coalesce(p_text, ''),
      'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'
    ),
    '[^a-zA-Z0-9 ]', '', 'g'
  )));
$$;


-- 3. RPC: REGISTRO DINÁMICO DE UBICACIÓN GEOGRÁFICA BAJO DEMANDA
CREATE OR REPLACE FUNCTION public.register_geographic_location(
  p_country_id text,
  p_division_id text DEFAULT NULL,
  p_division_nombre text DEFAULT NULL,
  p_division_type text DEFAULT NULL,
  p_division_source text DEFAULT 'geonames',
  p_division_source_id text DEFAULT NULL,
  p_city_nombre text DEFAULT NULL,
  p_city_id text DEFAULT NULL,
  p_geoname_id text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_source text DEFAULT 'geonames',
  p_source_id text DEFAULT NULL,
  p_type text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_user_rol text;
  v_user_superior_id uuid;
  v_user_org_id uuid;
  v_country_rec RECORD;
  v_division_rec RECORD;
  v_city_rec RECORD;
  v_target_div_id text;
  v_target_city_id text;
  v_clean_city_name text;
  v_clean_div_name text;
  v_clean_source text;
  v_clean_div_source text;
  v_clean_div_type text;
  v_clean_city_type text;
  v_match_count integer := 0;
  v_reconciled boolean := false;
  v_new_city_inserted boolean := false;
  v_new_div_inserted boolean := false;
  v_safe_slug text;
BEGIN
  -- 1. Validación de autenticación estricta (no se confía en parámetros del cliente)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Se requiere sesión autenticada para registrar ubicaciones';
  END IF;

  -- 2. Validación de rol real y jerarquía organizacional en Supabase
  SELECT rol, superior_id, organizacion_id 
  INTO v_user_rol, v_user_superior_id, v_user_org_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_user_rol IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Perfil de usuario no encontrado en el sistema';
  END IF;

  IF v_user_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'FORBIDDEN: El rol "%" no tiene permisos para registrar ubicaciones geográficas', v_user_rol;
  END IF;

  -- 3. Validación de parámetros elementales
  IF p_country_id IS NULL OR trim(p_country_id) = '' THEN
    RAISE EXCEPTION 'BAD_REQUEST: El código de país (country_id) es obligatorio';
  END IF;

  v_clean_city_name := trim(coalesce(p_city_nombre, ''));
  IF v_clean_city_name = '' THEN
    RAISE EXCEPTION 'BAD_REQUEST: El nombre de la ciudad o municipio es obligatorio';
  END IF;

  -- 4. Validación de procedencia de datos
  v_clean_source := lower(trim(coalesce(p_source, 'geonames')));
  IF v_clean_source NOT IN ('geonames', 'manual') THEN
    RAISE EXCEPTION 'BAD_REQUEST: Fuente de procedencia no permitida: "%". Debe ser "geonames" o "manual"', p_source;
  END IF;

  v_clean_div_source := lower(trim(coalesce(p_division_source, 'geonames')));
  IF v_clean_div_source NOT IN ('geonames', 'dane_divipola', 'manual', 'inegi', 'inei', 'ibge', 'indec') THEN
    RAISE EXCEPTION 'BAD_REQUEST: Fuente de división administrativa no permitida: "%"', p_division_source;
  END IF;

  IF v_clean_div_source = 'manual' AND p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
    RAISE EXCEPTION 'BAD_REQUEST: Una división administrativa manual no puede contener identificadores externos ("p_division_source_id")';
  END IF;

  -- 5. Resolución del tipo territorial de la división sin predeterminado universal arbitrario
  IF p_division_type IS NOT NULL AND trim(p_division_type) <> '' THEN
    v_clean_div_type := lower(trim(p_division_type));
    IF v_clean_div_type NOT IN ('departamento', 'estado', 'region', 'provincia', 'caba') THEN
      RAISE EXCEPTION 'BAD_REQUEST: Tipo de división administrativa no permitido: "%"', p_division_type;
    END IF;
  ELSE
    -- Reglas territoriales explícitas y confiables por país
    CASE upper(trim(p_country_id))
      WHEN 'CO' THEN v_clean_div_type := 'departamento';
      WHEN 'MX' THEN v_clean_div_type := 'estado';
      WHEN 'AR' THEN v_clean_div_type := 'provincia';
      WHEN 'BR' THEN v_clean_div_type := 'estado';
      WHEN 'PE' THEN v_clean_div_type := 'departamento';
      WHEN 'CL' THEN v_clean_div_type := 'region';
      ELSE
        -- No inventar ni clasificar automáticamente como departamento; se requiere especificación
        v_clean_div_type := NULL;
    END CASE;
  END IF;

  -- 6. Resolución dinámica del tipo de ciudad según la procedencia
  IF p_type IS NOT NULL AND trim(p_type) <> '' THEN
    v_clean_city_type := lower(trim(p_type));
  ELSE
    IF v_clean_source = 'manual' THEN
      v_clean_city_type := 'localidad_manual';
    ELSE
      v_clean_city_type := 'ciudad';
    END IF;
  END IF;

  -- Validación de tipos y reglas según la procedencia de la ciudad
  IF v_clean_source = 'geonames' THEN
    IF p_geoname_id IS NULL OR trim(p_geoname_id) = '' THEN
      RAISE EXCEPTION 'BAD_REQUEST: Las ubicaciones provenientes de GeoNames deben incluir un "p_geoname_id" válido';
    END IF;
    IF p_geoname_id !~ '^\d+$' THEN
      RAISE EXCEPTION 'BAD_REQUEST: "p_geoname_id" debe ser un identificador numérico de GeoNames';
    END IF;
    IF v_clean_city_type NOT IN ('ciudad', 'ciudad_capital', 'municipio', 'distrito', 'alcaldia', 'comuna', 'provincia') THEN
      RAISE EXCEPTION 'BAD_REQUEST: Tipo de entidad no compatible con geonames: "%"', v_clean_city_type;
    END IF;
  ELSIF v_clean_source = 'manual' THEN
    IF p_geoname_id IS NOT NULL AND trim(p_geoname_id) <> '' THEN
      RAISE EXCEPTION 'BAD_REQUEST: Un registro manual no puede contener un "p_geoname_id" externo';
    END IF;
    IF p_source_id IS NOT NULL AND trim(p_source_id) <> '' THEN
      RAISE EXCEPTION 'BAD_REQUEST: Un registro manual no puede contener "p_source_id" de proveedor externo';
    END IF;
    IF v_clean_city_type NOT IN ('localidad_manual', 'localidad', 'barrio', 'corregimiento', 'zona') THEN
      RAISE EXCEPTION 'BAD_REQUEST: Tipo de entidad manual no permitido: "%". Un registro manual no puede auto-clasificarse como municipio oficial, distrito capital ni tipo restringido', v_clean_city_type;
    END IF;
  END IF;

  -- 7. Validar que el país exista y esté habilitado
  v_country_rec := NULL;
  SELECT id, nombre, currency_code, locale, timezone_default
  INTO v_country_rec
  FROM public.countries
  WHERE id = upper(trim(p_country_id)) AND enabled = true;

  IF v_country_rec.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: País "%" no encontrado o inactivo en el catálogo de Zenda', p_country_id;
  END IF;

  -- -------------------------------------------------------------------
  -- 8. RECONCILIACIÓN / RESOLUCIÓN DE LA DIVISIÓN ADMINISTRATIVA
  -- -------------------------------------------------------------------
  v_clean_div_name := trim(coalesce(p_division_nombre, ''));
  v_division_rec := NULL;

  -- Intento 1: Por ID de división proporcionado
  IF p_division_id IS NOT NULL AND trim(p_division_id) <> '' THEN
    SELECT id, country_id, nombre, division_type, source, source_id
    INTO v_division_rec
    FROM public.administrative_divisions
    WHERE id = trim(p_division_id);

    IF v_division_rec.id IS NOT NULL THEN
      -- Comprobar país
      IF v_division_rec.country_id <> v_country_rec.id THEN
        RAISE EXCEPTION 'CONFLICT: La división administrativa "%" pertenece al país "%", no al país "%"',
          v_division_rec.id, v_division_rec.country_id, v_country_rec.id;
      END IF;

      -- Comprobar compatibilidad de division_type si fue provisto
      IF v_clean_div_type IS NOT NULL AND v_division_rec.division_type <> v_clean_div_type THEN
        RAISE EXCEPTION 'CONFLICT: La división administrativa "%" tiene tipo "%", incompatible con el solicitado "%"',
          v_division_rec.id, v_division_rec.division_type, v_clean_div_type;
      END IF;

      -- Comprobar compatibilidad de nombre si fue provisto
      IF v_clean_div_name <> '' AND public.normalize_geo_name(v_division_rec.nombre) <> public.normalize_geo_name(v_clean_div_name) THEN
        RAISE EXCEPTION 'CONFLICT: El ID de división "%" corresponde a "%", incompatible con el nombre solicitado "%"',
          v_division_rec.id, v_division_rec.nombre, v_clean_div_name;
      END IF;

      -- Comprobar fuente e identificador externo si fueron provistos
      IF p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
        IF v_division_rec.source_id IS NOT NULL AND v_division_rec.source_id <> trim(p_division_source_id) THEN
          RAISE EXCEPTION 'CONFLICT: La división administrativa "%" tiene identificador externo "%" (%), incompatible con el solicitado "%" (%)',
            v_division_rec.id, v_division_rec.source_id, v_division_rec.source, p_division_source_id, v_clean_div_source;
        END IF;
        IF v_division_rec.source IS NOT NULL AND v_division_rec.source <> v_clean_div_source THEN
          RAISE EXCEPTION 'CONFLICT: La división administrativa "%" tiene fuente "%", incompatible con la solicitada "%"',
            v_division_rec.id, v_division_rec.source, v_clean_div_source;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Intento 2: Por código de fuente externa (source, source_id)
  IF v_division_rec.id IS NULL AND p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
    SELECT count(*) INTO v_match_count
    FROM public.administrative_divisions
    WHERE country_id = v_country_rec.id
      AND source = v_clean_div_source
      AND source_id = trim(p_division_source_id);

    IF v_match_count = 1 THEN
      SELECT id, country_id, nombre, division_type, source, source_id
      INTO v_division_rec
      FROM public.administrative_divisions
      WHERE country_id = v_country_rec.id
        AND source = v_clean_div_source
        AND source_id = trim(p_division_source_id);

      -- Validar compatibilidad de division_type si fue provisto
      IF v_clean_div_type IS NOT NULL AND v_division_rec.division_type <> v_clean_div_type THEN
        RAISE EXCEPTION 'CONFLICT: La división administrativa externa "%" tiene tipo "%", incompatible con el solicitado "%"',
          p_division_source_id, v_division_rec.division_type, v_clean_div_type;
      END IF;

      -- Validar compatibilidad de nombre si fue provisto
      IF v_clean_div_name <> '' AND public.normalize_geo_name(v_division_rec.nombre) <> public.normalize_geo_name(v_clean_div_name) THEN
        RAISE EXCEPTION 'CONFLICT: La división externa "%" corresponde a "%", incompatible con el nombre solicitado "%"',
          p_division_source_id, v_division_rec.nombre, v_clean_div_name;
      END IF;
    ELSIF v_match_count > 1 THEN
      RAISE EXCEPTION 'CONFLICT: Múltiples divisiones coincidentes para la fuente "%" y source_id "%" en el país "%"',
        v_clean_div_source, p_division_source_id, v_country_rec.id;
    END IF;
  END IF;

  -- Intento 3: Por coincidencia de nombre normalizado dentro del país
  IF v_division_rec.id IS NULL AND v_clean_div_name <> '' THEN
    SELECT count(*) INTO v_match_count
    FROM public.administrative_divisions
    WHERE country_id = v_country_rec.id
      AND public.normalize_geo_name(nombre) = public.normalize_geo_name(v_clean_div_name);

    IF v_match_count = 1 THEN
      SELECT id, country_id, nombre, division_type, source, source_id
      INTO v_division_rec
      FROM public.administrative_divisions
      WHERE country_id = v_country_rec.id
        AND public.normalize_geo_name(nombre) = public.normalize_geo_name(v_clean_div_name);

      -- Comprobar compatibilidad de division_type
      IF v_clean_div_type IS NOT NULL AND v_division_rec.division_type <> v_clean_div_type THEN
        RAISE EXCEPTION 'CONFLICT: La división "%" tiene tipo "%", incompatible con el solicitado "%"',
          v_clean_div_name, v_division_rec.division_type, v_clean_div_type;
      END IF;

      -- Comprobar compatibilidad de fuente y source_id
      IF p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
        IF v_division_rec.source_id IS NOT NULL AND v_division_rec.source_id <> trim(p_division_source_id) THEN
          RAISE EXCEPTION 'CONFLICT: División con mismo nombre "%" pero diferente source_id: registrada "%" (%) vs solicitada "%" (%)',
            v_clean_div_name, v_division_rec.source_id, v_division_rec.source, p_division_source_id, v_clean_div_source;
        ELSIF v_division_rec.source_id IS NULL THEN
          -- Si el registro existente no tiene source_id y la solicitud trae un identificador externo,
          -- no asumir identidad automática si hay fuente externa requerida
          RAISE EXCEPTION 'CONFLICT: Ambigüedad en división "%": el registro existente carece de identificador de fuente externa (source_id NULL) y no puede vincularse automáticamente con "%" (%)',
            v_clean_div_name, p_division_source_id, v_clean_div_source;
        END IF;
      END IF;
    ELSIF v_match_count > 1 THEN
      RAISE EXCEPTION 'CONFLICT: Múltiples divisiones coincidentes con el nombre "%" en el país "%"',
        v_clean_div_name, v_country_rec.id;
    END IF;
  END IF;

  -- Si no existe la división: verificar permisos estrictos y tipo territorial
  IF v_division_rec.id IS NULL THEN
    IF v_clean_div_name = '' THEN
      RAISE EXCEPTION 'BAD_REQUEST: No se especificó una división administrativa válida';
    END IF;

    -- Si no existe una regla territorial explícita ni se proporcionó p_division_type:
    IF v_clean_div_type IS NULL THEN
      RAISE EXCEPTION 'BAD_REQUEST: No se especificó "p_division_type" y no existe regla territorial predeterminada para el país "%". Debe especificarse explícitamente (ej. departamento, estado, provincia, region)', p_country_id;
    END IF;

    -- REGLA: ÚNICAMENTE ADMIN PUEDE CREAR DIVISIONES ADMINISTRATIVAS
    IF v_user_rol <> 'admin' THEN
      RAISE EXCEPTION 'FORBIDDEN: La división administrativa "%" no existe en Zenda. Solo administradores pueden incorporar nuevas divisiones territoriales.', v_clean_div_name;
    END IF;

    -- POLÍTICA CONSERVADORA DE GOBERNANZA TERRITORIAL:
    -- Únicamente el administrador principal de la organización (superior_id IS NULL)
    -- tiene la potestad de registrar nuevas divisiones administrativas globales.
    IF v_user_superior_id IS NOT NULL THEN
      RAISE EXCEPTION 'FORBIDDEN: La creación de nuevas divisiones territoriales globales requiere privilegios de administrador principal (sin superior_id)';
    END IF;

    -- Generar ID robusto para la división (sin truncar a 3 letras para evitar colisiones)
    IF p_division_id IS NOT NULL AND trim(p_division_id) <> '' AND trim(p_division_id) LIKE (v_country_rec.id || '-%') THEN
      v_target_div_id := upper(trim(p_division_id));
    ELSIF p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
      v_target_div_id := v_country_rec.id || '-DIV-' || upper(regexp_replace(trim(p_division_source_id), '[^a-zA-Z0-9]', '', 'g'));
    ELSIF v_clean_div_source = 'manual' THEN
      v_target_div_id := v_country_rec.id || '-DIV-MAN-' || upper(replace(gen_random_uuid()::text, '-', ''));
    ELSE
      v_safe_slug := upper(regexp_replace(public.normalize_geo_name(v_clean_div_name), '[^a-zA-Z0-9]', '', 'g'));
      v_target_div_id := v_country_rec.id || '-DIV-' || v_safe_slug;
    END IF;

    -- Deduplicación segura ante concurrencia simultánea
    BEGIN
      INSERT INTO public.administrative_divisions (
        id, country_id, parent_id, nombre, division_type, source, source_id, created_by, created_at
      ) VALUES (
        v_target_div_id,
        v_country_rec.id,
        NULL,
        v_clean_div_name,
        v_clean_div_type,
        v_clean_div_source,
        p_division_source_id,
        v_user_id,
        now()
      )
      RETURNING id, country_id, nombre, division_type, source, source_id
      INTO v_division_rec;
      v_new_div_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      v_division_rec := NULL;

      -- Regla A: Si la colisión fue por (source, source_id), recuperar únicamente misma fuente, source_id y país
      IF p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
        SELECT count(*) INTO v_match_count
        FROM public.administrative_divisions
        WHERE country_id = v_country_rec.id
          AND source = v_clean_div_source
          AND source_id = trim(p_division_source_id);

        IF v_match_count = 1 THEN
          SELECT id, country_id, nombre, division_type, source, source_id
          INTO v_division_rec
          FROM public.administrative_divisions
          WHERE country_id = v_country_rec.id
            AND source = v_clean_div_source
            AND source_id = trim(p_division_source_id);

          IF v_clean_div_type IS NOT NULL AND v_division_rec.division_type <> v_clean_div_type THEN
            RAISE EXCEPTION 'CONFLICT: La división externa "%" tiene tipo "%", incompatible con "%"',
              p_division_source_id, v_division_rec.division_type, v_clean_div_type;
          END IF;
        ELSIF v_match_count > 1 THEN
          RAISE EXCEPTION 'CONFLICT: Múltiples divisiones coincidentes para la fuente "%" y source_id "%" en el país "%"',
            v_clean_div_source, p_division_source_id, v_country_rec.id;
        END IF;
      END IF;

      -- Regla B: Colisión por ID primario comprobando país, nombre normalizado, tipo y fuente
      IF v_division_rec.id IS NULL THEN
        SELECT count(*) INTO v_match_count
        FROM public.administrative_divisions
        WHERE id = v_target_div_id;

        IF v_match_count = 1 THEN
          SELECT id, country_id, nombre, division_type, source, source_id
          INTO v_division_rec
          FROM public.administrative_divisions
          WHERE id = v_target_div_id;

          IF v_division_rec.country_id <> v_country_rec.id THEN
            RAISE EXCEPTION 'CONFLICT: La división con ID "%" pertenece al país "%", no al país "%"',
              v_division_rec.id, v_division_rec.country_id, v_country_rec.id;
          END IF;

          IF public.normalize_geo_name(v_division_rec.nombre) <> public.normalize_geo_name(v_clean_div_name) THEN
            RAISE EXCEPTION 'CONFLICT: El ID de división "%" ya está asignado a "%", no a "%"',
              v_division_rec.id, v_division_rec.nombre, v_clean_div_name;
          END IF;

          IF v_clean_div_type IS NOT NULL AND v_division_rec.division_type <> v_clean_div_type THEN
            RAISE EXCEPTION 'CONFLICT: La división "%" tiene tipo "%", incompatible con "%"',
              v_division_rec.id, v_division_rec.division_type, v_clean_div_type;
          END IF;

          -- Comprobación explícita de identificador externo en Regla B:
          IF p_division_source_id IS NOT NULL AND trim(p_division_source_id) <> '' THEN
            IF v_division_rec.source_id IS NULL THEN
              -- Si el registro existente no tiene identificador externo, no asumir automáticamente identidad
              RAISE EXCEPTION 'CONFLICT: Ambigüedad en división "%": el registro existente carece de identificador de fuente externa (source_id NULL) y no puede vincularse automáticamente con "%" (%)',
                v_division_rec.id, p_division_source_id, v_clean_div_source;
            ELSIF v_division_rec.source_id <> trim(p_division_source_id) THEN
              RAISE EXCEPTION 'CONFLICT: Ambigüedad en división "%": fuente registrada "%" (%) no coincide con la solicitada "%" (%)',
                v_division_rec.id, v_division_rec.source_id, v_division_rec.source, p_division_source_id, v_clean_div_source;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Regla C: Si ninguna comprobación verificó fehacientemente la identidad unívoca:
      IF v_division_rec.id IS NULL THEN
        RAISE EXCEPTION 'CONFLICT: Colisión de identificador no reconciliable para la división administrativa "%" en el país "%"',
          v_clean_div_name, v_country_rec.id;
      END IF;
    END;
  END IF;

  v_target_div_id := v_division_rec.id;

  -- -------------------------------------------------------------------
  -- 9. RECONCILIACIÓN Y VALIDACIÓN DE INTEGRIDAD DE LA CIUDAD
  -- -------------------------------------------------------------------
  v_city_rec := NULL;

  -- Intento 1: Por ID de ciudad especificado si viene en el input
  IF p_city_id IS NOT NULL AND trim(p_city_id) <> '' THEN
    SELECT * INTO v_city_rec
    FROM public.cities
    WHERE id = trim(p_city_id);

    IF v_city_rec.id IS NOT NULL THEN
      IF v_city_rec.country_id <> v_country_rec.id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con ID "%" pertenece al país "%", no al país "%"',
          v_city_rec.id, v_city_rec.country_id, v_country_rec.id;
      END IF;
      IF v_city_rec.administrative_division_id <> v_target_div_id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con ID "%" pertenece a la división "%", no a la división "%"',
          v_city_rec.id, v_city_rec.administrative_division_id, v_target_div_id;
      END IF;
      -- Comprobar si el nombre coincide con la misma localidad; si difiere, rechazar colisión
      IF public.normalize_geo_name(v_city_rec.nombre) <> public.normalize_geo_name(v_clean_city_name) THEN
        RAISE EXCEPTION 'CONFLICT: El ID "%" ya está asignado a la ciudad "%", diferente de "%"',
          v_city_rec.id, v_city_rec.nombre, v_clean_city_name;
      END IF;
    END IF;
  END IF;

  -- Intento 2: Por unicidad de fuente externa (source, source_id)
  IF v_city_rec.id IS NULL AND p_source_id IS NOT NULL AND trim(p_source_id) <> '' THEN
    SELECT count(*) INTO v_match_count
    FROM public.cities
    WHERE source = v_clean_source
      AND source_id = trim(p_source_id);

    IF v_match_count = 1 THEN
      SELECT * INTO v_city_rec
      FROM public.cities
      WHERE source = v_clean_source
        AND source_id = trim(p_source_id);

      IF v_city_rec.country_id <> v_country_rec.id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con source_id "%" (%) pertenece al país "%", no al país "%"',
          p_source_id, v_clean_source, v_city_rec.country_id, v_country_rec.id;
      END IF;
      IF v_city_rec.administrative_division_id <> v_target_div_id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con source_id "%" (%) pertenece a la división "%", no a la división "%"',
          p_source_id, v_clean_source, v_city_rec.administrative_division_id, v_target_div_id;
      END IF;
    ELSIF v_match_count > 1 THEN
      RAISE EXCEPTION 'CONFLICT: Múltiples ciudades encontradas para la fuente "%" y source_id "%"',
        v_clean_source, p_source_id;
    END IF;
  END IF;

  -- Intento 3: Por geoname_id si existe
  IF v_city_rec.id IS NULL AND p_geoname_id IS NOT NULL AND trim(p_geoname_id) <> '' THEN
    SELECT count(*) INTO v_match_count
    FROM public.cities
    WHERE geoname_id = trim(p_geoname_id);

    IF v_match_count = 1 THEN
      SELECT * INTO v_city_rec
      FROM public.cities
      WHERE geoname_id = trim(p_geoname_id);

      IF v_city_rec.country_id <> v_country_rec.id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con geoname_id "%" pertenece al país "%", no al país "%"',
          p_geoname_id, v_city_rec.country_id, v_country_rec.id;
      END IF;
      IF v_city_rec.administrative_division_id <> v_target_div_id THEN
        RAISE EXCEPTION 'CONFLICT: La ciudad con geoname_id "%" pertenece a la división "%", no a la división "%"',
          p_geoname_id, v_city_rec.administrative_division_id, v_target_div_id;
      END IF;
    ELSIF v_match_count > 1 THEN
      RAISE EXCEPTION 'CONFLICT: Múltiples ciudades coincidentes con el geoname_id "%"',
        p_geoname_id;
    END IF;
  END IF;

  -- Intento 4: Por nombre normalizado dentro de la división y país explícitos
  IF v_city_rec.id IS NULL THEN
    -- Validación preventiva: detectar si existe un registro corrupto en la división con país inconsistente
    IF EXISTS (
      SELECT 1 FROM public.cities
      WHERE administrative_division_id = v_target_div_id
        AND public.normalize_geo_name(nombre) = public.normalize_geo_name(v_clean_city_name)
        AND country_id <> v_country_rec.id
    ) THEN
      RAISE EXCEPTION 'CONFLICT: Inconsistencia relacional: la ciudad "%" en la división "%" tiene un country_id que no coincide con "%"',
        v_clean_city_name, v_target_div_id, v_country_rec.id;
    END IF;

    -- Contar coincidencias con validación conjunta estricta: country_id + administrative_division_id + nombre normalizado
    SELECT count(*) INTO v_match_count
    FROM public.cities
    WHERE country_id = v_country_rec.id
      AND administrative_division_id = v_target_div_id
      AND public.normalize_geo_name(nombre) = public.normalize_geo_name(v_clean_city_name);

    IF v_match_count > 1 THEN
      RAISE EXCEPTION 'CONFLICT: Múltiples coincidencias ambiguas (%) para la ciudad "%" en la división "%" del país "%"',
        v_match_count, v_clean_city_name, v_target_div_id, v_country_rec.id;
    ELSIF v_match_count = 1 THEN
      SELECT * INTO v_city_rec
      FROM public.cities
      WHERE country_id = v_country_rec.id
        AND administrative_division_id = v_target_div_id
        AND public.normalize_geo_name(nombre) = public.normalize_geo_name(v_clean_city_name);
    END IF;
  END IF;

  -- Inserción / Deduplicación concurrente de la ciudad
  IF v_city_rec.id IS NULL THEN
    IF p_geoname_id IS NOT NULL AND trim(p_geoname_id) <> '' THEN
      v_target_city_id := v_target_div_id || '-GEO' || trim(p_geoname_id);
    ELSIF p_city_id IS NOT NULL AND trim(p_city_id) <> '' AND trim(p_city_id) LIKE (v_target_div_id || '-%') THEN
      v_target_city_id := trim(p_city_id);
    ELSE
      -- Ubicación manual: Generación de identificador único UUID-backed libre de colisiones
      -- Cumple con el estándar [DIV]-MAN-[UUID] eliminando fragmentos truncados de 3 letras
      v_target_city_id := v_target_div_id || '-MAN-' || upper(replace(gen_random_uuid()::text, '-', ''));
    END IF;

    -- Concurrency-safe Insert: captura colisiones simultáneas y recupera registro canónico fehaciente
    BEGIN
      INSERT INTO public.cities (
        id, country_id, administrative_division_id, nombre, geoname_id, latitude, longitude, timezone,
        source, source_id, type, enabled, created_by, created_at
      ) VALUES (
        v_target_city_id,
        v_country_rec.id,
        v_target_div_id,
        v_clean_city_name,
        p_geoname_id,
        p_latitude,
        p_longitude,
        coalesce(p_timezone, v_country_rec.timezone_default),
        v_clean_source,
        case when v_clean_source = 'geonames' then coalesce(p_source_id, p_geoname_id) else NULL end,
        v_clean_city_type,
        true,
        v_user_id,
        now()
      )
      RETURNING * INTO v_city_rec;
      v_new_city_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      v_city_rec := NULL;

      -- Regla A: Si la colisión fue por (source, source_id), recuperar únicamente misma fuente y source_id
      IF p_source_id IS NOT NULL AND trim(p_source_id) <> '' THEN
        SELECT count(*) INTO v_match_count
        FROM public.cities
        WHERE country_id = v_country_rec.id
          AND administrative_division_id = v_target_div_id
          AND source = v_clean_source
          AND source_id = trim(p_source_id);

        IF v_match_count = 1 THEN
          SELECT * INTO v_city_rec
          FROM public.cities
          WHERE country_id = v_country_rec.id
            AND administrative_division_id = v_target_div_id
            AND source = v_clean_source
            AND source_id = trim(p_source_id);
        ELSIF v_match_count > 1 THEN
          RAISE EXCEPTION 'CONFLICT: Múltiples ciudades coincidentes para la fuente "%" y source_id "%" en la división "%"',
            v_clean_source, p_source_id, v_target_div_id;
        END IF;
      END IF;

      -- Regla B: Colisión por ID primario comprobando país, división y nombre
      IF v_city_rec.id IS NULL THEN
        SELECT count(*) INTO v_match_count
        FROM public.cities
        WHERE id = v_target_city_id;

        IF v_match_count = 1 THEN
          SELECT * INTO v_city_rec
          FROM public.cities
          WHERE id = v_target_city_id;

          IF v_city_rec.country_id <> v_country_rec.id THEN
            RAISE EXCEPTION 'CONFLICT: La ciudad con ID "%" pertenece al país "%", no al país "%"',
              v_city_rec.id, v_city_rec.country_id, v_country_rec.id;
          END IF;
          IF v_city_rec.administrative_division_id <> v_target_div_id THEN
            RAISE EXCEPTION 'CONFLICT: La ciudad con ID "%" pertenece a la división "%", no a la división "%"',
              v_city_rec.id, v_city_rec.administrative_division_id, v_target_div_id;
          END IF;
          IF public.normalize_geo_name(v_city_rec.nombre) <> public.normalize_geo_name(v_clean_city_name) THEN
            RAISE EXCEPTION 'CONFLICT: El ID de ciudad "%" ya está asignado a "%", no a "%"',
              v_city_rec.id, v_city_rec.nombre, v_clean_city_name;
          END IF;
        END IF;
      END IF;

      -- Regla C: Si fue por geoname_id si existiese colisión externa
      IF v_city_rec.id IS NULL AND p_geoname_id IS NOT NULL AND trim(p_geoname_id) <> '' THEN
        SELECT count(*) INTO v_match_count
        FROM public.cities
        WHERE country_id = v_country_rec.id
          AND administrative_division_id = v_target_div_id
          AND geoname_id = trim(p_geoname_id);

        IF v_match_count = 1 THEN
          SELECT * INTO v_city_rec
          FROM public.cities
          WHERE country_id = v_country_rec.id
            AND administrative_division_id = v_target_div_id
            AND geoname_id = trim(p_geoname_id);
        ELSIF v_match_count > 1 THEN
          RAISE EXCEPTION 'CONFLICT: Múltiples ciudades coincidentes para geoname_id "%" en la división "%"',
            p_geoname_id, v_target_div_id;
        END IF;
      END IF;

      -- Regla D: Si ninguna comprobación verificó fehacientemente la identidad unívoca:
      IF v_city_rec.id IS NULL THEN
        RAISE EXCEPTION 'CONFLICT: Colisión de identificador no reconciliable para la ciudad "%" en la división "%" del país "%"',
          v_clean_city_name, v_target_div_id, v_country_rec.id;
      END IF;

      v_reconciled := true;
    END;
  ELSE
    v_reconciled := true;
    -- PROTECCIÓN CONTRA MODIFICACIONES ARBITRARIAS:
    -- NO se alteran nombre, source, type ni divisiones de registros existentes.
    -- Únicamente se enriquecen coordenadas o geoname_id si previamente eran NULL.
    IF (v_city_rec.geoname_id IS NULL AND p_geoname_id IS NOT NULL)
       OR (v_city_rec.latitude IS NULL AND p_latitude IS NOT NULL)
       OR (v_city_rec.longitude IS NULL AND p_longitude IS NOT NULL)
       OR (v_city_rec.timezone IS NULL AND p_timezone IS NOT NULL) THEN
      UPDATE public.cities
      SET
        geoname_id = coalesce(public.cities.geoname_id, p_geoname_id),
        latitude = coalesce(public.cities.latitude, p_latitude),
        longitude = coalesce(public.cities.longitude, p_longitude),
        timezone = coalesce(public.cities.timezone, p_timezone)
      WHERE id = v_city_rec.id
      RETURNING * INTO v_city_rec;
    END IF;
  END IF;

  -- 10. Retorno estructurado transaccional
  RETURN json_build_object(
    'success', true,
    'reconciled', v_reconciled,
    'created_new_city', v_new_city_inserted,
    'created_new_division', v_new_div_inserted,
    'city', json_build_object(
      'id', v_city_rec.id,
      'nombre', v_city_rec.nombre,
      'country_id', v_city_rec.country_id,
      'administrative_division_id', v_city_rec.administrative_division_id,
      'geoname_id', v_city_rec.geoname_id,
      'latitude', v_city_rec.latitude,
      'longitude', v_city_rec.longitude,
      'timezone', v_city_rec.timezone,
      'source', v_city_rec.source,
      'source_id', v_city_rec.source_id,
      'type', v_city_rec.type,
      'enabled', v_city_rec.enabled
    ),
    'division', json_build_object(
      'id', v_division_rec.id,
      'nombre', v_division_rec.nombre,
      'country_id', v_division_rec.country_id,
      'division_type', v_division_rec.division_type,
      'source', v_division_rec.source,
      'source_id', v_division_rec.source_id
    ),
    'country', json_build_object(
      'id', v_country_rec.id,
      'nombre', v_country_rec.nombre,
      'currency_code', v_country_rec.currency_code
    )
  );
END;
$$;

-- 4. SEGURIDAD Y PERMISOS ENDURECIDOS
-- Revocar explícitamente a PUBLIC y anon para impedir ejecuciones anónimas
REVOKE ALL ON FUNCTION public.register_geographic_location FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_geo_name FROM PUBLIC, anon;

-- Conceder ejecución exclusivamente al rol autenticado del sistema
GRANT EXECUTE ON FUNCTION public.register_geographic_location TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_geo_name TO authenticated;
