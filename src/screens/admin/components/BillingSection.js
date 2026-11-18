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

const getStatusBadge = (status, estadoFactura) => {
  if (estadoFactura === 'confirmado_cliente' || status === 'en_revision') {
    return {
      label: 'En Verificación',
      color: '#D97706',
      bg: '#FEF3C7',
      borderColor: '#FDE68A',
      icon: 'hourglass-half',
    };
  }
  switch (status) {
    case 'al_dia':
      return {
        label: 'Al día',
        color: zendapp.colors.success || '#10B981',
        bg: '#ECFDF5',
        borderColor: '#A7F3D0',
        icon: 'check-circle',
      };
    case 'alerta_previa':
      return {
        label: 'Por vencer',
        color: '#D97706',
        bg: '#FFFBEB',
        borderColor: '#FDE68A',
        icon: 'exclamation-circle',
      };
    case 'gracia_lectura':
      return {
        label: 'Vencido (Gracia)',
        color: zendapp.colors.danger || '#EE272D',
        bg: '#FEF2F2',
        borderColor: '#FECACA',
        icon: 'clock-o',
      };
    case 'mora_critica':
    case 'suspendido':
      return {
        label: 'Suspendido',
        color: '#991B1B',
        bg: '#FEE2E2',
        borderColor: '#F87171',
        icon: 'ban',
      };
    default:
      return {
        label: 'Pendiente',
        color: '#4B5563',
        bg: '#F3F4F6',
        borderColor: '#E5E7EB',
        icon: 'info-circle',
      };
  }
};

