/**
 * src/services/geoService.js
 * Servicio de catálogo geográfico dinámico bajo demanda para Zenda.
 * Combina catálogo maestro local (offline-first), búsqueda externa (GeoNames)
 * y persistencia selectiva transaccional en Supabase y SQLite.
 */

import geoMasterCatalog from '../data/geo/geoMasterCatalog.json';
import { getCurrencyConfig } from '../utils/currency';
import { searchGeoNamesCities } from './geonamesService';

// Referencias lazily cargadas para Supabase para evitar evaluación de polyfills en testing
let cachedSupabase = null;
let cachedEnsureAuth = null;

function getSupabaseModules() {
  if (!cachedSupabase) {
    try {
      const sb = require('../lib/supabase');
      cachedSupabase = sb.supabase;
      cachedEnsureAuth = sb.ensureAuthenticatedSession;
    } catch (e) {
      console.warn('[geoService] No fue posible cargar el módulo de Supabase:', e.message);
    }
  }
  return { supabase: cachedSupabase, ensureAuthenticatedSession: cachedEnsureAuth };
}

// Copia mutable en memoria del catálogo para incorporar ubicaciones dinámicas sin reiniciar
export const GEO_DATA = {
  ...geoMasterCatalog,
  administrative_divisions: [...geoMasterCatalog.administrative_divisions],
  cities: [...geoMasterCatalog.cities],
};

/**
 * Normaliza cadenas para comparaciones geográficas insensibles a mayúsculas, diacríticos y puntuación
 */
export const normalizeGeoString = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
};

/**
 * Obtiene todos los países habilitados
 */
export const getCountries = () => {
  return GEO_DATA.countries.filter(c => c.enabled);
};

/**
 * Obtiene un país por su ID o código ISO2
 */
export const getCountryById = (countryId) => {
  if (!countryId) return null;
  const id = countryId.toUpperCase();
  return GEO_DATA.countries.find(c => c.id === id || c.iso2 === id || c.iso3 === id) || null;
};

/**
 * Obtiene las divisiones administrativas de un país
 */
export const getAdministrativeDivisions = (countryId) => {
  if (!countryId) return [];
  const id = countryId.toUpperCase();
  return GEO_DATA.administrative_divisions.filter(d => d.country_id === id);
};

/**
 * Obtiene las ciudades pertenecientes a una división administrativa
 */
export const getCities = (divisionId) => {
  if (!divisionId) return [];
  return GEO_DATA.cities.filter(c => c.administrative_division_id === divisionId && c.enabled);
};

/**
 * Obtiene una ciudad por su ID
 */
export const getCityById = (cityId) => {
  if (!cityId) return null;
  return GEO_DATA.cities.find(c => c.id === cityId) || null;
};

/**
 * Obtiene la configuración regional completa (Moneda, Locale, Timezone)
 * a partir del país y opcionalmente la ciudad seleccionada.
 */
export const getRegionalConfig = (countryId, cityId = null) => {
  const country = getCountryById(countryId) || getCountryById('CO');
  const city = getCityById(cityId);

  const currencyCode = country.currency_code || 'COP';
  const currency = getCurrencyConfig(currencyCode);
  const locale = country.locale || 'es-CO';
  const timezone = (city && city.timezone) ? city.timezone : (country.timezone_default || 'America/Bogota');

  return {
    country_id: country.id,
    country_name: country.nombre,
    currency_code: currencyCode,
    currency,
    locale,
    timezone,
    city_id: city ? city.id : null,
    city_name: city ? city.nombre : null,
  };
};

/**
 * Búsqueda geográfica progresiva bajo demanda:
 * 1. Busca primero en el catálogo local (memoria / SQLite).
 * 2. Si no hay suficientes resultados o el usuario busca algo específico, consulta GeoNames.
 * 3. Normaliza y deduplica resultados externos contra los locales.
 *
 * @param {Object} params
 * @param {string} params.query - Texto a buscar
 * @param {string} params.countryId - Código de país ISO-2 (ej: 'CO')
 * @param {string} [params.divisionId] - ID de división opcional para acotar
 * @param {boolean} [params.allowExternal=true] - Si permite consultar GeoNames
 * @returns {Promise<{ localResults: Array, externalResults: Array, allResults: Array }>}
 */
