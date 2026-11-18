/**
 * src/utils/currency.js
 * Servicio centralizado de internacionalización y formateo monetario para Zenda.
 * Soporta monedas sin decimales (COP, CLP) y con decimales (MXN, PEN, USD).
 * Utiliza Intl.NumberFormat con fallback seguro para React Native / Hermes.
 */

export const SUPPORTED_CURRENCIES = {
  COP: {
    code: 'COP',
    nombre: 'Peso colombiano',
    symbol: '$',
    decimalDigits: 0,
    defaultLocale: 'es-CO',
    defaultTimezone: 'America/Bogota',
  },
  MXN: {
    code: 'MXN',
    nombre: 'Peso mexicano',
    symbol: '$',
    decimalDigits: 2,
    defaultLocale: 'es-MX',
    defaultTimezone: 'America/Mexico_City',
  },
  PEN: {
    code: 'PEN',
    nombre: 'Sol peruano',
    symbol: 'S/',
    decimalDigits: 2,
    defaultLocale: 'es-PE',
    defaultTimezone: 'America/Lima',
  },
  CLP: {
    code: 'CLP',
    nombre: 'Peso chileno',
    symbol: '$',
    decimalDigits: 0,
    defaultLocale: 'es-CL',
    defaultTimezone: 'America/Santiago',
  },
  BRL: {
    code: 'BRL',
    nombre: 'Real brasileño',
    symbol: 'R$',
    decimalDigits: 2,
    defaultLocale: 'pt-BR',
    defaultTimezone: 'America/Sao_Paulo',
  },
  ARS: {
    code: 'ARS',
    nombre: 'Peso argentino',
    symbol: '$',
    decimalDigits: 2,
    defaultLocale: 'es-AR',
    defaultTimezone: 'America/Argentina/Buenos_Aires',
  },
  USD: {
    code: 'USD',
    nombre: 'Dólar estadounidense',
    symbol: '$',
    decimalDigits: 2,
    defaultLocale: 'en-US',
    defaultTimezone: 'America/New_York',
  },
};

export const DEFAULT_CURRENCY_CODE = 'COP';

/**
 * Obtiene la configuración de una moneda por su código ISO
 * @param {string} currencyCode 
 * @returns {object}
 */
export const getCurrencyConfig = (currencyCode) => {
  const code = (currencyCode || DEFAULT_CURRENCY_CODE).toUpperCase();
  return SUPPORTED_CURRENCIES[code] || {
    code,
    nombre: code,
    symbol: '$',
    decimalDigits: 2,
    defaultLocale: 'es-CO',
    defaultTimezone: 'America/Bogota',
  };
};

/**
 * Símbolo de la moneda
 */
export const getCurrencySymbol = (currencyCode) => {
  return getCurrencyConfig(currencyCode).symbol;
};

/**
 * Cantidad de decimales de la moneda
 */
export const getCurrencyDecimals = (currencyCode) => {
  return getCurrencyConfig(currencyCode).decimalDigits;
};

/**
 * Formatea un número como importe monetario
 * @param {number|string} amount - Monto numérico o convertible
 * @param {string} currencyCode - Código ISO (ej. 'COP', 'MXN', 'PEN', 'CLP')
 * @param {object} options - Opciones adicionales ({ showSymbol: true, showCode: false, locale: null })
 * @returns {string}
 */
export const formatCurrency = (amount, currencyCode = DEFAULT_CURRENCY_CODE, options = {}) => {
  const cfg = getCurrencyConfig(currencyCode);
  const {
    showSymbol = true,
    showCode = false,
    locale = cfg.defaultLocale,
    forceDecimals = null,
  } = options;

  let num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) num = 0;

  const decimals = forceDecimals !== null ? forceDecimals : cfg.decimalDigits;
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  let formattedNumber = '';

  // Intentar formatear con Intl.NumberFormat
  try {
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      formattedNumber = formatter.format(absNum);
    }
  } catch (e) {
    // Fallback manual si Intl falla o no tiene el locale
  }

  // Fallback si Intl no generó la cadena
  if (!formattedNumber) {
    const fixed = absNum.toFixed(decimals);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    formattedNumber = decimals > 0 ? `${parts[0]}.${parts[1]}` : parts[0];
  }

  const prefix = isNegative ? '-' : '';
  const symbolPart = showSymbol ? `${cfg.symbol} ` : '';
  const codePart = showCode ? ` ${cfg.code}` : '';

  return `${prefix}${symbolPart}${formattedNumber}${codePart}`.trim();
};

/**
 * Formatea un valor monetario en tiempo real para inputs según la moneda
 * - Para monedas sin decimales (COP, CLP): solo enteros con separador de miles
 * - Para monedas con decimales (MXN, PEN, USD): permite parte entera y hasta 2 decimales
 * @param {string|number} value 
 * @param {string} currencyCode 
 * @param {boolean} withSymbol 
 * @returns {string}
 */
