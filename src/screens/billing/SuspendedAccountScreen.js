// src/screens/billing/SuspendedAccountScreen.js
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../context/AuthContext';
import { confirmBillingPayment } from '../../services/billingService';
import { uploadEvidence } from '../../services/multimediaService';
import { FormatMoneyDecimales } from '../../utils/utilities';
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import BillingEvidencePicker from '../../components/BillingEvidencePicker';
import EvidencePreviewModal from '../../components/EvidencePreviewModal';

export default function SuspendedAccountScreen() {
  const { billingStatus, signOut, refreshBillingStatus, rol } = useAuth() || {};
  const [evidence, setEvidence] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showEvidenceViewer, setShowEvidenceViewer] = useState(false);

  const config = billingStatus?.config || {};
  const factura = billingStatus?.factura_actual;
  const total = factura ? Number(factura.total || 0) : 0;
  const numRutas = factura ? Number(factura.num_vendedores || 0) : 0;
  const isConfirmado = factura?.estado === 'confirmado_cliente';
  const isAdmin = rol === 'admin' || rol === 'superadmin';

  const handleCopyAccount = (acc) => {
    if (!acc) return;
    Clipboard.setString(acc);
    Toast.show({
      type: 'success',
      text1: 'Número de cuenta copiado',
      text2: 'Listo para pegar en tu app bancaria',
      position: 'bottom',
    });
  };

  const handleConfirmPayment = async () => {
    if (!factura?.id) {
      appAlert('Error', 'No hay una factura pendiente identificada.');
      return;
    }
    if (!evidence) {
      appAlert(
        'Comprobante requerido',
        'Por favor toma una fotografía o selecciona la imagen del comprobante de transferencia para reactivar tu cuenta.'
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
          originalName: evidence.fileName || `comprobante_suspension_${factura.id}.jpg`,
          mimeType: evidence.type || 'image/jpeg',
          originalSize: evidence.fileSize || 0,
          compressedSize: evidence.fileSize || 0,
        });
        comprobanteUrl = uploadRes?.filePath || evidence.uri;
      } catch (uploadErr) {
        console.log('Error subiendo evidencia de suspensión a Storage:', uploadErr);
        comprobanteUrl = evidence.uri;
      }

      await confirmBillingPayment(factura.id, 'Evidencia adjunta', comprobanteUrl);
      appAlert(
        'Pago Reportado',
        'Tu comprobante ha sido enviado a Zenda Manager. Tu cuenta será reactivada una vez validada la transferencia.'
      );
      setEvidence(null);
      if (refreshBillingStatus) await refreshBillingStatus();
    } catch (e) {
      appAlert('Error', e.message || 'No se pudo reportar el pago.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Cabecera de Alerta */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Icon name="lock" size={32} color="#DC2626" />
          </View>
          <Text style={styles.title}>Cuenta Suspendida</Text>
          <Text style={styles.subtitle}>
            El acceso a las funciones de Zendapp ha sido restringido por superar 18 días de mora en la suscripción mensual.
          </Text>
        </View>

        {/* Resumen de Deuda */}
        <View style={styles.debtCard}>
          <View style={styles.debtHeader}>
            <Text style={styles.debtLabel}>TOTAL PENDIENTE DE PAGO</Text>
            <Text style={styles.debtTotal}>{FormatMoneyDecimales(total, 'COP')}</Text>
          </View>
          <View style={styles.debtDetailRow}>
            <Text style={styles.debtDetailLabel}>Rutas facturadas:</Text>
            <Text style={styles.debtDetailVal}>{numRutas} vendedores activos</Text>
          </View>
          <View style={styles.debtDetailRow}>
            <Text style={styles.debtDetailLabel}>Fecha límite vencida:</Text>
            <Text style={styles.debtDetailVal}>28 de cada mes</Text>
          </View>
        </View>

        {/* Datos Bancarios */}
        <View style={styles.bankCard}>
          <Text style={styles.bankTitle}>Datos para Transferencia Inmediata</Text>
          <Text style={styles.bankSub}>Realiza el pago a la siguiente cuenta oficial:</Text>

          <View style={styles.accountBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bankName}>{config.banco || 'Bancolombia'} · {config.tipo_cuenta || 'Ahorros'}</Text>
              <Text style={styles.accountNum}>{config.numero_cuenta || '123-456789-00'}</Text>
              <Text style={styles.titularText}>{config.titular_cuenta || 'REACTIVA S.A.S'} ({config.nit_titular || 'NIT'})</Text>
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
        </View>

        {/* Acciones de Pago */}
        {isConfirmado ? (
          <View style={styles.pendingCard}>
            <Icon name="hourglass-half" size={24} color="#D97706" style={{ marginBottom: 6 }} />
            <Text style={styles.pendingTitle}>Pago en proceso de validación</Text>
            <Text style={styles.pendingSub}>
              Ya enviaste tu reporte de pago. El equipo de Zenda Manager validará la transferencia para restaurar el acceso.
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
        ) : isAdmin ? (
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>¿Ya realizaste la transferencia?</Text>
            <Text style={styles.actionSub}>
              Toma una fotografía o selecciona la captura del comprobante bancario para reactivar tu cuenta.
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
                  <Text style={styles.confirmBtnText}>Notificar pago para reactivación</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.vendorNoticeCard}>
            <Icon name="info-circle" size={18} color="#475467" style={{ marginBottom: 4 }} />
            <Text style={styles.vendorNoticeTitle}>Aviso para vendedores</Text>
            <Text style={styles.vendorNoticeSub}>
              Comunícate con el administrador de tu organización para que realice el pago y reactive el acceso a la plataforma.
            </Text>
          </View>
        )}

        {/* Botón de Cerrar Sesión */}
        <TouchableOpacity style={styles.logoutBtn} onPress={signOut} activeOpacity={0.7}>
          <Icon name="sign-out" size={14} color="#667085" style={{ marginRight: 6 }} />
          <Text style={styles.logoutBtnText}>Cerrar Sesión</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal para ver comprobante reportado */}
      {factura?.comprobante_url && (
        <EvidencePreviewModal
          visible={showEvidenceViewer}
          onClose={() => setShowEvidenceViewer(false)}
          title="Comprobante Enviado"
          filePath={factura.comprobante_url}
          readOnly={true}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  container: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginVertical: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#FECACA',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E1E1F',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#667085',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  debtCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  debtHeader: {
    marginBottom: 10,
  },
  debtLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  debtTotal: {
    fontSize: 26,
    fontWeight: '900',
    color: '#991B1B',
    marginTop: 2,
  },
  debtDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  debtDetailLabel: {
    fontSize: 12,
    color: '#667085',
  },
  debtDetailVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1D2939',
  },
  bankCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  bankTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D2939',
  },
  bankSub: {
    fontSize: 12,
    color: '#667085',
    marginBottom: 10,
  },
  accountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 12,
  },
  bankName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  accountNum: {
    fontSize: 18,
    fontWeight: '800',
    color: '#14532D',
    letterSpacing: 0.5,
    marginVertical: 2,
  },
  titularText: {
    fontSize: 11,
    color: '#15803D',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16A34A',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D2939',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 13,
    color: '#1D2939',
    marginBottom: 10,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: zendapp.colors.primary,
    borderRadius: 10,
    height: 44,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pendingCard: {
    width: '100%',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    marginBottom: 14,
  },
  pendingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  pendingSub: {
    fontSize: 12,
    color: '#78350F',
    textAlign: 'center',
    lineHeight: 17,
  },
  actionSub: {
    fontSize: 12,
    color: '#667085',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 8,
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
  vendorNoticeCard: {
    width: '100%',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    marginBottom: 14,
  },
  vendorNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  vendorNoticeSub: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  logoutBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#667085',
  },
});