export const searchLocationsOnDemand = async ({
  query,
  countryId,
  divisionId = null,
  allowExternal = true,
}) => {
  const cleanQ = (query || '').trim();
  const normQ = normalizeGeoString(cleanQ);
  const targetCountry = (countryId || 'CO').toUpperCase();

  // 1. Búsqueda local en el catálogo en memoria (instantánea y offline)
  let localMatches = GEO_DATA.cities.filter(city => {
    if (city.country_id !== targetCountry) return false;
    if (divisionId && city.administrative_division_id !== divisionId) return false;
    if (!normQ) return true;
    return normalizeGeoString(city.nombre).includes(normQ);
  });

  // Mapear division_name a cada resultado local
  localMatches = localMatches.map(c => {
    const div = GEO_DATA.administrative_divisions.find(d => d.id === c.administrative_division_id);
    return {
      ...c,
      division_name: div ? div.nombre : '',
      is_external: false,
    };
  });

  // Si no se solicita búsqueda externa o el texto es muy corto (< 3 caracteres), retornar locales
  if (!allowExternal || cleanQ.length < 3) {
    return {
      localResults: localMatches,
      externalResults: [],
      allResults: localMatches,
    };
  }

  // 2. Consulta externa a GeoNames
  let externalMatches = [];
  try {
    const geoNamesRes = await searchGeoNamesCities({
      query: cleanQ,
      countryCode: targetCountry,
      maxRows: 10,
    });

    if (geoNamesRes.success && Array.isArray(geoNamesRes.items)) {
      const knownDivisions = getAdministrativeDivisions(targetCountry);

      for (const extItem of geoNamesRes.items) {
        // Verificar si ya existe localmente por geoname_id o por nombre normalizado
        const normExtName = normalizeGeoString(extItem.nombre);
        const alreadyLocal = localMatches.some(loc => {
          if (loc.geoname_id && loc.geoname_id === extItem.geoname_id) return true;
          if (loc.source === 'geonames' && loc.source_id === extItem.source_id) return true;
          return normalizeGeoString(loc.nombre) === normExtName;
        });

        if (alreadyLocal) {
          continue; // Evitar duplicados visuales entre local y externo
        }

        // Intentar correlacionar la división administrativa externa con una división local
        let matchedDiv = null;
        if (divisionId) {
          matchedDiv = knownDivisions.find(d => d.id === divisionId);
        } else if (extItem.division_name) {
          const normExtDiv = normalizeGeoString(extItem.division_name);
          matchedDiv = knownDivisions.find(d => {
            const normLocalDiv = normalizeGeoString(d.nombre);
            return normLocalDiv === normExtDiv || normExtDiv.includes(normLocalDiv);
          });
        }

        externalMatches.push({
          ...extItem,
          administrative_division_id: matchedDiv ? matchedDiv.id : null,
          division_name: matchedDiv ? matchedDiv.nombre : extItem.division_name,
          is_external: true,
        });
      }
    }
  } catch (err) {
    console.warn('[geoService] Error en búsqueda externa GeoNames:', err.message);
  }

  return {
    localResults: localMatches,
    externalResults: externalMatches,
    allResults: [...localMatches, ...externalMatches],
  };
};

/**
 * Persiste una ubicación registrada o seleccionada en SQLite de forma atómica y sin destruir datos
 */
export const saveLocationToSQLite = async (db, { city, division = null }) => {
  if (!db || !city) return false;

  try {
    // 1. Guardar o actualizar la división si se suministra
    if (division && division.id) {
      await db.executeSql(
        `INSERT INTO administrative_divisions (id, country_id, parent_id, nombre, division_type, source, source_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           country_id = excluded.country_id,
           parent_id = excluded.parent_id,
           nombre = excluded.nombre,
           division_type = excluded.division_type,
           source = excluded.source,
           source_id = excluded.source_id`,
        [
          division.id,
          division.country_id,
          division.parent_id || null,
          division.nombre,
          division.division_type || 'departamento',
          division.source || 'geonames',
          division.source_id || null,
        ]
      );

      // Actualizar memoria si es nueva división
      if (!GEO_DATA.administrative_divisions.some(d => d.id === division.id)) {
        GEO_DATA.administrative_divisions.push(division);
      }
    }

    // 2. Guardar o actualizar la ciudad con UPSERT
    await db.executeSql(
      `INSERT INTO cities (
         id, country_id, administrative_division_id, nombre, geoname_id, latitude, longitude, timezone, source, source_id, type, enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         country_id = excluded.country_id,
         administrative_division_id = excluded.administrative_division_id,
         nombre = excluded.nombre,
         geoname_id = coalesce(excluded.geoname_id, cities.geoname_id),
         latitude = coalesce(excluded.latitude, cities.latitude),
         longitude = coalesce(excluded.longitude, cities.longitude),
         timezone = coalesce(excluded.timezone, cities.timezone),
         source = excluded.source,
         source_id = excluded.source_id,
         type = excluded.type,
         enabled = excluded.enabled`,
      [
        city.id,
        city.country_id,
        city.administrative_division_id,
        city.nombre,
        city.geoname_id || null,
        city.latitude != null ? city.latitude : null,
        city.longitude != null ? city.longitude : null,
        city.timezone || null,
        city.source || 'geonames',
        city.source_id || null,
        city.type || 'ciudad',
        city.enabled !== false ? 1 : 0,
      ]
    );

    // Actualizar catálogo en memoria para disponibilidad inmediata
    const existingIdx = GEO_DATA.cities.findIndex(c => c.id === city.id);
    if (existingIdx >= 0) {
      GEO_DATA.cities[existingIdx] = { ...GEO_DATA.cities[existingIdx], ...city };
    } else {
      GEO_DATA.cities.push(city);
    }

    return true;
  } catch (err) {
    console.error('[geoService] Error guardando ubicación en SQLite:', err);
    return false;
  }
};

