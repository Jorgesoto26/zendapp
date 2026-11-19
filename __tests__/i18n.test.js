// __tests__/i18n.test.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, STORAGE_KEY_LANGUAGE } from '../src/i18n/I18nContext';
import es from '../src/i18n/locales/es.json';
import en from '../src/i18n/locales/en.json';
import pt from '../src/i18n/locales/pt.json';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
  },
}));

describe('Sistema de Internacionalización (i18n) Multilenguaje', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Soporta los 3 idiomas requeridos: Español (es), Inglés (en) y Portugués (pt)', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toContain('es');
    expect(codes).toContain('en');
    expect(codes).toContain('pt');
    expect(SUPPORTED_LANGUAGES.length).toBe(3);
  });

  test('Los diccionarios es, en y pt contienen las claves comunes requeridas', () => {
    const keysToCheck = ['common.save', 'common.cancel', 'common.logout', 'payments.quota', 'billing.title'];

    const getVal = (obj, path) => {
      const parts = path.split('.');
      let curr = obj;
      for (const p of parts) curr = curr?.[p];
      return curr;
    };

    keysToCheck.forEach((key) => {
      expect(getVal(es, key)).toBeDefined();
      expect(getVal(en, key)).toBeDefined();
      expect(getVal(pt, key)).toBeDefined();
    });
  });

  test('Traducción correcta de términos en cada idioma', () => {
    // Español
    expect(es.menu.payments).toBe('Pagos');
    expect(es.payments.overdue_balance).toBe('SALDO VENCIDO');
    expect(es.common.logout).toBe('Cerrar Sesión');

    // Inglés
    expect(en.menu.payments).toBe('Payments');
    expect(en.payments.overdue_balance).toBe('OVERDUE BALANCE');
    expect(en.common.logout).toBe('Sign Out');
    expect(en.users.max_caja).toBe('Max Cash');
    expect(en.users.delete_sale).toBe('Delete sale');
    expect(en.users.disable).toBe('Disable');
    expect(en.users.enable).toBe('Enable');

    // Portugués
    expect(pt.menu.payments).toBe('Pagamentos');
    expect(pt.payments.overdue_balance).toBe('SALDO VENCIDO');
    expect(pt.common.logout).toBe('Sair');
    expect(pt.users.max_caja).toBe('Máx. Caixa');
    expect(pt.users.delete_sale).toBe('Excluir venda');
    expect(pt.users.disable).toBe('Desativar');
    expect(pt.users.enable).toBe('Ativar');
  });

  test('Paridad total de claves entre los diccionarios es, en y pt', () => {
    const getAllKeys = (obj, prefix = '') => {
      let keys = [];
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          keys = keys.concat(getAllKeys(v, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    };

    const esKeys = getAllKeys(es);
    const enKeys = getAllKeys(en);
    const ptKeys = getAllKeys(pt);

    // Cada clave en Español debe existir en Inglés y Portugués
    esKeys.forEach((key) => {
      expect(enKeys).toContain(key);
      expect(ptKeys).toContain(key);
    });

    // Cada clave en Inglés debe existir en Español
    enKeys.forEach((key) => {
      expect(esKeys).toContain(key);
    });

    // Cada clave en Portugués debe existir en Español
    ptKeys.forEach((key) => {
      expect(esKeys).toContain(key);
    });
  });

  test('Almacenamiento en AsyncStorage usa la clave STORAGE_KEY_LANGUAGE', () => {
    expect(STORAGE_KEY_LANGUAGE).toBe('user_app_language');
  });
});
