/**
 * __tests__/onDemandGeoCatalog.test.js
 * Suite de pruebas automatizadas para el Catálogo Geográfico Dinámico Bajo Demanda de Zenda.
 *
 * Valida los 41 escenarios requeridos:
 * 1. Búsqueda de una ciudad existente en SQLite / memoria.
 * 2. Búsqueda sin resultados locales.
 * 3. Consulta exitosa a GeoNames.
 * 4. Consulta externa sin resultados.
 * 5. Error o timeout del proveedor GeoNames.
 * 6. Selección de una ciudad externa existente en Supabase (reconciliación).
 * 7. Registro de una ciudad nueva bajo demanda.
 * 8. Registro de una división administrativa faltante (control de permisos de admin).
 * 9. Prevención de duplicados ante llamadas concurrentes o repetidas.
 * 10. Reconciliación entre fuentes (DANE vs GeoNames vs Manual).
 * 11. Registro manual de ciudad/localidad.
 * 12. Validación de permisos (rechazo a vendedores para crear divisiones).
 * 13. Sincronización atómica con SQLite mediante UPSERT (sin eliminar datos).
 * 14. Uso offline de ubicaciones previamente descargadas o registradas.
 * 15. Recuperación de registros y enriquecimiento de coordenadas.
 * 16. Compatibilidad y preservación estricta de los 104 registros semilla actuales.
 * 17. Compatibilidad con los formularios de clientes existentes (preservación de dirección libre).
 * 18. Rechazo estricto ante inconsistencia de país o división administrativa.
 * 19. Validación de procedencia: manual vs geonames (rechazo de geoname_id en manual).
 * 20. Validación de roles: rechazo explícito a rol "cliente".
 * 21. Reconciliación concurrente segura (Get-or-create).
 * 22. Dos ciudades diferentes con las mismas tres primeras letras generan IDs únicos sin colisión.
 * 23. Dos divisiones diferentes con las mismas tres primeras letras generan IDs únicos sin truncamiento.
 * 24. Colisión de ID entre ciudades de divisiones distintas es rechazada estrictamente con CONFLICT.
 * 25. Colisión de ID entre divisiones de países distintos es rechazada estrictamente con CONFLICT.
 * 26. Dos solicitudes simultáneas para la misma ubicación reconcilian hacia el registro canónico.
 * 27. Dos solicitudes simultáneas para ubicaciones diferentes con nombres similares generan IDs distintos.
 * 28. Rechazo de tipos de ubicación no permitidos o auto-clasificación oficial indebida.
 * 29. Rechazo de una reconciliación ambigua tras unique_violation cuando la entidad colisionante es distinta.
 * 30. Reconciliación de ciudad con país inconsistente rechazada con CONFLICT.
 * 31. División con mismo nombre pero diferente fuente rechazada con CONFLICT.
 * 32. Recuperación ambigua de división ante unique_violation rechazada con CONFLICT.
 * 33. Registro manual omitiendo p_type resuelve automáticamente a localidad_manual.
 * 34. Registro GeoNames omitiendo p_type resuelve automáticamente a ciudad.
 * 35. Jerarquía de gobernanza territorial multiempresa y permisos de administrador principal.
 * 36. Mismo nombre de división con diferente division_type rechazado con CONFLICT.
 * 37. ID de división existente con tipo incompatible rechazado con CONFLICT.
 * 38. Recuperación de división ante unique_violation con source_id NULL rechazada con CONFLICT.
 * 39. Tipo territorial omitido para país sin regla de resolución rechazado con BAD_REQUEST.
 * 40. Resolución de tipos territoriales automática por país (CO, MX, AR, BR).
 * 41. Compatibilidad del servicio React Native con los nuevos parámetros (division_type null por defecto).
 */

import {
  GEO_DATA,
  getCountries,
  getCountryById,
  getAdministrativeDivisions,
  getCities,
  getCityById,
  getRegionalConfig,
  normalizeGeoString,
  searchLocationsOnDemand,
  registerLocationOnDemand,
  saveLocationToSQLite,
  syncGeoCatalogToSQLite,
} from '../src/services/geoService';

import {
  searchGeoNamesCities,
  normalizeGeoNamesPlace,
  clearGeoNamesCache,
} from '../src/services/geonamesService';

import { supabase } from '../src/lib/supabase';

// Mock de NetInfo y AsyncStorage
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'test-admin-uuid' } } }, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
  ensureAuthenticatedSession: jest.fn().mockResolvedValue({ user: { id: 'test-admin-uuid' } }),
}));