export const formatMoneyInputByCurrency = (
  value,
  currencyCode = DEFAULT_CURRENCY_CODE,
  withSymbol = true,
  options = {}
) => {
  if (value === null || value === undefined || value === '') return '';

  if (typeof withSymbol === 'object' && withSymbol !== null) {
    options = withSymbol;
    withSymbol = options.withSymbol !== undefined ? options.withSymbol : true;
  }
  const forceDecimals = typeof options === 'boolean' ? options : !!(options && options.forceDecimals);

  const cfg = getCurrencyConfig(currencyCode);
  const symbol = cfg.symbol;
  const decimals = cfg.decimalDigits;

  const str = String(value);

  if (decimals === 0) {
    // Solo dígitos sin decimales
    const cleanDigits = str.replace(/\D/g, '').replace(/^0+/, '');
    if (!cleanDigits) return '';
    const formatted = cleanDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return withSymbol ? `${symbol} ${formatted}` : formatted;
  } else {
    // Con decimales (ej. BRL, MXN, PEN, USD, ARS)
    const escapedSymbol = (symbol || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let clean = str.replace(new RegExp(escapedSymbol, 'gi'), '').trim();
    clean = clean.replace(/[^\d.,]/g, '');

    if (!clean) return '';

    // Si el valor era '0.00' (o '0,00') y el usuario digitó números al final (ej. '0.004'),
    // extraer los nuevos dígitos para que nunca se bloquee la digitación.
    if (/^0[.,]0{2,}\d+/.test(clean)) {
      clean = clean.replace(/^0[.,]0{2,}/, '');
    }

    // Si termina con coma o punto (el usuario recién presionó el separador decimal al final)
    let hasTrailingDot = false;
    if (clean.endsWith('.') || clean.endsWith(',')) {
      hasTrailingDot = true;
      clean = clean.slice(0, -1);
    }

    let intPart = '';
    let decPart = '';
    let hasDecimals = false;

    if (hasTrailingDot) {
      // El usuario acaba de presionar . o , al final
      intPart = clean.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      hasDecimals = true;
      decPart = '';
    } else if (clean.includes('.') && clean.includes(',')) {
      // Ambos separadores presentes: el último determina cuál es el separador decimal
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        // Europeo / Brasilero formal: 1.000,50 -> miles '.', decimal ','
        const lastComma = clean.lastIndexOf(',');
        intPart = clean.substring(0, lastComma).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        decPart = clean.substring(lastComma + 1).replace(/\D/g, '').slice(0, decimals);
      } else {
        // Estándar: 1,000.50 -> miles ',', decimal '.'
        const lastDot = clean.lastIndexOf('.');
        intPart = clean.substring(0, lastDot).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        decPart = clean.substring(lastDot + 1).replace(/\D/g, '').slice(0, decimals);
      }
      hasDecimals = true;
    } else if (clean.includes('.')) {
      // Solo punto presente: es el separador decimal
      const dotIndex = clean.indexOf('.');
      intPart = clean.substring(0, dotIndex).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      decPart = clean.substring(dotIndex + 1).replace(/\D/g, '').slice(0, decimals);
      hasDecimals = true;
    } else {
      // No hay punto ni separador decimal explícito: todos los dígitos son enteros.
      // Todas las comas son separadores de miles generados por el formateador previo.
      intPart = clean.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    }

    if (!intPart && !hasDecimals) return '';

    const formattedInt = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let result = formattedInt;
    if (hasDecimals) {
      const finalDec = forceDecimals ? decPart.padEnd(decimals, '0') : decPart;
      result = `${formattedInt}.${finalDec}`;
    } else if (forceDecimals) {
      result = `${formattedInt}.${'0'.repeat(decimals)}`;
    }

    return withSymbol ? `${symbol} ${result}` : result;
  }
};

/**
 * Convierte un texto formateado a número flotante seguro según la moneda
 * @param {string|number} value 
 * @param {string} currencyCode 
 * @returns {number}
 */
export const parseMoneyToNumericByCurrency = (value, currencyCode = DEFAULT_CURRENCY_CODE) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  const cfg = getCurrencyConfig(currencyCode);
  const str = String(value).trim();

  if (cfg.decimalDigits === 0) {
    const digits = str.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : 0;
  } else {
    // Remover símbolos de moneda y espacios de forma segura
    const escapedSymbol = (cfg.symbol || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let clean = str.replace(new RegExp(escapedSymbol, 'g'), '').replace(/\s/g, '');
    // Si contiene comas y puntos, determinar cuál es el separador decimal
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        // Formato europeo: 1.000,50 -> 1000.50
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        // Formato estándar: 1,000.50 -> 1000.50
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      // Solo coma: si tiene 1 o 2 dígitos tras la coma, es decimal (ej. 12,50)
      const parts = clean.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        clean = parts[0] + '.' + parts[1];
      } else {
        clean = clean.replace(/,/g, '');
      }
    }
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : Math.round(val * 100) / 100;
  }
};

/**
 * Limpia un valor de entrada para edición en formularios
 * @param {string|number} value 
 * @param {string} currencyCode 
 * @returns {string}
 */
export const cleanMoneyValueByCurrency = (value, currencyCode = DEFAULT_CURRENCY_CODE) => {
  if (value === null || value === undefined) return '';
  const cfg = getCurrencyConfig(currencyCode);
  if (cfg.decimalDigits === 0) {
    const digits = String(value).replace(/\D/g, '');
    return digits.replace(/^0+/, '');
  } else {
    return String(value).replace(/[^\d.,]/g, '');
  }
};

export const formatMoneyInput = formatMoneyInputByCurrency;

export default {
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  getCurrencyConfig,
  getCurrencySymbol,
  getCurrencyDecimals,
  formatCurrency,
  formatMoneyInputByCurrency,
  parseMoneyToNumericByCurrency,
  cleanMoneyValueByCurrency,
};

