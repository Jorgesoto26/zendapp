// src/services/billingService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';

const CACHE_KEY_BILLING = 'cached_billing_status';

/**
 * Consulta el estado de facturación de la organización del usuario en sesión.
 * Si no hay conexión o falla la RPC remota, retorna el estado previamente cacheado.
 */
export const getBillingStatus = async () => {
  try {
    await ensureAuthenticatedSession();
    const { data, error } = await supabase.rpc('billing_get_organization_status');

    if (!error && data && !data.error) {
      try {
        await AsyncStorage.setItem(CACHE_KEY_BILLING, JSON.stringify(data));
      } catch {}
      return data;
    }
  } catch (err) {
    console.log('getBillingStatus remote warning:', err);
  }

  // Fallback a caché offline
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_BILLING);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  // Fallback seguro por defecto si nunca ha sincronizado
  return {
    billing_status: 'al_dia',
    is_read_only: false,
    is_suspended: false,
    dias_para_pago: 28,
    dias_mora: 0,
    dias_para_bloqueo: 18,
    config: {
      banco: 'Bancolombia',
      tipo_cuenta: 'Ahorros',
      numero_cuenta: '123-456789-00',
      titular_cuenta: 'REACTIVA S.A.S',
      nit_titular: '901.XXX.XXX-X',
      precio_por_ruta: 40000,
      dia_facturacion: 28,
      dias_gracia_lectura: 10,
      dias_bloqueo_total: 18,
    },
    factura_actual: null,
  };
};

/**
 * Permite al administrador reportar que ya realizó la transferencia bancaria.
 * @param {string} invoiceId - ID de la factura (billing_invoices.id)
 * @param {string} [referencia] - Número de comprobante o aprobación bancaria
 * @param {string} [comprobanteUrl] - URL o ruta de comprobante
 */
export const confirmBillingPayment = async (invoiceId, referencia = '', comprobanteUrl = null) => {
  await ensureAuthenticatedSession();
  const { data, error } = await supabase.rpc('billing_confirmar_pago', {
    p_invoice_id: invoiceId,
    p_referencia: referencia ? String(referencia).trim() : null,
    p_comprobante_url: comprobanteUrl || null,
  });

  if (error) {
    throw new Error(error.message || 'Error al confirmar pago de suscripción');
  }

  if (data && data.success === false) {
    throw new Error(data.error || 'No se pudo confirmar el pago');
  }

  // Actualizar estado en caché local a en_revision
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_BILLING);
    if (cached) {
      const parsed = JSON.parse(cached);
      parsed.billing_status = 'en_revision';
      if (parsed.factura_actual) {
        parsed.factura_actual.estado = 'confirmado_cliente';
        parsed.factura_actual.referencia_pago = referencia;
      }
      await AsyncStorage.setItem(CACHE_KEY_BILLING, JSON.stringify(parsed));
    }
  } catch {}

  return data;
};

/**
 * Solicita la generación o re-cálculo manual de la factura mensual para la organización.
 */
export const generarFacturaManual = async (orgId, fechaCorte = null) => {
  await ensureAuthenticatedSession();
  const params = { p_org_id: orgId };
  if (fechaCorte) params.p_fecha_corte = fechaCorte;

  const { data, error } = await supabase.rpc('billing_generar_factura_mensual', params);
  if (error) throw new Error(error.message || 'Error al generar factura');
  return data;
};