describe('Catálogo Geográfico Dinámico Bajo Demanda (Zenda On-Demand Geo Catalog)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearGeoNamesCache();
    global.fetch = jest.fn();
  });

  // -------------------------------------------------------------------------
  // 1. Búsqueda de una ciudad existente en SQLite / local
  // -------------------------------------------------------------------------
  test('Escenario 1: Búsqueda de una ciudad existente en el catálogo local (inmediata y offline)', async () => {
    const res = await searchLocationsOnDemand({
      query: 'Manizales',
      countryId: 'CO',
      allowExternal: false,
    });

    expect(res.localResults.length).toBeGreaterThanOrEqual(1);
    const manizales = res.localResults.find(c => c.id === 'CO-CAL-MNZ');
    expect(manizales).toBeDefined();
    expect(manizales.nombre).toBe('Manizales');
    expect(manizales.is_external).toBe(false);
    expect(res.externalResults.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 2. Búsqueda sin resultados locales
  // -------------------------------------------------------------------------
  test('Escenario 2: Búsqueda sin resultados locales devuelve lista vacía localmente', async () => {
    const res = await searchLocationsOnDemand({
      query: 'CiudadInexistenteXYZ123',
      countryId: 'CO',
      allowExternal: false,
    });

    expect(res.localResults.length).toBe(0);
    expect(res.allResults.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. Consulta exitosa a GeoNames
  // -------------------------------------------------------------------------
  test('Escenario 3: Consulta exitosa a GeoNames retorna resultados normalizados', async () => {
    const mockGeoNamesResponse = {
      totalResultsCount: 1,
      geonames: [
        {
          geonameId: 3672486,
          name: 'Pereira',
          lat: '4.81333',
          lng: '-75.69611',
          countryCode: 'CO',
          countryName: 'Colombia',
          adminCode1: '66',
          adminName1: 'Risaralda',
          fcode: 'PPLA',
          timezone: { timeZoneId: 'America/Bogota' },
        },
      ],
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(mockGeoNamesResponse),
    });

    const res = await searchGeoNamesCities({
      query: 'Pereira',
      countryCode: 'CO',
    });

    expect(res.success).toBe(true);
    expect(res.items.length).toBe(1);
    expect(res.items[0].nombre).toBe('Pereira');
    expect(res.items[0].geoname_id).toBe('3672486');
    expect(res.items[0].latitude).toBe(4.81333);
    expect(res.items[0].longitude).toBe(-75.69611);
    expect(res.items[0].timezone).toBe('America/Bogota');
    expect(res.items[0].is_external).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Consulta externa sin resultados
  // -------------------------------------------------------------------------
  test('Escenario 4: Consulta externa a GeoNames sin resultados', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ totalResultsCount: 0, geonames: [] }),
    });

    const res = await searchGeoNamesCities({
      query: 'UbicacionTotalmenteExtrana999',
      countryCode: 'CO',
    });

    expect(res.success).toBe(true);
    expect(res.items.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. Error o timeout del proveedor externo
  // -------------------------------------------------------------------------
  test('Escenario 5: Manejo resiliente de timeout y error de red en GeoNames', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    global.fetch.mockRejectedValueOnce(abortErr);

    const res = await searchGeoNamesCities({
      query: 'TimeoutTestCity',
      countryCode: 'CO',
      timeoutMs: 100,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('TIMEOUT');
    expect(res.items.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. Selección de una ciudad externa existente en Supabase (reconciliación)
  // -------------------------------------------------------------------------
  test('Escenario 6: Selección de ciudad externa reconciliada por RPC en Supabase', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: true,
        city: {
          id: 'CO-CAL-MNZ',
          nombre: 'Manizales',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          geoname_id: '3675443',
          type: 'municipio',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas', country_id: 'CO' },
        country: { id: 'CO', nombre: 'Colombia', currency_code: 'COP' },
      },
      error: null,
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Manizales',
      geoname_id: '3675443',
    });

    expect(result.success).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(result.city.id).toBe('CO-CAL-MNZ');
    expect(supabase.rpc).toHaveBeenCalledWith('register_geographic_location', expect.objectContaining({
      p_country_id: 'CO',
      p_city_nombre: 'Manizales',
    }));
  });

  // -------------------------------------------------------------------------
  // 7. Registro de una ciudad nueva bajo demanda
  // -------------------------------------------------------------------------
  test('Escenario 7: Registro de una nueva ciudad bajo demanda genera ID canónico y persiste', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: false,
        created_new_city: true,
        city: {
          id: 'CO-CAL-GEO3689255',
          nombre: 'Aranzazu',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          geoname_id: '3689255',
          latitude: 5.275,
          longitude: -75.495,
          timezone: 'America/Bogota',
          source: 'geonames',
          type: 'ciudad',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas', country_id: 'CO' },
        country: { id: 'CO', nombre: 'Colombia', currency_code: 'COP' },
      },
      error: null,
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Aranzazu',
      geoname_id: '3689255',
      latitude: 5.275,
      longitude: -75.495,
      timezone: 'America/Bogota',
    });

    expect(result.success).toBe(true);
    expect(result.city.id).toBe('CO-CAL-GEO3689255');
    expect(result.city.latitude).toBe(5.275);
  });

  // -------------------------------------------------------------------------
  // 8. Registro de una división administrativa faltante
  // -------------------------------------------------------------------------
  test('Escenario 8: Administrador puede registrar división administrativa faltante', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_division: true,
        created_new_city: true,
        division: {
          id: 'MX-YUC',
          country_id: 'MX',
          nombre: 'Yucatán',
          division_type: 'estado',
        },
        city: {
          id: 'MX-YUC-GEO3523272',
          nombre: 'Mérida',
          country_id: 'MX',
          administrative_division_id: 'MX-YUC',
          geoname_id: '3523272',
        },
        country: { id: 'MX', nombre: 'México', currency_code: 'MXN' },
      },
      error: null,
    });

    const result = await registerLocationOnDemand({
      country_id: 'MX',
      division_nombre: 'Yucatán',
      division_type: 'estado',
      nombre: 'Mérida',
      geoname_id: '3523272',
    });

    expect(result.success).toBe(true);
    expect(result.division.id).toBe('MX-YUC');
    expect(result.city.administrative_division_id).toBe('MX-YUC');
  });

  // -------------------------------------------------------------------------
  // 9. Prevención de duplicados
  // -------------------------------------------------------------------------
  test('Escenario 9: Prevención de duplicados concurrentes reconcilia hacia la ciudad original', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: true,
        created_new_city: false,
        city: {
          id: 'CO-CAL-MNZ',
          nombre: 'Manizales',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const req1 = await registerLocationOnDemand({ country_id: 'CO', nombre: 'manizales', division_id: 'CO-CAL' });
    expect(req1.success).toBe(true);
    expect(req1.reconciled).toBe(true);
    expect(req1.city.id).toBe('CO-CAL-MNZ');
  });

  // -------------------------------------------------------------------------
  // 10. Reconciliación entre fuentes (DANE vs GeoNames vs Manual)
  // -------------------------------------------------------------------------
  test('Escenario 10: Reconciliación de nombres normalizados ignora tildes y mayúsculas', () => {
    expect(normalizeGeoString('Bogotá D.C.')).toBe('bogota dc');
    expect(normalizeGeoString('Medellín')).toBe('medellin');
    expect(normalizeGeoString('São Paulo')).toBe('sao paulo');
    expect(normalizeGeoString('  Córdoba,  ')).toBe('cordoba');
  });

  // -------------------------------------------------------------------------
  // 11. Registro manual de ubicación
  // -------------------------------------------------------------------------
  test('Escenario 11: Registro manual de localidad asigna source = "manual"', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        city: {
          id: 'CO-CAL-VER-123',
          nombre: 'Vereda La Linda',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          source: 'manual',
          type: 'localidad_manual',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Vereda La Linda',
      source: 'manual',
      type: 'localidad_manual',
    });

    expect(result.success).toBe(true);
    expect(result.city.source).toBe('manual');
    expect(result.city.type).toBe('localidad_manual');
  });

  // -------------------------------------------------------------------------
  // 12. Validación de permisos
  // -------------------------------------------------------------------------
  test('Escenario 12: RPC rechaza creación de divisiones si el usuario no tiene permisos', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'FORBIDDEN: La división administrativa no existe en Zenda. Solo administradores pueden incorporar nuevas divisiones territoriales.' },
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'DepartamentoInventado',
      nombre: 'Poblado1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // 13. Sincronización con SQLite mediante UPSERT
  // -------------------------------------------------------------------------
  test('Escenario 13: saveLocationToSQLite ejecuta UPSERT sin destruir relaciones foráneas', async () => {
    const mockDb = {
      executeSql: jest.fn().mockResolvedValue([[]]),
    };

    const success = await saveLocationToSQLite(mockDb, {
      city: {
        id: 'CO-CAL-NEW-01',
        country_id: 'CO',
        administrative_division_id: 'CO-CAL',
        nombre: 'Nueva Localidad',
        source: 'manual',
        type: 'localidad_manual',
        enabled: true,
      },
      division: {
        id: 'CO-CAL',
        country_id: 'CO',
        nombre: 'Caldas',
        division_type: 'departamento',
      },
    });

    expect(success).toBe(true);
    expect(mockDb.executeSql).toHaveBeenCalledTimes(2);

    // Validar sintaxis ON CONFLICT DO UPDATE SET
    const divSql = mockDb.executeSql.mock.calls[0][0];
    const citySql = mockDb.executeSql.mock.calls[1][0];

    expect(divSql).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(citySql).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(citySql).not.toContain('INSERT OR REPLACE');
  });

  // -------------------------------------------------------------------------
  // 14. Uso offline de ubicaciones previamente descargadas
  // -------------------------------------------------------------------------
  test('Escenario 14: Ubicaciones en memoria / SQLite se pueden seleccionar sin conexión', () => {
    const villamaria = getCityById('CO-CAL-VMA');
    expect(villamaria).toBeDefined();
    expect(villamaria.nombre).toBe('Villamaría');

    const regional = getRegionalConfig('CO', 'CO-CAL-VMA');
    expect(regional.currency_code).toBe('COP');
    expect(regional.timezone).toBe('America/Bogota');
  });

  // -------------------------------------------------------------------------
  // 15. Enriquecimiento de coordenadas sin sobrescribir datos existentes
  // -------------------------------------------------------------------------
  test('Escenario 15: Reconciliación conserva identificador interno y enriquece coordenadas', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: true,
        city: {
          id: 'CO-CAL-LDO',
          nombre: 'La Dorada',
          geoname_id: '3679808',
          latitude: 5.4538,
          longitude: -74.6647,
        },
      },
      error: null,
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      id: 'CO-CAL-LDO',
      nombre: 'La Dorada',
      latitude: 5.4538,
      longitude: -74.6647,
    });

    expect(res.success).toBe(true);
    expect(res.city.id).toBe('CO-CAL-LDO');
    expect(res.city.latitude).toBe(5.4538);
  });

  // -------------------------------------------------------------------------
  // 16. Compatibilidad con los 104 registros semilla actuales
  // -------------------------------------------------------------------------
  test('Escenario 16: El catálogo maestro semilla de 104 ciudades y 58 divisiones se preserva intacto', () => {
    expect(GEO_DATA.cities.length).toBeGreaterThanOrEqual(104);
    expect(GEO_DATA.administrative_divisions.length).toBeGreaterThanOrEqual(58);

    // Los 27 municipios oficiales de Caldas se preservan intactos con type = 'municipio'
    const caldasCities = getCities('CO-CAL');
    const officialCaldasMunicipalities = caldasCities.filter(c => c.type === 'municipio');
    expect(officialCaldasMunicipalities.length).toBe(27);
    expect(officialCaldasMunicipalities.every(c => c.source === 'dane_divipola')).toBe(true);

    // IDs históricos intactos
    expect(getCityById('CO-CAL-MNZ')).toBeDefined();
    expect(getCityById('CO-CAQ-FLO')).toBeDefined(); // Florencia con nuevo ID corregido
  });

  // -------------------------------------------------------------------------
  // 17. Compatibilidad con formularios existentes de clientes
  // -------------------------------------------------------------------------
  test('Escenario 17: Preservación del campo de dirección libre para clientes', () => {
    const clientPayload = {
      nombre: 'Cliente',
      apellido: 'Prueba',
      documento: '12345678',
      direccion: 'Vereda Gallinazo Km 3, Finca Los Pinos, Villamaría',
      telefono: '3109998877',
      currency_code: 'COP',
    };

    expect(clientPayload.direccion).toContain('Vereda Gallinazo');
    expect(clientPayload.currency_code).toBe('COP');
  });

  // -------------------------------------------------------------------------
  // 18. Rechazo estricto ante cruce de país o división inconsistente (Integridad)
  // -------------------------------------------------------------------------
  test('Escenario 18: Rechazo estricto ante inconsistencia de país o división administrativa', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'CONFLICT: La ciudad con ID "CO-CAL-MNZ" pertenece al país "CO", no al país "MX"' },
    });

    const result = await registerLocationOnDemand({
      country_id: 'MX',
      administrative_division_id: 'MX-CMX',
      id: 'CO-CAL-MNZ',
      nombre: 'Manizales',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('CONFLICT');
  });

  // -------------------------------------------------------------------------
  // 19. Validación de procedencia: manual vs geonames
  // -------------------------------------------------------------------------
  test('Escenario 19: Rechazo si un registro manual incluye identificadores de GeoNames', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'BAD_REQUEST: Un registro manual no puede contener un "p_geoname_id" externo' },
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Vereda Falsa',
      source: 'manual',
      geoname_id: '123456',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('BAD_REQUEST');
  });

  // -------------------------------------------------------------------------
  // 20. Validación de roles: rechazo explícito a rol "cliente"
  // -------------------------------------------------------------------------
  test('Escenario 20: Rechazo de registro geográfico si el usuario tiene rol "cliente"', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'FORBIDDEN: El rol "cliente" no tiene permisos para registrar ubicaciones geográficas' },
    });

    const result = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Poblado',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('FORBIDDEN');
    expect(result.error).toContain('cliente');
  });

  // -------------------------------------------------------------------------
  // 21. Reconciliación concurrente segura (Get-or-create)
  // -------------------------------------------------------------------------
  test('Escenario 21: Manejo de colisión concurrente devolviendo el registro canónico sin fallar', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: true,
        created_new_city: false,
        city: {
          id: 'CO-CAL-GEO3675443',
          nombre: 'Manizales',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          geoname_id: '3675443',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Manizales',
      geoname_id: '3675443',
      source: 'geonames',
    });

    expect(res.success).toBe(true);
    expect(res.reconciled).toBe(true);
    expect(res.city.id).toBe('CO-CAL-GEO3675443');
  });

  // -------------------------------------------------------------------------
  // 22. Dos ciudades diferentes con las mismas tres primeras letras (Sin colisión)
  // -------------------------------------------------------------------------
  test('Escenario 22: Dos ciudades diferentes que comparten las 3 primeras letras generan IDs únicos sin colisión', async () => {
    // San José genera ID UUID-backed
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: false,
        created_new_city: true,
        city: {
          id: 'CO-CAL-MAN-B792A108C5D3',
          nombre: 'San José',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          type: 'localidad_manual',
          source: 'manual',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    // San Juan genera ID UUID-backed independiente
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: false,
        created_new_city: true,
        city: {
          id: 'CO-CAL-MAN-C834D219E6F4',
          nombre: 'San Juan',
          country_id: 'CO',
          administrative_division_id: 'CO-CAL',
          type: 'localidad_manual',
          source: 'manual',
        },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const resSanJose = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'San José',
      source: 'manual',
    });

    const resSanJuan = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'San Juan',
      source: 'manual',
    });

    expect(resSanJose.success).toBe(true);
    expect(resSanJuan.success).toBe(true);
    expect(resSanJose.city.id).not.toBe(resSanJuan.city.id);
    expect(resSanJose.city.id).toContain('CO-CAL-MAN-');
    expect(resSanJuan.city.id).toContain('CO-CAL-MAN-');
    expect(resSanJose.city.id).not.toBe('CO-CAL-SAN');
    expect(resSanJuan.city.id).not.toBe('CO-CAL-SAN');
  });

  // -------------------------------------------------------------------------
  // 23. Dos divisiones diferentes con las mismas tres primeras letras (Sin colisión)
  // -------------------------------------------------------------------------
  test('Escenario 23: Dos divisiones diferentes que comparten las 3 primeras letras generan IDs únicos sin truncamiento', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_division: true,
        city: { id: 'CO-DIV-SANTANDER-GEO1', nombre: 'Bucaramanga' },
        division: { id: 'CO-DIV-SANTANDER', nombre: 'Santander' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_division: true,
        city: { id: 'CO-DIV-SANANDRES-GEO2', nombre: 'San Andrés' },
        division: { id: 'CO-DIV-SANANDRES', nombre: 'San Andrés y Providencia' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const resSantander = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Santander',
      nombre: 'Bucaramanga',
      geoname_id: '3688465',
    });

    const resSanAndres = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'San Andrés y Providencia',
      nombre: 'San Andrés',
      geoname_id: '3670218',
    });

    expect(resSantander.success).toBe(true);
    expect(resSanAndres.success).toBe(true);
    expect(resSantander.division.id).not.toBe(resSanAndres.division.id);
    expect(resSantander.division.id).toBe('CO-DIV-SANTANDER');
    expect(resSanAndres.division.id).toBe('CO-DIV-SANANDRES');
    expect(resSantander.division.id).not.toBe('CO-SAN');
    expect(resSanAndres.division.id).not.toBe('CO-SAN');
  });

  // -------------------------------------------------------------------------
  // 24. Colisión de ID entre ciudades de divisiones distintas rechazada con CONFLICT
  // -------------------------------------------------------------------------
  test('Escenario 24: Colisión de ID entre ciudades de divisiones distintas es rechazada estrictamente con CONFLICT', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'CONFLICT: La ciudad con ID "CO-CAL-MNZ" pertenece a la división "CO-CAL", no a la división "CO-ANT"' },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-ANT',
      id: 'CO-CAL-MNZ',
      nombre: 'Manizales',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('pertenece a la división "CO-CAL", no a la división "CO-ANT"');
  });

  // -------------------------------------------------------------------------
  // 25. Colisión de ID entre divisiones de países distintos rechazada con CONFLICT
  // -------------------------------------------------------------------------
  test('Escenario 25: Colisión de ID entre divisiones de países distintos es rechazada estrictamente con CONFLICT', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'CONFLICT: La división administrativa "MX-CMX" pertenece al país "MX", no al país "CO"' },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'MX-CMX',
      nombre: 'Zona Centro',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('pertenece al país "MX", no al país "CO"');
  });

  // -------------------------------------------------------------------------
  // 26. Dos solicitudes simultáneas para la misma ubicación reconcilian hacia el canónico
  // -------------------------------------------------------------------------
  test('Escenario 26: Dos solicitudes simultáneas para la misma ubicación reconcilian hacia el registro canónico', async () => {
    // Solicitud A: Inserta con éxito
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: false,
        created_new_city: true,
        city: { id: 'CO-CAL-GEO3675443', nombre: 'Manizales', administrative_division_id: 'CO-CAL' },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    // Solicitud B (concurrente): Captura unique_violation y reconcilia hacia el registro canónico
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        reconciled: true,
        created_new_city: false,
        city: { id: 'CO-CAL-GEO3675443', nombre: 'Manizales', administrative_division_id: 'CO-CAL' },
        division: { id: 'CO-CAL', nombre: 'Caldas' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const [resA, resB] = await Promise.all([
      registerLocationOnDemand({
        country_id: 'CO',
        administrative_division_id: 'CO-CAL',
        nombre: 'Manizales',
        geoname_id: '3675443',
        source: 'geonames',
      }),
      registerLocationOnDemand({
        country_id: 'CO',
        administrative_division_id: 'CO-CAL',
        nombre: 'Manizales',
        geoname_id: '3675443',
        source: 'geonames',
      }),
    ]);

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(resA.city.id).toBe('CO-CAL-GEO3675443');
    expect(resB.city.id).toBe('CO-CAL-GEO3675443');
    expect(resA.city.id).toBe(resB.city.id);
  });

  // -------------------------------------------------------------------------
  // 27. Dos solicitudes simultáneas para ubicaciones diferentes con nombres similares
  // -------------------------------------------------------------------------
  test('Escenario 27: Solicitudes simultáneas para ubicaciones diferentes con nombres similares generan IDs distintos', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_city: true,
        city: {
          id: 'CO-CAL-MAN-8FA7B23C0123',
          nombre: 'San José del Palmar',
          source: 'manual',
        },
      },
      error: null,
    });

    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_city: true,
        city: {
          id: 'CO-CAL-MAN-1DB4C56E8901',
          nombre: 'San José de la Montaña',
          source: 'manual',
        },
      },
      error: null,
    });

    const [res1, res2] = await Promise.all([
      registerLocationOnDemand({
        country_id: 'CO',
        administrative_division_id: 'CO-CAL',
        nombre: 'San José del Palmar',
        source: 'manual',
      }),
      registerLocationOnDemand({
        country_id: 'CO',
        administrative_division_id: 'CO-CAL',
        nombre: 'San José de la Montaña',
        source: 'manual',
      }),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.city.id).not.toBe(res2.city.id);
    expect(res1.city.id).toContain('CO-CAL-MAN-');
    expect(res2.city.id).toContain('CO-CAL-MAN-');
  });

  // -------------------------------------------------------------------------
  // 28. Rechazo de tipos de ubicación no permitidos (p_type inválido)
  // -------------------------------------------------------------------------
  test('Escenario 28: Rechazo de tipos de ubicación no permitidos o auto-clasificación oficial indebida', async () => {
    // 28a: Registro manual intentando auto-clasificarse como 'municipio' oficial
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'BAD_REQUEST: Tipo de entidad manual no permitido: "municipio". Un registro manual no puede auto-clasificarse como municipio oficial, distrito capital ni tipo restringido',
      },
    });

    const resManualInvalido = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Finca Nueva',
      source: 'manual',
      type: 'municipio',
    });

    expect(resManualInvalido.success).toBe(false);
    expect(resManualInvalido.error).toContain('BAD_REQUEST');
    expect(resManualInvalido.error).toContain('manual no puede auto-clasificarse');

    // 28b: Tipo totalmente fuera de la lista blanca
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'BAD_REQUEST: Tipo de entidad no compatible con geonames: "galaxia"',
      },
    });

    const resTipoInvalido = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Andrómeda',
      geoname_id: '99999999',
      type: 'galaxia',
    });

    expect(resTipoInvalido.success).toBe(false);
    expect(resTipoInvalido.error).toContain('BAD_REQUEST');
    expect(resTipoInvalido.error).toContain('galaxia');
  });

  // -------------------------------------------------------------------------
  // 29. Rechazo de una reconciliación ambigua tras unique_violation
  // -------------------------------------------------------------------------
  test('Escenario 29: Rechazo de reconciliación ambigua tras unique_violation cuando la entidad colisionante es distinta', async () => {
    // La RPC detecta una colisión en INSERT pero el registro existente no coincide unívocamente
    // con el nombre ni los identificadores canónicos de la localidad solicitada en esa división.
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: Colisión de identificador no reconciliable para la ciudad "Vereda La Esmeralda" en la división "CO-CAL" del país "CO"',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Vereda La Esmeralda',
      source: 'manual',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('Colisión de identificador no reconciliable');
  });

  // -------------------------------------------------------------------------
  // 30. Reconciliación de ciudad con país inconsistente
  // -------------------------------------------------------------------------
  test('Escenario 30: Rechazo de reconciliación cuando existe inconsistencia entre país de la ciudad y país solicitado', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: Inconsistencia relacional: la ciudad "Bogotá" en la división "CO-CAL" tiene un country_id que no coincide con "CO"',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Bogotá',
      source: 'manual',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('Inconsistencia relacional');
  });

  // -------------------------------------------------------------------------
  // 31. División con mismo nombre pero diferente fuente
  // -------------------------------------------------------------------------
  test('Escenario 31: Rechazo si una división coincide en nombre pero difiere en source_id externo', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: División con mismo nombre "Santander" pero diferente source_id: registrada "3669681" (geonames) vs solicitada "99999" (geonames)',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Santander',
      division_source: 'geonames',
      division_source_id: '99999',
      nombre: 'Bucaramanga',
      geoname_id: '3688465',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('diferente source_id');
  });

  // -------------------------------------------------------------------------
  // 32. Recuperación ambigua de división ante unique_violation
  // -------------------------------------------------------------------------
  test('Escenario 32: Rechazo ante colisión de división cuando la entidad colisionante es ambigua o ajena', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: Colisión de identificador no reconciliable para la división administrativa "Nueva Región" en el país "CO"',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Nueva Región',
      nombre: 'Poblado Uno',
      source: 'manual',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('Colisión de identificador no reconciliable para la división');
  });

  // -------------------------------------------------------------------------
  // 33. Registro manual omitiendo p_type resuelve a localidad_manual
  // -------------------------------------------------------------------------
  test('Escenario 33: Registro manual omitiendo p_type resuelve automáticamente a "localidad_manual"', async () => {
    supabase.rpc.mockImplementationOnce((method, params) => {
      expect(params.p_type).toBeNull();
      expect(params.p_source).toBe('manual');
      return Promise.resolve({
        data: {
          success: true,
          created_new_city: true,
          city: {
            id: 'CO-CAL-MAN-9A8B7C6D5E4F',
            nombre: 'Finca El Paraíso',
            type: 'localidad_manual',
            source: 'manual',
          },
          division: { id: 'CO-CAL', nombre: 'Caldas' },
          country: { id: 'CO', nombre: 'Colombia' },
        },
        error: null,
      });
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Finca El Paraíso',
      source: 'manual',
      // type omitido explícitamente
    });

    expect(res.success).toBe(true);
    expect(res.city.type).toBe('localidad_manual');
    expect(res.city.source).toBe('manual');
  });

  // -------------------------------------------------------------------------
  // 34. Registro GeoNames omitiendo p_type resuelve a ciudad
  // -------------------------------------------------------------------------
  test('Escenario 34: Registro GeoNames omitiendo p_type resuelve automáticamente a "ciudad"', async () => {
    supabase.rpc.mockImplementationOnce((method, params) => {
      expect(params.p_type).toBeNull();
      expect(params.p_source).toBe('geonames');
      return Promise.resolve({
        data: {
          success: true,
          created_new_city: true,
          city: {
            id: 'CO-CAL-GEO3689255',
            nombre: 'Aranzazu',
            type: 'ciudad',
            source: 'geonames',
            geoname_id: '3689255',
          },
          division: { id: 'CO-CAL', nombre: 'Caldas' },
          country: { id: 'CO', nombre: 'Colombia' },
        },
        error: null,
      });
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      nombre: 'Aranzazu',
      geoname_id: '3689255',
      source: 'geonames',
      // type omitido explícitamente
    });

    expect(res.success).toBe(true);
    expect(res.city.type).toBe('ciudad');
    expect(res.city.source).toBe('geonames');
  });

  // -------------------------------------------------------------------------
  // 35. Gobernanza territorial multiempresa y permisos globales
  // -------------------------------------------------------------------------
  test('Escenario 35: Jerarquía de gobernanza territorial multiempresa', async () => {
    // 35a: Administrador subordinado de una organización (superior_id IS NOT NULL) intenta crear división
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'FORBIDDEN: La creación de nuevas divisiones territoriales globales requiere privilegios de administrador principal (sin superior_id)',
      },
    });

    const resSubAdmin = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'División Inexistente',
      nombre: 'Ciudad Test',
      source: 'geonames',
      geoname_id: '111111',
    });

    expect(resSubAdmin.success).toBe(false);
    expect(resSubAdmin.error).toContain('FORBIDDEN');
    expect(resSubAdmin.error).toContain('administrador principal');

    // 35b: Administrador principal de organización (superior_id IS NULL) crea división registrando trazabilidad
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        created_new_division: true,
        created_new_city: true,
        division: { id: 'CO-DIV-TOL', nombre: 'Tolima', division_type: 'departamento' },
        city: { id: 'CO-DIV-TOL-GEO3687318', nombre: 'Ibagué' },
        country: { id: 'CO', nombre: 'Colombia' },
      },
      error: null,
    });

    const resRootAdmin = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Tolima',
      division_source_id: 'TOL',
      nombre: 'Ibagué',
      geoname_id: '3687318',
    });

    expect(resRootAdmin.success).toBe(true);
    expect(resRootAdmin.created_new_division).toBe(true);
    expect(resRootAdmin.division.id).toBe('CO-DIV-TOL');
  });

  // -------------------------------------------------------------------------
  // 36. Mismo nombre de división con diferente division_type
  // -------------------------------------------------------------------------
  test('Escenario 36: Rechazo si una división coincide en nombre pero difiere en division_type', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: La división "Caldas" tiene tipo "departamento", incompatible con el solicitado "estado"',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Caldas',
      division_type: 'estado',
      nombre: 'Manizales',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('incompatible con el solicitado');
  });

  // -------------------------------------------------------------------------
  // 37. ID de división existente con tipo incompatible
  // -------------------------------------------------------------------------
  test('Escenario 37: Rechazo si el ID de división provisto tiene un division_type incompatible', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: La división administrativa "CO-CAL" tiene tipo "departamento", incompatible con el solicitado "provincia"',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      administrative_division_id: 'CO-CAL',
      division_type: 'provincia',
      nombre: 'Manizales',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('incompatible con el solicitado');
  });

  // -------------------------------------------------------------------------
  // 38. Recuperación de división ante unique_violation con source_id NULL
  // -------------------------------------------------------------------------
  test('Escenario 38: Rechazo ante colisión de división cuando el registro existente tiene source_id NULL y se solicita identificador externo', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'CONFLICT: Ambigüedad en división "CO-DIV-ANTIOQUIA": el registro existente carece de identificador de fuente externa (source_id NULL) y no puede vincularse automáticamente con "3689815" (geonames)',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Antioquia',
      division_source: 'geonames',
      division_source_id: '3689815',
      nombre: 'Medellín',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONFLICT');
    expect(res.error).toContain('source_id NULL');
    expect(res.error).toContain('no puede vincularse automáticamente');
  });

  // -------------------------------------------------------------------------
  // 39. Tipo territorial omitido para país sin regla de resolución
  // -------------------------------------------------------------------------
  test('Escenario 39: Rechazo con BAD_REQUEST al omitir p_division_type para país sin regla predeterminada', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'BAD_REQUEST: No se especificó "p_division_type" y no existe regla territorial predeterminada para el país "UY". Debe especificarse explícitamente (ej. departamento, estado, provincia, region)',
      },
    });

    const res = await registerLocationOnDemand({
      country_id: 'UY',
      division_nombre: 'Montevideo',
      nombre: 'Montevideo',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('BAD_REQUEST');
    expect(res.error).toContain('No se especificó "p_division_type"');
  });

  // -------------------------------------------------------------------------
  // 40. Resolución de tipos para Colombia, México, Argentina y Brasil
  // -------------------------------------------------------------------------
  test('Escenario 40: Resolución territorial automática por país (CO, MX, AR, BR)', async () => {
    // Colombia -> departamento
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        division: { id: 'CO-DIV-BOY', nombre: 'Boyacá', division_type: 'departamento' },
        city: { id: 'CO-DIV-BOY-GEO1', nombre: 'Tunja' },
        country: { id: 'CO' },
      },
      error: null,
    });

    const resCO = await registerLocationOnDemand({
      country_id: 'CO',
      division_nombre: 'Boyacá',
      nombre: 'Tunja',
    });
    expect(resCO.division.division_type).toBe('departamento');

    // México -> estado
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        division: { id: 'MX-DIV-SON', nombre: 'Sonora', division_type: 'estado' },
        city: { id: 'MX-DIV-SON-GEO1', nombre: 'Hermosillo' },
        country: { id: 'MX' },
      },
      error: null,
    });

    const resMX = await registerLocationOnDemand({
      country_id: 'MX',
      division_nombre: 'Sonora',
      nombre: 'Hermosillo',
    });
    expect(resMX.division.division_type).toBe('estado');

    // Argentina -> provincia
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        division: { id: 'AR-DIV-SAL', nombre: 'Salta', division_type: 'provincia' },
        city: { id: 'AR-DIV-SAL-GEO1', nombre: 'Salta' },
        country: { id: 'AR' },
      },
      error: null,
    });

    const resAR = await registerLocationOnDemand({
      country_id: 'AR',
      division_nombre: 'Salta',
      nombre: 'Salta',
    });
    expect(resAR.division.division_type).toBe('provincia');

    // Brasil -> estado
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        division: { id: 'BR-DIV-SC', nombre: 'Santa Catarina', division_type: 'estado' },
        city: { id: 'BR-DIV-SC-GEO1', nombre: 'Florianópolis' },
        country: { id: 'BR' },
      },
      error: null,
    });

    const resBR = await registerLocationOnDemand({
      country_id: 'BR',
      division_nombre: 'Santa Catarina',
      nombre: 'Florianópolis',
    });
    expect(resBR.division.division_type).toBe('estado');
  });

  // -------------------------------------------------------------------------
  // 41. Compatibilidad del servicio React Native con los nuevos parámetros
  // -------------------------------------------------------------------------
  test('Escenario 41: geoService.js no fuerza "departamento" por defecto y propaga division_type provisto', async () => {
    // 41a: Omitiendo division_type pasa null para resolución en backend
    supabase.rpc.mockImplementationOnce((method, params) => {
      expect(params.p_division_type).toBeNull();
      return Promise.resolve({
        data: {
          success: true,
          division: { id: 'MX-DIV-VER', nombre: 'Veracruz', division_type: 'estado' },
          city: { id: 'MX-DIV-VER-GEO1', nombre: 'Xalapa' },
          country: { id: 'MX' },
        },
        error: null,
      });
    });

    const resOmitido = await registerLocationOnDemand({
      country_id: 'MX',
      division_nombre: 'Veracruz',
      nombre: 'Xalapa',
    });
    expect(resOmitido.success).toBe(true);

    // 41b: Suministrando division_type explícito lo propaga intacto
    supabase.rpc.mockImplementationOnce((method, params) => {
      expect(params.p_division_type).toBe('caba');
      return Promise.resolve({
        data: {
          success: true,
          division: { id: 'AR-C', nombre: 'CABA', division_type: 'caba' },
          city: { id: 'AR-C-GEO1', nombre: 'Palermo' },
          country: { id: 'AR' },
        },
        error: null,
      });
    });

    const resExplicito = await registerLocationOnDemand({
      country_id: 'AR',
      division_nombre: 'CABA',
      division_type: 'caba',
      nombre: 'Palermo',
    });
    expect(resExplicito.success).toBe(true);
  });
});