/**
 * Registra una ubicación seleccionada o manual en Supabase a través de la RPC dedicada
 * y la sincroniza selectivamente con SQLite.
 */
export const registerLocationOnDemand = async (locationData, { db = null, supabaseClient = null } = {}) => {
  try {
    const { supabase: defaultSb, ensureAuthenticatedSession: defaultAuth } = getSupabaseModules();
    const sb = supabaseClient || defaultSb;

    if (defaultAuth) {
      await defaultAuth();
    }

    if (!sb) {
      return {
        success: false,
        error: 'Cliente de base de datos no disponible',
      };
    }

    const rpcParams = {
      p_country_id: locationData.country_id,
      p_division_id: locationData.administrative_division_id || locationData.division_id || null,
      p_division_nombre: locationData.division_name || locationData.division_nombre || null,
      p_division_type: locationData.division_type || null,
      p_division_source: locationData.division_source || 'geonames',
      p_division_source_id: locationData.division_source_id || null,
      p_city_nombre: locationData.nombre,
      p_city_id: locationData.id || null,
      p_geoname_id: locationData.geoname_id ? String(locationData.geoname_id) : null,
      p_latitude: locationData.latitude != null ? parseFloat(locationData.latitude) : null,
      p_longitude: locationData.longitude != null ? parseFloat(locationData.longitude) : null,
      p_timezone: locationData.timezone || null,
      p_source: locationData.source || 'geonames',
      p_source_id: locationData.source_id ? String(locationData.source_id) : null,
      p_type: locationData.type || null,
    };

    const { data, error } = await sb.rpc('register_geographic_location', rpcParams);

    if (error) {
      return {
        success: false,
        error: error.message || 'Error registrando ubicación geográfica',
      };
    }

    if (!data || !data.city) {
      return {
        success: false,
        error: 'Respuesta inválida del servidor geográfico',
      };
    }

    // Sincronizar selectivamente con SQLite si la conexión local está disponible
    if (db) {
      await saveLocationToSQLite(db, {
        city: data.city,
        division: data.division,
        country: data.country,
      });
    } else {
      // Si no hay db directa, actualizar catálogo en memoria conservando campos preexistentes
      const existingIdx = GEO_DATA.cities.findIndex(c => c.id === data.city.id);
      if (existingIdx >= 0) {
        GEO_DATA.cities[existingIdx] = { ...GEO_DATA.cities[existingIdx], ...data.city };
      } else {
        GEO_DATA.cities.push({ enabled: true, ...data.city });
      }
    }

    return {
      success: true,
      city: data.city,
      division: data.division,
      country: data.country,
      reconciled: data.reconciled,
      created_new_city: data.created_new_city,
      created_new_division: data.created_new_division,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Error de conexión o permisos',
    };
  }
};

/**
 * Inicializa y sincroniza las tablas geográficas en SQLite
 * REGLA FASE 4: Utiliza UPSERT nativo (ON CONFLICT DO UPDATE SET) en lugar de INSERT OR REPLACE
 * para preservar ubicaciones dinámicas y evitar borrados accidentales en cascada.
 */
