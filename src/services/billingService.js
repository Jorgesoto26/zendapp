// src/services/billingService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';

const CACHE_KEY_BILLING = 'cached_billing_status';
const CACHE_KEY_CONFIG = 'cached_billing_config';

/**
 * Consulta el estado de facturación y configuración bancaria/tarifaria desde Supabase
 * para la organización del usuario en sesión.
 * Si falla la RPC remota, intenta obtener la configuración global directamente y la última factura.
 * Si está offline, retorna los datos previamente cacheados de la base de datos.
 */
export const getBillingStatus = async () => {
  try {
    await ensureAuthenticatedSession();

    // 1. Intentar llamar a la RPC oficial en Supabase
    const { data, error } = await supabase.rpc('billing_get_organization_status');

    if (!error && data && !data.error) {
      try {
        await AsyncStorage.setItem(CACHE_KEY_BILLING, JSON.stringify(data));
        if (data.config) {
          await AsyncStorage.setItem(CACHE_KEY_CONFIG, JSON.stringify(data.config));
        }
      } catch {}
      return data;
    }

    // 2. Fallback resiliente: Si la RPC falla, consultar directamente la tabla billing_config_global
    try {
      const { data: globalCfg } = await supabase
        .from('billing_config_global')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (globalCfg) {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;

        let orgId = null;
        let orgConfig = null;
        let latestInvoice = null;
        let activeRoutesCount = 0;

        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('organizacion_id')
            .eq('id', userId)
            .maybeSingle();

          orgId = profile?.organizacion_id;

          if (orgId) {
            const { data: bc } = await supabase
              .from('billing_config')
              .select('*')
              .eq('organizacion_id', orgId)
              .maybeSingle();
            orgConfig = bc;

            const { data: inv } = await supabase
              .from('billing_invoices')
              .select('*')
              .eq('organizacion_id', orgId)
              .order('fecha_vencimiento', { ascending: false })
              .limit(1)
              .maybeSingle();
            latestInvoice = inv;

            const { count } = await supabase
              .from('profiles')
              .select('*', { count: 'exact', head: true })
              .eq('organizacion_id', orgId)
              .eq('rol', 'vendedor')
              .eq('activo', true);
            activeRoutesCount = count || 0;
          }
        }

        const precioRuta =
          orgConfig?.tiene_precio_especial && orgConfig?.precio_por_ruta > 0
            ? Number(orgConfig.precio_por_ruta)
            : Number(globalCfg.precio_por_ruta_defecto || 40000);

        const resolvedConfig = {
          banco: orgConfig?.banco || globalCfg.banco || 'Bancolombia',
          tipo_cuenta: orgConfig?.tipo_cuenta || globalCfg.tipo_cuenta || 'Ahorros',
          numero_cuenta: orgConfig?.numero_cuenta || globalCfg.numero_cuenta || '123-456789-00',
          titular_cuenta: orgConfig?.titular_cuenta || globalCfg.titular_cuenta || 'REACTIVA S.A.S',
          nit_titular: orgConfig?.nit_titular || globalCfg.nit_titular || '901.XXX.XXX-X',
          precio_por_ruta: precioRuta,
          tiene_precio_especial: Boolean(orgConfig?.tiene_precio_especial),
          dia_facturacion: orgConfig?.dia_facturacion || globalCfg.dia_facturacion || 28,
          dias_alerta_previo: orgConfig?.dias_alerta_previo || globalCfg.dias_alerta_previo || 10,
          dias_gracia_lectura: orgConfig?.dias_gracia_lectura || globalCfg.dias_gracia_lectura || 10,
          dias_bloqueo_total: orgConfig?.dias_bloqueo_total || globalCfg.dias_bloqueo_total || 18,
        };

        const fallbackData = {
          organizacion_id: orgId,
          billing_status:
            latestInvoice?.estado === 'pagado'
              ? 'al_dia'
              : latestInvoice?.estado === 'confirmado_cliente'
              ? 'en_revision'
              : 'al_dia',
          is_read_only: false,
          is_suspended: false,
          dias_para_pago: 28,
          dias_mora: 0,
          dias_para_bloqueo: resolvedConfig.dias_bloqueo_total,
          num_rutas_activas: activeRoutesCount,
          total_estimado: activeRoutesCount * precioRuta,
          config: resolvedConfig,
          factura_actual: latestInvoice,
        };

        try {
          await AsyncStorage.setItem(CACHE_KEY_BILLING, JSON.stringify(fallbackData));
          await AsyncStorage.setItem(CACHE_KEY_CONFIG, JSON.stringify(resolvedConfig));
        } catch {}

        return fallbackData;
      }
    } catch (fallbackErr) {
      console.log('Direct DB billing fallback notice:', fallbackErr);
    }
  } catch (err) {
    console.log('getBillingStatus remote warning:', err);
  }

  // 3. Fallback a caché offline (último estado descargado exitosamente)
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_BILLING);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  // 4. Fallback si solo se tenía guardada la configuración bancaria
  let cachedConfig = null;
  try {
    const cfgStr = await AsyncStorage.getItem(CACHE_KEY_CONFIG);
    if (cfgStr) cachedConfig = JSON.parse(cfgStr);
  } catch {}

  // Fallback seguro por defecto si nunca ha sincronizado
  return {
    billing_status: 'al_dia',
    is_read_only: false,
    is_suspended: false,
    dias_para_pago: 28,
    dias_mora: 0,
    dias_para_bloqueo: 18,
    num_rutas_activas: 0,
    total_estimado: 0,
    config: cachedConfig || {
      banco: 'Bancolombia',
      tipo_cuenta: 'Ahorros',
      numero_cuenta: '123-456789-00',
      titular_cuenta: 'REACTIVA S.A.S',
      nit_titular: '901.XXX.XXX-X',
      precio_por_ruta: 40000,
      dia_facturacion: 28,
      dias_gracia_lectura: 10,
      dias_bloqueo_total: 18,
      dias_alerta_previo: 10,
    },
    factura_actual: null,
  };
};

/**
 * Retorna únicamente la configuración de facturación y datos bancarios descargados.
 */
export const getBillingConfig = async () => {
  try {
    const status = await getBillingStatus();
    if (status?.config) return status.config;
  } catch {}
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_CONFIG);
    if (cached) return JSON.parse(cached);
  } catch {}
  return null;
};

/**
 * Permite al administrador reportar que ya realizó la transferencia bancaria.
 * @param {string} invoiceId - ID de la factura (billing_invoices.id)
 * @param {string} [referencia] - Número de comprobante o aprobación bancaria
 * @param {string} [comprobanteUrl] - URL o ruta de comprobante en Storage
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
        if (comprobanteUrl) {
          parsed.factura_actual.comprobante_url = comprobanteUrl;
        }
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
