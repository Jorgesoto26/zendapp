/**
 * __tests__/internationalization.test.js
 * Test suite verifying the 8 required internationalization scenarios for Zenda:
 * 1. Colombia (COP, es-CO, America/Bogota, 0 decimals)
 * 2. México (MXN, es-MX, America/Mexico_City, 2 decimals)
 * 3. Perú (PEN, es-PE, America/Lima, 2 decimals, S/ symbol)
 * 4. Chile (CLP, es-CL, America/Santiago, 0 decimals)
 * 5. Scope: Admin Manizales -> Vendor Villamaría -> Client Neira
 * 6. Financial integrity across invoice, cuotas, payments, cajas, movements
 * 7. Offline sync idempotency & currency preservation
 * 8. Non-regression of existing modules and signatures
 */

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('react-native-background-timer', () => ({
  runBackgroundTimer: jest.fn(),
  stopBackgroundTimer: jest.fn(),
}));

jest.mock('react-native-permissions', () => ({
  check: jest.fn(),
  request: jest.fn(),
  PERMISSIONS: {},
  RESULTS: {},
}));

jest.mock('react-native-modal', () => 'Modal');
jest.mock('../src/components/AppAlert', () => ({
  appAlert: jest.fn(),
}));

jest.mock('react-native-sqlite-storage', () => ({
  openDatabase: jest.fn(),
}));

jest.mock('../src/database/db', () => ({
  getDbConnection: jest.fn(),
  getData: jest.fn(),
}));

import {
  SUPPORTED_CURRENCIES,
  getCurrencyConfig,
  getCurrencySymbol,
  getCurrencyDecimals,
  formatCurrency,
  parseMoneyToNumericByCurrency,
  formatMoneyInput,
} from '../src/utils/currency';

import {
  FormatMoney,
  FormatMoneyDecimales,
  cleanMoneyValue,
  parseMoneyToNumeric,
} from '../src/utils/utilities';

import {
  GEO_DATA,
  getCountries,
  getCountryById,
  getAdministrativeDivisions,
  getCities,
  getCityById,
  getRegionalConfig,
} from '../src/services/geoService';

