/**
 * src/services/geonamesService.js
 * Servicio cliente desacoplado para consulta de lugares poblados en GeoNames Web Services.
 *
 * TÉRMINOS Y LÍMITES DE USO GEONAMES (geonames.org):
 * - Licencia: Creative Commons Attribution 4.0 (CC BY 4.0).
 * - Atribución obligatoria: "Datos geográficos provistos por GeoNames (geonames.org)".
 * - Cuota gratuita estándar: 2.000 créditos por hora y 30.000 créditos por día por cuenta.
 * - Tratamiento de credencial: 'GEONAMES_USERNAME' es un identificador de cuenta pública
 *   para peticiones HTTP GET y no constituye un secreto o clave privada criptográfica.
 * - Resiliencia: Incluye AbortController (timeout de 6s), caché en memoria (TTL 10 min)
 *   y normalización defensiva de respuestas.
 */

export const GEONAMES_DEFAULT_USERNAME = 'zenda_app';
const GEONAMES_BASE_URL = 'https://secure.geonames.org/searchJSON';
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Caché en memoria para evitar consultas repetidas durante la sesión
const searchCache = new Map();

/**
 * Limpia entradas expiradas de la caché en memoria
 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      searchCache.delete(key);
    }
  }
}

/**
 * Normaliza una entidad de lugar poblado retornada por GeoNames
 */
export function normalizeGeoNamesPlace(item) {
  if (!item || !item.geonameId) return null;

  return {
    geoname_id: String(item.geonameId),
    nombre: (item.name || '').trim(),
    country_id: (item.countryCode || '').toUpperCase().trim(),
    country_name: (item.countryName || '').trim(),
    division_source_id: item.adminCode1 ? String(item.adminCode1).trim() : null,
    division_name: (item.adminName1 || '').trim(),
    latitude: item.lat != null ? parseFloat(item.lat) : null,
    longitude: item.lng != null ? parseFloat(item.lng) : null,
    timezone: item.timezone && item.timezone.timeZoneId ? item.timezone.timeZoneId : null,
    source: 'geonames',
    source_id: String(item.geonameId),
    type: item.fcode === 'PPLC' ? 'ciudad_capital' : 'ciudad',
    is_external: true,
  };
}

/**
 * Realiza una búsqueda de ciudades/municipios en GeoNames bajo demanda
 *
 * @param {Object} options
 * @param {string} options.query - Nombre o prefijo del municipio/ciudad (mín. 3 caracteres)
 * @param {string} options.countryCode - Código ISO-2 de 2 letras (ej. 'CO', 'MX', 'PE')
 * @param {number} [options.maxRows=10] - Cantidad máxima de resultados
 * @param {string} [options.username] - Identificador de usuario GeoNames (opcional)
 * @param {number} [options.timeoutMs=6000] - Tiempo máximo de espera en milisegundos
 * @returns {Promise<{ success: boolean, items: Array, fromCache?: boolean, error?: string }>}
 */
export async function searchGeoNamesCities({
  query,
  countryCode,
  maxRows = 10,
  username = GEONAMES_DEFAULT_USERNAME,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const cleanQuery = (query || '').trim();
  const cleanCountry = (countryCode || '').toUpperCase().trim();

  // Validación de precondición: mínimo 3 caracteres para evitar consultas ineficientes
  if (cleanQuery.length < 3) {
    return { success: true, items: [], fromCache: false };
  }

  const cacheKey = `${cleanCountry}:${cleanQuery.toLowerCase()}`;
  cleanExpiredCache();

  // Verificar caché en memoria
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { success: true, items: cached.data, fromCache: true };
    }
  }

  // Configuración de abort controller para timeout
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const params = new URLSearchParams({
      q: cleanQuery,
      featureClass: 'P', // Populated place
      maxRows: String(maxRows),
      style: 'FULL',
      lang: 'es',
      username: username || GEONAMES_DEFAULT_USERNAME,
    });

    if (cleanCountry) {
      params.append('country', cleanCountry);
    }

    const url = `${GEONAMES_BASE_URL}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller ? controller.signal : undefined,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        items: [],
        error: `HTTP_${response.status}`,
      };
    }

    const json = await response.json();

    // Manejo de errores específicos de la API de GeoNames (ej. límite de créditos)
    if (json.status && json.status.message) {
      console.warn('[GeoNames] API status notice:', json.status.message);
      return {
        success: false,
        items: [],
        error: json.status.value === 19 ? 'RATE_LIMIT_EXCEEDED' : json.status.message,
      };
    }

    const rawGeonames = Array.isArray(json.geonames) ? json.geonames : [];
    const normalized = rawGeonames
      .map(normalizeGeoNamesPlace)
      .filter(item => item && item.nombre);

    // Guardar en caché
    searchCache.set(cacheKey, {
      data: normalized,
      timestamp: Date.now(),
    });

    return {
      success: true,
      items: normalized,
      fromCache: false,
    };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
    return {
      success: false,
      items: [],
      error: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
  }
}

/**
 * Limpia completamente la caché de búsquedas en memoria
 */
export function clearGeoNamesCache() {
  searchCache.clear();
}

export default {
  GEONAMES_DEFAULT_USERNAME,
  normalizeGeoNamesPlace,
  searchGeoNamesCities,
  clearGeoNamesCache,
};

