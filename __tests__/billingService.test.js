// __tests__/billingService.test.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureAuthenticatedSession } from '../src/lib/supabase';
import {
  getBillingStatus,
  confirmBillingPayment,
  generarFacturaManual,
} from '../src/services/billingService';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
  ensureAuthenticatedSession: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('billingService - Facturación por Organización', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBillingStatus', () => {
    test('Obtiene el estado de facturación desde la RPC de Supabase y guarda en caché', async () => {
      const mockData = {
        organizacion_id: 'org-123',
        billing_status: 'alerta_previa',
        is_read_only: false,
        is_suspended: false,
        dias_para_pago: 5,
        dias_mora: 0,
        dias_para_bloqueo: 18,
        config: {
          banco: 'Bancolombia',
          numero_cuenta: '987-654321-00',
          precio_por_ruta: 40000,
        },
        factura_actual: {
          id: 'inv-1',
          total: 160000,
          num_vendedores: 4,
          estado: 'pendiente',
        },
      };

      supabase.rpc.mockResolvedValueOnce({ data: mockData, error: null });

      const res = await getBillingStatus();
      expect(ensureAuthenticatedSession).toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledWith('billing_get_organization_status');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'cached_billing_status',
        JSON.stringify(mockData)
      );
      expect(res).toEqual(mockData);
    });

    test('Usa el caché offline si la RPC falla o no hay conexión', async () => {
      const mockCached = {
        organizacion_id: 'org-123',
        billing_status: 'gracia_lectura',
        is_read_only: true,
        is_suspended: false,
      };

      supabase.rpc.mockRejectedValueOnce(new Error('Network error'));
      AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(mockCached));

      const res = await getBillingStatus();
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('cached_billing_status');
      expect(res).toEqual(mockCached);
    });

    test('Retorna fallback seguro por defecto si no hay conexión ni caché previo', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      AsyncStorage.getItem.mockResolvedValueOnce(null);

      const res = await getBillingStatus();
      expect(res.billing_status).toBe('al_dia');
      expect(res.is_read_only).toBe(false);
      expect(res.is_suspended).toBe(false);
      expect(res.config.precio_por_ruta).toBe(40000);
      expect(res.config.dia_facturacion).toBe(28);
    });
  });

  describe('confirmBillingPayment', () => {
    test('Invoca la RPC de confirmación y actualiza el caché local', async () => {
      const mockResponse = {
        success: true,
        invoice_id: 'inv-1',
        estado: 'confirmado_cliente',
      };

      supabase.rpc.mockResolvedValueOnce({ data: mockResponse, error: null });
      AsyncStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          billing_status: 'alerta_previa',
          factura_actual: { id: 'inv-1', estado: 'pendiente' },
        })
      );

      const res = await confirmBillingPayment('inv-1', 'REF-998877');
      expect(supabase.rpc).toHaveBeenCalledWith('billing_confirmar_pago', {
        p_invoice_id: 'inv-1',
        p_referencia: 'REF-998877',
        p_comprobante_url: null,
      });
      expect(res).toEqual(mockResponse);
      expect(AsyncStorage.setItem).toHaveBeenCalled();
    });

    test('Lanza error si la RPC responde con error', async () => {
      supabase.rpc.mockResolvedValueOnce({
        data: { success: false, error: 'Factura no encontrada' },
        error: null,
      });

      await expect(confirmBillingPayment('inv-err')).rejects.toThrow('Factura no encontrada');
    });
  });

  describe('generarFacturaManual', () => {
    test('Invoca billing_generar_factura_mensual con los parámetros dados', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: { id: 'inv-new', total: 200000 }, error: null });

      const res = await generarFacturaManual('org-uuid', '2026-11-28');
      expect(supabase.rpc).toHaveBeenCalledWith('billing_generar_factura_mensual', {
        p_org_id: 'org-uuid',
        p_fecha_corte: '2026-11-28',
      });
      expect(res.total).toBe(200000);
    });
  });
});