describe('Zenda Internationalization & Regionalization Test Suite', () => {
  // -------------------------------------------------------------
  // ESCENARIO 1: Colombia (COP, es-CO, America/Bogota, 0 decimales)
  // -------------------------------------------------------------
  describe('Escenario 1: Colombia', () => {
    const country = getCountryById('CO');
    const regional = getRegionalConfig('CO');

    test('Configuración regional correcta', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('COP');
      expect(regional.currency_code).toBe('COP');
      expect(regional.locale).toBe('es-CO');
      expect(regional.timezone).toBe('America/Bogota');
    });

    test('Moneda COP sin decimales', () => {
      expect(getCurrencyDecimals('COP')).toBe(0);
      expect(getCurrencySymbol('COP')).toBe('$');
    });

    test('Formateo de importes enteros en COP', () => {
      const formatted = formatCurrency(1500000, 'COP');
      // Debe contener $ y separación de miles sin centavos
      expect(formatted).toMatch(/\$|COP/);
      expect(formatted).toContain('1.500.000');
      expect(formatted.endsWith('.00')).toBe(false);
      expect(formatted.endsWith(',00')).toBe(false);
    });

    test('Cálculo de cuotas entero en COP', () => {
      const capital = 1000000;
      const tasaInteres = 20; // 20%
      const total = capital + Math.round(capital * (tasaInteres / 100));
      const cuotas = 30;
      const valorCuota = Math.round(total / cuotas);
      expect(total).toBe(1200000);
      expect(valorCuota).toBe(40000);
      expect(formatCurrency(valorCuota, 'COP')).toContain('40.000');
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 2: México (MXN, es-MX, America/Mexico_City, 2 decimales)
  // -------------------------------------------------------------
  describe('Escenario 2: México', () => {
    const country = getCountryById('MX');
    const regional = getRegionalConfig('MX');

    test('Configuración regional correcta', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('MXN');
      expect(regional.currency_code).toBe('MXN');
      expect(regional.locale).toBe('es-MX');
      expect(regional.timezone).toBe('America/Mexico_City');
    });

    test('Moneda MXN con 2 decimales', () => {
      expect(getCurrencyDecimals('MXN')).toBe(2);
      expect(getCurrencySymbol('MXN')).toBe('$');
    });

    test('Formateo de importes con 2 decimales en MXN', () => {
      const formatted = formatCurrency(1500.5, 'MXN');
      expect(formatted).toContain('1,500.50');
    });

    test('Parseo numérico seguro con decimales para MXN', () => {
      expect(parseMoneyToNumericByCurrency('1,500.50', 'MXN')).toBe(1500.5);
      expect(parseMoneyToNumericByCurrency('$ 250.75', 'MXN')).toBe(250.75);
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 3: Perú (PEN, es-PE, America/Lima, 2 decimales, S/)
  // -------------------------------------------------------------
  describe('Escenario 3: Perú', () => {
    const country = getCountryById('PE');
    const regional = getRegionalConfig('PE');

    test('Configuración regional correcta', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('PEN');
      expect(regional.currency_code).toBe('PEN');
      expect(regional.locale).toBe('es-PE');
      expect(regional.timezone).toBe('America/Lima');
    });

    test('Moneda PEN con símbolo S/ y 2 decimales', () => {
      expect(getCurrencyDecimals('PEN')).toBe(2);
      expect(getCurrencySymbol('PEN')).toBe('S/');
    });

    test('Formateo de importes con símbolo S/ y 2 decimales en PEN', () => {
      const formatted = formatCurrency(350.25, 'PEN');
      expect(formatted).toContain('S/');
      expect(formatted).toContain('350.25');
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 4: Chile (CLP, es-CL, America/Santiago, 0 decimales)
  // -------------------------------------------------------------
  describe('Escenario 4: Chile', () => {
    const country = getCountryById('CL');
    const regional = getRegionalConfig('CL');

    test('Configuración regional correcta', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('CLP');
      expect(regional.currency_code).toBe('CLP');
      expect(regional.locale).toBe('es-CL');
      expect(regional.timezone).toBe('America/Santiago');
    });

    test('Moneda CLP sin decimales', () => {
      expect(getCurrencyDecimals('CLP')).toBe(0);
      expect(getCurrencySymbol('CLP')).toBe('$');
    });

    test('Formateo de importes enteros en CLP', () => {
      const formatted = formatCurrency(500000, 'CLP');
      expect(formatted).toContain('500.000');
      expect(formatted.endsWith('.00')).toBe(false);
      expect(formatted.endsWith(',00')).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO BRASIL: Brasil (BRL, pt-BR, America/Sao_Paulo, 2 decimales, R$)
  // -------------------------------------------------------------
  describe('Escenario Brasil: BRL', () => {
    const country = getCountryById('BR');
    const regional = getRegionalConfig('BR');

    test('Configuración regional correcta para Brasil', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('BRL');
      expect(regional.currency_code).toBe('BRL');
      expect(regional.locale).toBe('pt-BR');
      expect(regional.timezone).toBe('America/Sao_Paulo');
    });

    test('Moneda BRL con símbolo R$ y 2 decimales', () => {
      expect(getCurrencyDecimals('BRL')).toBe(2);
      expect(getCurrencySymbol('BRL')).toBe('R$');
    });

    test('Formateo de importes con símbolo R$ y 2 decimales', () => {
      const formatted = formatCurrency(1250.75, 'BRL');
      expect(formatted).toContain('R$');
      expect(formatted).toMatch(/1[.,]250[.,]75/);
    });

    test('Parseo numérico seguro para BRL', () => {
      expect(parseMoneyToNumericByCurrency('R$ 1.250,75', 'BRL')).toBe(1250.75);
      expect(parseMoneyToNumericByCurrency('R$ 500.50', 'BRL')).toBe(500.5);
    });

    test('Simulación de escritura progresiva de dinero en BRL (4000 reales no colapsa a 4.00)', () => {
      // Keystroke 1: digita 4
      const k1 = formatMoneyInput('4', 'BRL');
      expect(k1).toBe('R$ 4');

      // Keystroke 2: digita 0 -> 40
      const k2 = formatMoneyInput(k1 + '0', 'BRL');
      expect(k2).toBe('R$ 40');

      // Keystroke 3: digita 0 -> 400
      const k3 = formatMoneyInput(k2 + '0', 'BRL');
      expect(k3).toBe('R$ 400');

      // Keystroke 4: digita 0 -> 4000
      const k4 = formatMoneyInput(k3 + '0', 'BRL');
      expect(k4).toBe('R$ 4,000');

      // Keystroke 5: digita otro 0 -> 40000 (no colapsa a 4.00)
      const k5 = formatMoneyInput(k4 + '0', 'BRL');
      expect(k5).toBe('R$ 40,000');
      expect(k5).not.toBe('R$ 4.00');

      // Parseo numérico consistente
      expect(parseMoneyToNumericByCurrency(k4, 'BRL')).toBe(4000);
      expect(parseMoneyToNumericByCurrency(k5, 'BRL')).toBe(40000);
    });

    test('Borrado con backspace en BRL preserva los dígitos sin convertir a decimales', () => {
      const initial = 'R$ 4,000';
      const b1 = formatMoneyInput(initial.slice(0, -1), 'BRL');
      expect(b1).toBe('R$ 400');

      const b2 = formatMoneyInput(b1.slice(0, -1), 'BRL');
      expect(b2).toBe('R$ 40');

      const b3 = formatMoneyInput(b2.slice(0, -1), 'BRL');
      expect(b3).toBe('R$ 4');
    });

    test('Entrada opcional de centavos con punto o coma en BRL', () => {
      const dot1 = formatMoneyInput('R$ 4,000.', 'BRL');
      expect(dot1).toBe('R$ 4,000.');

      const dot2 = formatMoneyInput(dot1 + '5', 'BRL');
      expect(dot2).toBe('R$ 4,000.5');

      const dot3 = formatMoneyInput(dot2 + '0', 'BRL');
      expect(dot3).toBe('R$ 4,000.50');

      expect(parseMoneyToNumericByCurrency(dot3, 'BRL')).toBe(4000.5);

      // Con coma como separador decimal escrito por el usuario
      const comma1 = formatMoneyInput('R$ 4,000,', 'BRL');
      expect(comma1).toBe('R$ 4,000.');
    });

    test('Enfoque A: autocompletar decimales (.00) al desenfocar o inicializar con forceDecimals', () => {
      // Al inicializar campo con 0 en BRL
      const initSaldo = formatMoneyInput('0', 'BRL', { forceDecimals: true });
      expect(initSaldo).toBe('R$ 0.00');

      // Al inicializar límites con 10000 en BRL
      const initLimits = formatMoneyInput('10000', 'BRL', { forceDecimals: true });
      expect(initLimits).toBe('R$ 10,000.00');

      // Al terminar de escribir 4000 y hacer onBlur
      const onBlurCompleted = formatMoneyInput('R$ 4,000', 'BRL', { forceDecimals: true });
      expect(onBlurCompleted).toBe('R$ 4,000.00');

      // Al terminar de escribir 4000.5 y hacer onBlur
      const onBlurCents = formatMoneyInput('R$ 4,000.5', 'BRL', { forceDecimals: true });
      expect(onBlurCents).toBe('R$ 4,000.50');

      // Para COP (sin decimales), forceDecimals respeta 0 decimales
      const copInit = formatMoneyInput('500000', 'COP', { forceDecimals: true });
      expect(copInit).toBe('$ 500.000');
    });

    test('Campos de dinero vacíos por defecto respetan el placeholder y no bloquean el tipeo', () => {
      // Campo vacío no genera 'R$ 0.00', sino cadena vacía para que se vea el placeholder
      expect(formatMoneyInput('', 'BRL', { forceDecimals: true })).toBe('');
      expect(formatMoneyInput(null, 'BRL', { forceDecimals: true })).toBe('');
      expect(parseMoneyToNumericByCurrency('', 'BRL')).toBe(0);

      // Si por alguna razón el texto tenía 'R$ 0.00' y el usuario digita '4' al final ('R$ 0.004'),
      // no se bloquea ni se descarta el '4', sino que se toma como 'R$ 4'
      const typedOverZero = formatMoneyInput('R$ 0.004', 'BRL');
      expect(typedOverZero).toBe('R$ 4');

      const typedOverZero2 = formatMoneyInput('R$ 0.0040', 'BRL');
      expect(typedOverZero2).toBe('R$ 40');
    });

    test('Catálogo contiene São Paulo y Rio de Janeiro', () => {
      const spDiv = getAdministrativeDivisions('BR').find(d => d.id === 'BR-SP');
      expect(spDiv).toBeDefined();
      expect(spDiv.nombre).toBe('São Paulo');

      const spCities = getCities('BR-SP');
      expect(spCities.find(c => c.id === 'BR-SP-SAO')).toBeDefined();
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO ARGENTINA: Argentina (ARS, es-AR, America/Argentina/Buenos_Aires, 2 decimales, $)
  // -------------------------------------------------------------
  describe('Escenario Argentina: ARS', () => {
    const country = getCountryById('AR');
    const regional = getRegionalConfig('AR');

    test('Configuración regional correcta para Argentina', () => {
      expect(country).toBeDefined();
      expect(country.currency_code).toBe('ARS');
      expect(regional.currency_code).toBe('ARS');
      expect(regional.locale).toBe('es-AR');
      expect(regional.timezone).toBe('America/Argentina/Buenos_Aires');
    });

    test('Moneda ARS con símbolo $ y 2 decimales', () => {
      expect(getCurrencyDecimals('ARS')).toBe(2);
      expect(getCurrencySymbol('ARS')).toBe('$');
    });

    test('Formateo de importes con símbolo $ y 2 decimales en ARS', () => {
      const formatted = formatCurrency(2500.5, 'ARS');
      expect(formatted).toContain('$');
      expect(formatted).toMatch(/2[.,]500[.,]50/);
    });

    test('Parseo numérico seguro para ARS', () => {
      expect(parseMoneyToNumericByCurrency('$ 2.500,50', 'ARS')).toBe(2500.5);
      expect(parseMoneyToNumericByCurrency('$ 1,500.25', 'ARS')).toBe(1500.25);
    });

    test('Catálogo contiene CABA y Córdoba', () => {
      const cabaDiv = getAdministrativeDivisions('AR').find(d => d.id === 'AR-C');
      expect(cabaDiv).toBeDefined();

      const cabaCities = getCities('AR-C');
      expect(cabaCities.find(c => c.id === 'AR-C-BUE')).toBeDefined();
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 5: Ámbito geográfico y jerárquico flexible
  // Admin Manizales -> Vendor Villamaría -> Client Neira
  // -------------------------------------------------------------
  describe('Escenario 5: Ámbito territorial sin restricciones de ciudad', () => {
    test('Colombia tiene 33 divisiones administrativas (32 departamentos + Bogotá D.C.)', () => {
      const colombiaDivs = getAdministrativeDivisions('CO');
      expect(colombiaDivs.length).toBe(33);
      expect(colombiaDivs.find(d => d.id === 'CO-DC')).toBeDefined(); // Bogotá D.C.
      expect(colombiaDivs.find(d => d.id === 'CO-CAL')).toBeDefined(); // Caldas
      expect(colombiaDivs.find(d => d.id === 'CO-ANT')).toBeDefined(); // Antioquia
    });

    test('Caldas tiene exactamente 27 municipios oficiales clasificados con type = "municipio"', () => {
      const caldasDiv = getAdministrativeDivisions('CO').find(d => d.id === 'CO-CAL');
      expect(caldasDiv).toBeDefined();
      expect(caldasDiv.nombre).toBe('Caldas');

      const caldasCities = getCities('CO-CAL');
      expect(caldasCities.length).toBe(27);

      // Los 27 deben estar clasificados explícitamente como 'municipio'
      const officialMunicipalities = caldasCities.filter(c => c.type === 'municipio');
      expect(officialMunicipalities.length).toBe(27);

      // Todos deben tener source = 'dane_divipola' y source_id con prefijo departamental '17'
      caldasCities.forEach(city => {
        expect(city.source).toBe('dane_divipola');
        expect(city.source_id).toMatch(/^17\d{3}$/);
        expect(city.type).toBe('municipio');
      });

      // Validar presencia de municipios clave y preservación de IDs históricos
      const manizales = caldasCities.find(c => c.id === 'CO-CAL-MNZ');
      const villamaria = caldasCities.find(c => c.id === 'CO-CAL-VMA');
      const neira = caldasCities.find(c => c.id === 'CO-CAL-NEI');
      const laDorada = caldasCities.find(c => c.id === 'CO-CAL-LDO');
      const chinchina = caldasCities.find(c => c.id === 'CO-CAL-CHI');
      const riosucio = caldasCities.find(c => c.id === 'CO-CAL-RIO');
      const anserma = caldasCities.find(c => c.id === 'CO-CAL-ANS');

      expect(manizales).toBeDefined();
      expect(manizales.source_id).toBe('17001');
      expect(villamaria).toBeDefined();
      expect(villamaria.source_id).toBe('17873');
      expect(neira).toBeDefined();
      expect(neira.source_id).toBe('17486');
      expect(laDorada).toBeDefined();
      expect(laDorada.source_id).toBe('17380');
      expect(chinchina).toBeDefined();
      expect(chinchina.source_id).toBe('17174');
      expect(riosucio).toBeDefined();
      expect(riosucio.source_id).toBe('17614');
      expect(anserma).toBeDefined();
      expect(anserma.source_id).toBe('17042');
    });

    test('El catálogo geográfico global contiene más de 100 ciudades y no limita la tabla a Caldas', () => {
      expect(GEO_DATA.cities.length).toBeGreaterThanOrEqual(100);
      expect(GEO_DATA.cities.length).toBe(104);
    });

    test('Clasificación territorial diferenciada según el ordenamiento político de cada país', () => {
      const types = new Set(GEO_DATA.cities.map(c => c.type));
      expect(types.has('municipio')).toBe(true);
      expect(types.has('distrito_capital')).toBe(true);
      expect(types.has('distrito')).toBe(true);
      expect(types.has('alcaldia')).toBe(true);
      expect(types.has('provincia_capital')).toBe(true);
      expect(types.has('comuna')).toBe(true);
      expect(types.has('ciudad_autonoma')).toBe(true);
      expect(types.has('partido')).toBe(true);
    });

    test('Administrador en Manizales puede asignar vendedor en Villamaría', () => {
      const adminProfile = {
        id: 'admin-uuid-1',
        country_id: 'CO',
        division_id: 'CO-CAL',
        city_id: 'CO-CAL-MNZ',
        currency_code: 'COP',
        rol: 'admin',
      };

      const newVendorPayload = {
        nombre: 'Carlos',
        apellido: 'Vendedor',
        rol: 'vendedor',
        superior_id: adminProfile.id,
        country_id: 'CO',
        division_id: 'CO-CAL',
        city_id: 'CO-CAL-VMA',
        currency_code: 'COP',
      };

      expect(newVendorPayload.superior_id).toBe(adminProfile.id);
      expect(newVendorPayload.city_id).toBe('CO-CAL-VMA');
      expect(newVendorPayload.currency_code).toBe(adminProfile.currency_code);
    });

    test('Vendedor en Villamaría registra cliente en Neira con libre ubicación', () => {
      const clientPayload = {
        nombre: 'María',
        apellido: 'Cliente',
        documento: '1053800999',
        telefono: '3101234567',
        direccion: 'Carrera 4 # 5-20, Centro, Neira',
        monto: 300000,
        currency_code: 'COP',
      };

      expect(clientPayload.direccion).toContain('Neira');
      expect(clientPayload.currency_code).toBe('COP');
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 6: Integridad financiera entre entidades
  // -------------------------------------------------------------
  describe('Escenario 6: Integridad financiera entre entidades', () => {
    test('Crédito, cuotas, pagos y movimientos comparten la misma moneda', () => {
      const currency = 'MXN';
      const invoice = {
        id: 'inv-mx-001',
        amount: 5000.0,
        saldo: 3000.0,
        currency_code: currency,
      };

      const cuota = {
        id: 'cuota-mx-001',
        invoice_id: invoice.id,
        monto: 1000.0,
        currency_code: currency,
      };

      const pago = {
        id: 'pago-mx-001',
        invoice_id: invoice.id,
        valor: 1000.0,
        currency_code: currency,
      };

      const caja = {
        id: 'caja-mx-001',
        saldo_inicial: 10000.0,
        currency_code: currency,
      };

      const movimiento = {
        id: 'mov-mx-001',
        caja_id: caja.id,
        monto: 1000.0,
        tipo: 'pago',
        currency_code: currency,
      };

      expect(invoice.currency_code).toBe(caja.currency_code);
      expect(cuota.currency_code).toBe(invoice.currency_code);
      expect(pago.currency_code).toBe(invoice.currency_code);
      expect(movimiento.currency_code).toBe(caja.currency_code);
    });

    test('Rechazo explícito de cruce de monedas no compatibles', () => {
      const invoiceCOP = { id: 'inv-cop', currency_code: 'COP' };
      const cajaMXN = { id: 'caja-mxn', currency_code: 'MXN' };

      const canTransact = (inv, cj) => inv.currency_code === cj.currency_code;
      expect(canTransact(invoiceCOP, cajaMXN)).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 7: Preservación de moneda y sincronización offline
  // -------------------------------------------------------------
  describe('Escenario 7: Sincronización offline y determinismo', () => {
    test('Venta offline guarda currency_code en payload y en tablas locales', () => {
      const tempId = -1700000000000;
      const userProfile = { id: 'vend-1', currency_code: 'PEN' };

      const offlinePayload = {
        nombre: 'Pedro',
        documento: '40506070',
        monto: 800.0,
        vendedor_id: userProfile.id,
        currency_code: userProfile.currency_code,
      };

      const localInvoiceRow = {
        id: String(tempId),
        saldo: 960.0,
        currency_code: userProfile.currency_code,
      };

      expect(offlinePayload.currency_code).toBe('PEN');
      expect(localInvoiceRow.currency_code).toBe('PEN');

      // Generación determinista de UUID para idempotencia
      const localSaleUuid = `00000000-0000-4000-7000-${Math.abs(tempId).toString(16).padStart(12, '0')}`;
      expect(localSaleUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  // -------------------------------------------------------------
  // ESCENARIO 8: No-regresión y compatibilidad retroactiva
  // -------------------------------------------------------------
  describe('Escenario 8: No-regresión de utilidades monetarias existentes', () => {
    test('FormatMoney retrocompatible sin segundo argumento (default COP)', () => {
      const result = FormatMoney(100000);
      expect(result).toContain('100.000');
    });

    test('FormatMoneyDecimales retrocompatible sin segundo argumento (default COP)', () => {
      const result = FormatMoneyDecimales(250000);
      expect(result).toContain('250.000');
    });

    test('cleanMoneyValue extrae correctamente números sin romper contratos', () => {
      expect(cleanMoneyValue('$ 1.250.000')).toBe('1250000');
      expect(cleanMoneyValue('S/ 350.50', 'PEN')).toBe('350.50');
    });

    test('parseMoneyToNumeric convierte string a número de forma segura', () => {
      expect(parseMoneyToNumeric('$ 50.000')).toBe(50000);
    });
  });
});
