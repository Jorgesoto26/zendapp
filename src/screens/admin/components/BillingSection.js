// src/screens/admin/components/BillingSection.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Platform,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import { getBillingStatus, confirmBillingPayment } from '../../../services/billingService';
import { uploadEvidence } from '../../../services/multimediaService';
import { FormatMoneyDecimales } from '../../../utils/utilities';
import { zendapp } from '../../../theme/zendappTheme';
import { apple } from '../../../theme/appleTheme';
import { appAlert } from '../../../components/AppAlert';
import BillingEvidencePicker from '../../../components/BillingEvidencePicker';
import EvidencePreviewModal from '../../../components/EvidencePreviewModal';
import { useTranslation } from '../../../i18n';

const getStatusBadge = (status, estadoFactura, t) => {
  if (estadoFactura === 'confirmado_cliente' || status === 'en_revision') {
    return {
      label: t('billing.status_in_verification'),
      color: '#D97706',
      bg: '#FEF3C7',
      borderColor: '#FDE68A',
      icon: 'hourglass-half',
    };
  }
  switch (status) {
    case 'al_dia':
      return {
        label: t('billing.status_up_to_date'),
        color: zendapp.colors.success || '#10B981',
        bg: '#ECFDF5',
        borderColor: '#A7F3D0',
        icon: 'check-circle',
      };
    case 'alerta_previa':
      return {
        label: t('billing.status_due_soon'),
        color: '#D97706',
        bg: '#FFFBEB',
        borderColor: '#FDE68A',
        icon: 'exclamation-circle',
      };
    case 'gracia_lectura':
      return {
        label: t('billing.status_grace'),
        color: zendapp.colors.danger || '#EE272D',
        bg: '#FEF2F2',
        borderColor: '#FECACA',
        icon: 'clock-o',
      };
    case 'mora_critica':
    case 'suspendido':
      return {
        label: t('billing.status_suspended'),
        color: '#991B1B',
        bg: '#FEE2E2',
        borderColor: '#F87171',
        icon: 'ban',
      };
    default:
      return {
        label: t('billing.status_pending'),
        color: '#4B5563',
        bg: '#F3F4F6',
        borderColor: '#E5E7EB',
        icon: 'info-circle',
      };
  }
};