export default function BillingSection({ onRefreshGlobal }) {
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
      text1: 'Número de cuenta copiado',
      text2: 'Listo para pegar en tu app bancaria',
      position: 'bottom',
    });
  };

  const handleConfirmPayment = async () => {
    const factura = billingData?.factura_actual;
    if (!factura?.id) {
      appAlert('Factura no encontrada', 'No se encontró una factura pendiente para confirmar.');
      return;
    }

    if (!evidence) {
      appAlert(
        'Comprobante requerido',
        'Por favor toma una fotografía o selecciona la imagen del comprobante de transferencia bancaria antes de confirmar.'
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
        'Comprobante Enviado',
        'Tu evidencia de pago fue enviada con éxito. El equipo de Zenda Manager validará la transferencia.'
      );
      setEvidence(null);
      await fetchStatus(true);
      if (onRefreshGlobal) onRefreshGlobal();
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo enviar el comprobante. Intenta de nuevo.');
    } finally {
      setConfirming(false);
    }
  };

  if (loading && !billingData) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={zendapp.colors.primary} />
        <Text style={styles.loadingText}>Cargando información de facturación...</Text>
      </View>
    );
  }

  const config = billingData?.config || {};
  const factura = billingData?.factura_actual;
  const status = billingData?.billing_status || 'al_dia';
  const badge = getStatusBadge(status, factura?.estado);
  const isConfirmado = factura?.estado === 'confirmado_cliente';
  const isPagado = factura?.estado === 'pagado';
  const totalPagar = factura ? Number(factura.total || 0) : 0;
  const numRutas = factura ? Number(factura.num_vendedores || 0) : 0;
  const precioUnitario = Number(config.precio_por_ruta || 40000);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* 1. Card de Factura Actual */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <View style={styles.iconCircle}>
              <Icon name="credit-card" size={15} color={zendapp.colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Facturación Mensual</Text>
              <Text style={styles.cardSubtitle}>
                {factura
                  ? `Periodo: ${factura.periodo_mes}/${factura.periodo_anio}`
                  : 'Suscripción por rutas'}
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
            <Text style={styles.breakdownLabel}>Rutas activas facturables:</Text>
            <Text style={styles.breakdownVal}>{numRutas} {numRutas === 1 ? 'vendedor' : 'vendedores'}</Text>
          </View>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Precio por ruta mensual:</Text>
            <Text style={styles.breakdownVal}>{FormatMoneyDecimales(precioUnitario, 'COP')}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL A PAGAR:</Text>
            <Text style={styles.totalVal}>{FormatMoneyDecimales(totalPagar, 'COP')}</Text>
          </View>

          <View style={styles.dateRow}>
            <Icon name="calendar" size={12} color="#667085" style={{ marginRight: 5 }} />
            <Text style={styles.dateText}>
              Fecha de corte y pago: <Text style={{ fontWeight: '700' }}>28 de cada mes</Text>
            </Text>
          </View>
        </View>

        {/* Nota informativa de la regla de nuevos vendedores */}
        <View style={styles.ruleNote}>
          <Icon name="info-circle" size={13} color="#475467" style={{ marginTop: 1, marginRight: 6 }} />
          <Text style={styles.ruleNoteText}>
            Las nuevas rutas creadas en el mes en curso no se cobran en este corte; comenzarán a facturarse a partir del día 28 del mes siguiente.
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
              <Text style={styles.cardTitle}>Datos para Transferencia</Text>
              <Text style={styles.cardSubtitle}>Cuenta bancaria en Colombia</Text>
            </View>
          </View>
        </View>

        <View style={styles.bankDetails}>
          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>Banco:</Text>
            <Text style={styles.bankVal}>{config.banco || 'Bancolombia'}</Text>
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>Tipo de cuenta:</Text>
            <Text style={styles.bankVal}>{config.tipo_cuenta || 'Ahorros'}</Text>
          </View>

          {/* Fila destacada con botón Copiar */}
          <View style={styles.accountHighlight}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountLabel}>NÚMERO DE CUENTA</Text>
              <Text style={styles.accountNumber}>{config.numero_cuenta || '123-456789-00'}</Text>
            </View>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => handleCopyAccount(config.numero_cuenta)}
              activeOpacity={0.7}
            >
              <Icon name="copy" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
              <Text style={styles.copyBtnText}>Copiar</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>Titular:</Text>
            <Text style={styles.bankVal}>{config.titular_cuenta || 'REACTIVA S.A.S'}</Text>
          </View>

          <View style={styles.bankRow}>
            <Text style={styles.bankLabel}>NIT:</Text>
            <Text style={styles.bankVal}>{config.nit_titular || '901.XXX.XXX-X'}</Text>
          </View>
        </View>
      </View>

      {/* 3. Acción de Confirmación de Pago */}
      {isPagado ? (
        <View style={[styles.card, styles.cardSuccess]}>
          <Icon name="check-circle" size={24} color="#16A34A" style={{ marginBottom: 6 }} />
          <Text style={styles.successTitle}>Suscripción al día</Text>
          <Text style={styles.successSub}>
            El pago de este periodo se encuentra validado y al día. ¡Gracias por usar Zendapp!
          </Text>
        </View>
      ) : isConfirmado ? (
        <View style={[styles.card, styles.cardPendingReview]}>
          <Icon name="hourglass-half" size={22} color="#D97706" style={{ marginBottom: 6 }} />
          <Text style={styles.reviewTitle}>Pago en proceso de validación</Text>
          <Text style={styles.reviewSub}>
            Ya reportaste la transferencia. Nuestro equipo en Zenda Manager está validando el soporte. Tu app continúa en funcionamiento normal.
          </Text>
          {factura?.comprobante_url ? (
            <TouchableOpacity
              style={styles.viewEvidenceBtn}
              onPress={() => setShowEvidenceViewer(true)}
              activeOpacity={0.8}
            >
              <Icon name="file-image-o" size={13} color="#B45309" style={{ marginRight: 6 }} />
              <Text style={styles.viewEvidenceBtnText}>Ver comprobante enviado</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.confirmTitle}>¿Ya realizaste la transferencia?</Text>
          <Text style={styles.confirmSub}>
            Adjunta la fotografía o captura del comprobante bancario para confirmar tu pago y mantener activa la plataforma.
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
                <Text style={styles.confirmBtnText}>Confirmar y Enviar Comprobante</Text>
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
          title="Comprobante Enviado"
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
