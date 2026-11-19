// __tests__/billingUi.test.js
import React from 'react';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));
jest.mock('react-native-background-timer', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
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
jest.mock('react-native-vector-icons/FontAwesome', () => 'Icon');
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const mockUseAuth = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));
jest.mock('../src/i18n', () => ({
  useTranslation: () => ({
    t: (key, opts) => key,
    language: 'es',
    changeLanguage: jest.fn(),
  }),
}));

import BillingAlertBanner from '../src/components/BillingAlertBanner';

describe('BillingAlertBanner Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Retorna null si no hay billingStatus o status es al_dia', () => {
    mockUseAuth.mockReturnValue({ billingStatus: null, rol: 'admin' });
    const resNull = BillingAlertBanner({});
    expect(resNull).toBeNull();

    mockUseAuth.mockReturnValue({
      billingStatus: { billing_status: 'al_dia' },
      rol: 'admin',
    });
    const resAlDia = BillingAlertBanner({});
    expect(resAlDia).toBeNull();
  });

  test('Renderiza banner para alerta_previa con mensaje de días restantes para admin', () => {
    mockUseAuth.mockReturnValue({
      billingStatus: {
        billing_status: 'alerta_previa',
        dias_para_pago: 7,
        factura_actual: { total: 120000 },
      },
      rol: 'admin',
    });

    const element = BillingAlertBanner({});
    expect(element).not.toBeNull();
    expect(element.props.disabled).toBe(false); // Admin puede interactuar
  });

  test('Renderiza banner para gracia_lectura (modo solo lectura)', () => {
    mockUseAuth.mockReturnValue({
      billingStatus: {
        billing_status: 'gracia_lectura',
        dias_para_bloqueo: 8,
        factura_actual: { total: 80000 },
      },
      rol: 'vendedor',
    });

    const element = BillingAlertBanner({});
    expect(element).not.toBeNull();
    expect(element.props.disabled).toBe(true); // Vendedor solo visualiza informativo
  });

  test('Renderiza banner para mora_critica', () => {
    mockUseAuth.mockReturnValue({
      billingStatus: {
        billing_status: 'mora_critica',
        dias_para_bloqueo: 2,
        factura_actual: { total: 160000 },
      },
      rol: 'admin',
    });

    const element = BillingAlertBanner({});
    expect(element).not.toBeNull();
  });

  test('Renderiza banner para en_revision cuando el comprobante fue reportado', () => {
    mockUseAuth.mockReturnValue({
      billingStatus: {
        billing_status: 'en_revision',
        factura_actual: { total: 160000, estado: 'confirmado_cliente' },
      },
      rol: 'admin',
    });

    const element = BillingAlertBanner({});
    expect(element).not.toBeNull();
  });
});