export default function BillingSection({ onRefreshGlobal }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [billingData, setBillingData] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showEvidenceViewer, setShowEvidenceViewer] = useState(false);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await getBillingStatus();
      setBillingData(data);
    } catch (e) {
      console.log('Error fetching billing status:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleCopyAccount = (accountNumber) => {
    if (!accountNumber) return;
    Clipboard.setString(accountNumber);
    Toast.show({
      type: 'success',
      text1: t('billing.account_copied'),
      text2: '',
      position: 'bottom',
    });
  };

  const handleConfirmPayment = async () => {
    const factura = billingData?.factura_actual;
    if (!factura?.id) {
      appAlert(t('common.error'), 'No invoice found.');
      return;
    }

    if (!evidence) {
      appAlert(
        t('billing.voucher_required'),
        t('billing.voucher_required_msg')
      );
      return;
    }

    try {
      setConfirming(true);
      let comprobanteUrl = null;
      try {
        const uploadRes = await uploadEvidence({
          uri: evidence.uri,
          base64: evidence.base64,
          tipoEvidencia: 'comprobante_facturacion',
          tablaRelacionada: 'billing_invoices',
          registroId: factura.id,
          originalName: evidence.fileName || `comprobante_${factura.id}.jpg`,
          mimeType: evidence.type || 'image/jpeg',
          originalSize: evidence.fileSize || 0,
          compressedSize: evidence.fileSize || 0,
        });
        comprobanteUrl = uploadRes?.filePath || evidence.uri;
      } catch (uploadErr) {
        console.log('Error subiendo evidencia a Storage:', uploadErr);
        comprobanteUrl = evidence.uri;
      }

      await confirmBillingPayment(factura.id, 'Evidencia adjunta', comprobanteUrl);
      appAlert(
        t('billing.voucher_sent'),
        t('billing.voucher_sent_msg')
      );
      setEvidence(null);
      await fetchStatus(true);
      if (onRefreshGlobal) onRefreshGlobal();
    } catch (err) {
      appAlert(t('common.error'), err.message || 'Error sending voucher');
    } finally {
      setConfirming(false);
    }
  };

  if (loading && !billingData) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={zendapp.colors.primary} />
        <Text style={styles.loadingText}>{t('billing.loading_billing')}</Text>
      </View>
    );
  }

  const config = billingData?.config || {};
  const factura = billingData?.factura_actual;
  const status = billingData?.billing_status || 'al_dia';
  const badge = getStatusBadge(status, factura?.estado, t);
  const isConfirmado = factura?.estado === 'confirmado_cliente';
  const isPagado = factura?.estado === 'pagado';
  const diaFacturacion = config.dia_facturacion || 28;
  const precioUnitario = Number(config.precio_por_ruta || 0);
  const numRutas = factura
    ? Number(factura.num_vendedores || 0)
    : Number(billingData?.num_rutas_activas || 0);
  const totalPagar = factura
    ? Number(factura.total || 0)
    : (billingData?.total_estimado != null ? Number(billingData.total_estimado) : numRutas * precioUnitario);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchStatus(false);
          }}
          colors={[zendapp.colors.primary]}
          tintColor={zendapp.colors.primary}
        />
      }
    >
      {/* 1. Card de Factura Actual */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <View style={styles.iconCircle}>
              <Icon name="credit-card" size={15} color={zendapp.colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>{t('billing.monthly_billing')}</Text>
              <Text style={styles.cardSubtitle}>
                {factura
                  ? `${t('billing.period')} ${factura.periodo_mes}/${factura.periodo_anio}`
                  : t('billing.subscription_by_routes')}
              </Text>
            </View>
          </View>

          <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.borderColor }]}>
            <Icon name={badge.icon} size={11} color={badge.color} style={{ marginRight: 4 }} />
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        </View>

        {/* Desglose */}
        <View style={styles.breakdown}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('billing.active_routes')}</Text>
            <Text style={styles.breakdownVal}>
              {numRutas === 1
                ? t('billing.vendors_count_one', { count: numRutas })
                : t('billing.vendors_count_many', { count: numRutas })}
            </Text>
          </View>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('billing.price_per_route')}</Text>
            <Text style={styles.breakdownVal}>{FormatMoneyDecimales(precioUnitario, 'COP')}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {factura ? t('billing.total_to_pay') : t('billing.estimated_total_next_cycle')}
            </Text>
            <Text style={styles.totalVal}>{FormatMoneyDecimales(totalPagar, 'COP')}</Text>
          </View>

          <View style={styles.dateRow}>
            <Icon name="calendar" size={12} color="#667085" style={{ marginRight: 5 }} />
            <Text style={styles.dateText}>
              {t('billing.cut_date')}{' '}
              <Text style={{ fontWeight: '700' }}>
                {t('billing.cut_day_notice', { day: diaFacturacion })}
              </Text>
            </Text>
          </View>
        </View>

        {/* Nota informativa de la regla de nuevos vendedores */}
        <View style={styles.ruleNote}>
          <Icon name="info-circle" size={13} color="#475467" style={{ marginTop: 1, marginRight: 6 }} />
          <Text style={styles.ruleNoteText}>
            {t('billing.rule_new_vendors', { day: diaFacturacion })}
          </Text>
        </View>
      </View>

      {/* 2. Card de Datos de Transferencia Bancaria */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <View style={[styles.iconCircle, { backgroundColor: '#F0FDF4' }]}>
              <Icon name="bank" size={14} color="#16A34A" />
            </View>
            <View>
              <Text style={styles.cardTitle}>{t('billing.account_details')}</Text>
              <Text style={styles.cardSubtitle}>{t('billing.bank_account_co')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bankDetails}>
          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>{t('billing.bank')}:</Text>
            <Text style={styles.bankVal}>{config.banco || '—'}</Text>
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>{t('billing.account_type')}:</Text>
            <Text style={styles.bankVal}>{config.tipo_cuenta || '—'}</Text>
          </View>

          {/* Fila destacada con botón Copiar */}
          <View style={styles.accountHighlight}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountLabel}>{t('billing.account_number_upper')}</Text>
              <Text style={styles.accountNumber}>{config.numero_cuenta || '—'}</Text>
            </View>
            {config.numero_cuenta ? (
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={() => handleCopyAccount(config.numero_cuenta)}
                activeOpacity={0.7}
              >
                <Icon name="copy" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
                <Text style={styles.copyBtnText}>{t('billing.copy')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>{t('billing.account_holder')}:</Text>
            <Text style={styles.bankVal}>{config.titular_cuenta || '—'}</Text>
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>{t('billing.nit')}:</Text>
            <Text style={styles.bankVal}>{config.nit_titular || '—'}</Text>
          </View>
        </View>
      </View>

      {/* 3. Acción de Confirmación de Pago */}
      {isPagado ? (
        <View style={[styles.card, styles.cardSuccess]}>
          <Icon name="check-circle" size={24} color="#16A34A" style={{ marginBottom: 6 }} />
          <Text style={styles.successTitle}>{t('billing.subscription_up_to_date')}</Text>
          <Text style={styles.successSub}>
            {t('billing.subscription_up_to_date_desc')}
          </Text>
        </View>
      ) : isConfirmado ? (
        <View style={[styles.card, styles.cardPendingReview]}>
          <Icon name="hourglass-half" size={22} color="#D97706" style={{ marginBottom: 6 }} />
          <Text style={styles.reviewTitle}>{t('billing.in_review_title')}</Text>
          <Text style={styles.reviewSub}>
            {t('billing.in_review_sub')}
          </Text>
          {factura?.comprobante_url ? (
            <TouchableOpacity
              style={styles.viewEvidenceBtn}
              onPress={() => setShowEvidenceViewer(true)}
              activeOpacity={0.8}
            >
              <Icon name="file-image-o" size={13} color="#B45309" style={{ marginRight: 6 }} />
              <Text style={styles.viewEvidenceBtnText}>{t('billing.view_sent_evidence')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.confirmTitle}>{t('billing.confirm_title')}</Text>
          <Text style={styles.confirmSub}>
            {t('billing.confirm_sub')}
          </Text>

          <BillingEvidencePicker
            evidence={evidence}
            onSelectEvidence={setEvidence}
            onRemoveEvidence={() => setEvidence(null)}
            disabled={confirming}
          />

          <TouchableOpacity
            style={[styles.confirmBtn, (confirming || !evidence) && { opacity: 0.7 }]}
            onPress={handleConfirmPayment}
            disabled={confirming}
            activeOpacity={0.8}
          >
            {confirming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="check" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.confirmBtnText}>{t('billing.confirm_btn')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Espaciador inferior */}
      <View style={{ height: 40 }} />

      {/* Modal para ver el comprobante reportado */}
      {factura?.comprobante_url && (
        <EvidencePreviewModal
          visible={showEvidenceViewer}
          onClose={() => setShowEvidenceViewer(false)}
          title={t('billing.voucher_sent')}
          filePath={factura.comprobante_url}
          readOnly={true}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
  },
  centerContainer: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#667085',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
    ...Platform.select({
      ios: { shadowColor: '#101828', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D2939',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#667085',
    marginTop: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  breakdown: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#475467',
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D2939',
  },
  divider: {
    height: 1,
    backgroundColor: '#E4E7EC',
    marginVertical: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1D2939',
  },
  totalVal: {
    fontSize: 18,
    fontWeight: '800',
    color: zendapp.colors.primary,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  dateText: {
    fontSize: 12,
    color: '#667085',
  },
  ruleNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#B9E6FE',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  ruleNoteText: {
    fontSize: 11,
    color: '#026AA2',
    lineHeight: 16,
    flex: 1,
  },
  bankDetails: {
    gap: 10,
  },
  bankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bankLabel: {
    fontSize: 13,
    color: '#667085',
  },
  bankVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D2939',
  },
  accountHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FB',
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    padding: 12,
    marginVertical: 4,
  },
  accountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#667085',
    letterSpacing: 0.5,
  },
  accountNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#101828',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  confirmTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D2939',
    marginBottom: 4,
  },
  confirmSub: {
    fontSize: 12,
    color: '#667085',
    lineHeight: 17,
    marginBottom: 12,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    fontSize: 13,
    color: '#1D2939',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 10,
    height: 44,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardSuccess: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  successTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 4,
  },
  successSub: {
    fontSize: 12,
    color: '#15803D',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  cardPendingReview: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  reviewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
  },
  reviewSub: {
    fontSize: 12,
    color: '#92400E',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  reviewRef: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#78350F',
  },
  viewEvidenceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  viewEvidenceBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
});