export const syncGeoCatalogToSQLite = async (db) => {
  try {
    // 1. Crear tablas si no existen
    await db.executeSql(`CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      nombre TEXT,
      symbol TEXT,
      decimal_digits INTEGER,
      enabled INTEGER DEFAULT 1
    )`);

    await db.executeSql(`CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      iso2 TEXT UNIQUE,
      iso3 TEXT UNIQUE,
      nombre TEXT,
      currency_code TEXT,
      locale TEXT,
      timezone_default TEXT,
      enabled INTEGER DEFAULT 1
    )`);

    await db.executeSql(`CREATE TABLE IF NOT EXISTS administrative_divisions (
      id TEXT PRIMARY KEY,
      country_id TEXT,
      parent_id TEXT,
      nombre TEXT,
      division_type TEXT,
      source TEXT,
      source_id TEXT
    )`);

    await db.executeSql(`CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      country_id TEXT,
      administrative_division_id TEXT,
      nombre TEXT,
      geoname_id TEXT,
      latitude REAL,
      longitude REAL,
      timezone TEXT,
      source TEXT,
      source_id TEXT,
      type TEXT DEFAULT 'ciudad',
      enabled INTEGER DEFAULT 1
    )`);

    // Migraciones seguras para columnas añadidas
    try {
      await db.executeSql(`ALTER TABLE cities ADD COLUMN source_id TEXT`);
    } catch {}
    try {
      await db.executeSql(`ALTER TABLE cities ADD COLUMN type TEXT DEFAULT 'ciudad'`);
    } catch {}

    // Índices de unicidad contextual por fuente
    try {
      await db.executeSql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_cities_source_source_id ON cities (source, source_id)`);
    } catch {}
    try {
      await db.executeSql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_admin_div_source_source_id ON administrative_divisions (source, source_id)`);
    } catch {}

    // 2. Poblar monedas con UPSERT (preserva integridad referencial)
    for (const c of GEO_DATA.currencies) {
      await db.executeSql(
        `INSERT INTO currencies (code, nombre, symbol, decimal_digits, enabled)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (code) DO UPDATE SET
           nombre = excluded.nombre,
           symbol = excluded.symbol,
           decimal_digits = excluded.decimal_digits,
           enabled = excluded.enabled`,
        [c.code, c.nombre, c.symbol, c.decimal_digits, c.enabled ? 1 : 0]
      );
    }

    // 3. Poblar países con UPSERT
    for (const c of GEO_DATA.countries) {
      await db.executeSql(
        `INSERT INTO countries (id, iso2, iso3, nombre, currency_code, locale, timezone_default, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           iso2 = excluded.iso2,
           iso3 = excluded.iso3,
           nombre = excluded.nombre,
           currency_code = excluded.currency_code,
           locale = excluded.locale,
           timezone_default = excluded.timezone_default,
           enabled = excluded.enabled`,
        [c.id, c.iso2, c.iso3, c.nombre, c.currency_code, c.locale, c.timezone_default, c.enabled ? 1 : 0]
      );
    }

    // 4. Poblar divisiones con UPSERT (no sobreescribe divisiones dinámicas existentes)
    for (const d of GEO_DATA.administrative_divisions) {
      await db.executeSql(
        `INSERT INTO administrative_divisions (id, country_id, parent_id, nombre, division_type, source, source_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           country_id = excluded.country_id,
           parent_id = excluded.parent_id,
           nombre = excluded.nombre,
           division_type = excluded.division_type,
           source = excluded.source,
           source_id = excluded.source_id`,
        [d.id, d.country_id, d.parent_id || null, d.nombre, d.division_type, d.source || 'dane_divipola', d.source_id || null]
      );
    }

    // 5. Poblar ciudades y municipios semilla con UPSERT (preserva ubicaciones dinámicas creadas por el usuario)
    for (const c of GEO_DATA.cities) {
      await db.executeSql(
        `INSERT INTO cities (
           id, country_id, administrative_division_id, nombre, geoname_id, latitude, longitude, timezone, source, source_id, type, enabled
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           country_id = excluded.country_id,
           administrative_division_id = excluded.administrative_division_id,
           nombre = excluded.nombre,
           geoname_id = coalesce(excluded.geoname_id, cities.geoname_id),
           latitude = coalesce(excluded.latitude, cities.latitude),
           longitude = coalesce(excluded.longitude, cities.longitude),
           timezone = coalesce(excluded.timezone, cities.timezone),
           source = excluded.source,
           source_id = excluded.source_id,
           type = excluded.type,
           enabled = excluded.enabled`,
        [
          c.id,
          c.country_id,
          c.administrative_division_id,
          c.nombre,
          c.geoname_id || null,
          c.latitude != null ? c.latitude : null,
          c.longitude != null ? c.longitude : null,
          c.timezone || null,
          c.source || 'dane_divipola',
          c.source_id || null,
          c.type || 'ciudad',
          c.enabled ? 1 : 0,
        ]
      );
    }

    return true;
  } catch (err) {
    console.log('[geoService] Error syncing geo catalog to SQLite:', err);
    return false;
  }
};

export default {
  GEO_DATA,
  normalizeGeoString,
  getCountries,
  getCountryById,
  getAdministrativeDivisions,
  getCities,
  getCityById,
  getRegionalConfig,
  searchLocationsOnDemand,
  registerLocationOnDemand,
  saveLocationToSQLite,
  syncGeoCatalogToSQLite,
};
