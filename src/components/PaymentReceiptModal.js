// src/components/PaymentReceiptModal.js
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Share as RNShare,
  Platform,
  Image,
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../theme/appleTheme';
import { FormatMoneyDecimales } from '../utils/utilities';


let RNShareModule = null;
try {
  RNShareModule = require('react-native-share').default || require('react-native-share');
} catch (e) {
  console.log('react-native-share not available, will use RN native Share fallback:', e.message);
}

export default function PaymentReceiptModal({
  visible,
  onClose,
  receiptData, // { id, idFactura, clienteNombre, clienteDoc, fecha, valor, saldoRestante, vendedorNombre, orgNombre, orgNit, orgLogo, metodo, isPendingSync }
}) {
  const viewShotRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  if (!visible || !receiptData) return null;

  const {
    id,
    idFactura,
    clienteNombre = 'Cliente',
    clienteDoc = '',
    fecha = new Date().toISOString(),
    valor = 0,
    saldoRestante = null,
    vendedorNombre = 'Vendedor',
    orgNombre = 'ZENDA',
    orgNit = '',
    orgLogo = null,
    metodo = 'Efectivo',
    isPendingSync = false,
  } = receiptData;

  const formattedDate = new Date(fecha).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleShare = async () => {
    setSharing(true);
    try {
      let captureUri = null;
      if (viewShotRef.current && typeof viewShotRef.current.capture === 'function') {
        try {
          captureUri = await viewShotRef.current.capture();
        } catch (capErr) {
          console.log('ViewShot capture error, will fallback to text share:', capErr);
        }
      }

      const receiptMessage = `
🧾 COMPROBANTE DE PAGO
=================================
Empresa: ${orgNombre} ${orgNit ? 'NIT: ' + orgNit : ''}
Comprobante N°: ${String(id).slice(-8).toUpperCase()}
Fecha: ${formattedDate}
---------------------------------
Cliente: ${clienteNombre} ${clienteDoc ? '(' + clienteDoc + ')' : ''}
Valor Recibido: ${FormatMoneyDecimales(valor)}
${saldoRestante !== null ? 'Saldo Restante: ' + FormatMoneyDecimales(saldoRestante) : ''}
Método: ${metodo}
Atendido por: ${vendedorNombre}
Operación: ${id}
${isPendingSync ? '⚠️ Pago registrado offline (pendiente de sincronizar)' : '✅ Pago confirmado'}
=================================
Gracias por su pago.
`.trim();

      if (captureUri && RNShareModule && typeof RNShareModule.open === 'function') {
        try {
          await RNShareModule.open({
            title: `Comprobante de Pago - ${clienteNombre}`,
            message: receiptMessage,
            url: captureUri.startsWith('file://') ? captureUri : `file://${captureUri}`,
            type: 'image/jpeg',
          });
        } catch (shareErr) {
          if (shareErr?.message !== 'User did not share') {
            await RNShare.share({
              title: `Comprobante ${clienteNombre}`,
              message: receiptMessage,
            });
          }
        }
      } else {
        await RNShare.share({
          title: `Comprobante ${clienteNombre}`,
          message: receiptMessage,
        });
      }

    } catch (err) {
      console.log('handleShare error:', err);
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Comprobante de Pago</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="times" size={16} color={apple.colors.secondaryLabel} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* ViewShot Container to capture visual receipt */}
            <ViewShot
              ref={viewShotRef}
              options={{ format: 'jpg', quality: 0.9, result: 'tmpfile' }}
              style={styles.receiptCard}
            >
              {/* Receipt Header */}
              <View style={styles.receiptTop}>
                {orgLogo ? (
                  <Image source={{ uri: orgLogo }} style={styles.orgLogo} resizeMode="contain" />
                ) : (
                  <View style={styles.logoBadge}>
                    <Icon name="check-circle" size={32} color={apple.colors.success} />
                  </View>
                )}
                <Text style={styles.receiptOrgName}>{orgNombre}</Text>
                {orgNit ? <Text style={styles.receiptOrgNit}>NIT: {orgNit}</Text> : null}
                <View style={[styles.statusBadge, isPendingSync ? styles.badgePending : styles.badgeConfirmed]}>
                  <Text style={[styles.statusBadgeText, isPendingSync ? styles.textPending : styles.textConfirmed]}>
                    {isPendingSync ? 'PENDIENTE DE SINCRONIZAR' : 'PAGO CONFIRMADO'}
                  </Text>
                </View>
              </View>

              {/* Receipt Body */}
              <View style={styles.divider} />

              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>VALOR RECIBIDO</Text>
                <Text style={styles.amountValue}>{FormatMoneyDecimales(valor)}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>N° Comprobante:</Text>
                <Text style={styles.detailVal}>#{String(id).slice(-8).toUpperCase()}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Fecha y Hora:</Text>
                <Text style={styles.detailVal}>{formattedDate}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Cliente:</Text>
                <Text style={[styles.detailVal, { fontWeight: '700' }]} numberOfLines={1}>
                  {clienteNombre}
                </Text>
              </View>

              {clienteDoc ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Documento:</Text>
                  <Text style={styles.detailVal}>{clienteDoc}</Text>
                </View>
              ) : null}

              {idFactura ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Factura Ref:</Text>
                  <Text style={styles.detailVal}>#{String(idFactura).slice(0, 8)}</Text>
                </View>
              ) : null}

              {saldoRestante !== null ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Saldo Restante:</Text>
                  <Text style={[styles.detailVal, { color: apple.colors.blue, fontWeight: '700' }]}>
                    {FormatMoneyDecimales(saldoRestante)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Método de Pago:</Text>
                <Text style={styles.detailVal}>{metodo}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Vendedor:</Text>
                <Text style={styles.detailVal}>{vendedorNombre}</Text>
              </View>

              <View style={styles.footerNote}>
                <Text style={styles.footerNoteText}>
                  Este documento certifica el recibo del dinero indicado por parte de la empresa. Conserve este comprobante para su control.
                </Text>
              </View>
            </ViewShot>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.closeBtnAction} onPress={onClose}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={sharing}>
              {sharing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Icon name="share-alt" size={16} color="#FFFFFF" />
                  <Text style={styles.shareBtnText}>Compartir</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '92%',
    maxHeight: '90%',
    backgroundColor: '#F8F9FA',
    borderRadius: 24,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: apple.colors.label,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 14,
    backgroundColor: apple.colors.fill,
  },
  scrollContent: {
    padding: 16,
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  receiptTop: {
    alignItems: 'center',
    marginBottom: 8,
  },
  logoBadge: {
    marginBottom: 6,
  },
  orgLogo: {
    width: 64,
    height: 64,
    borderRadius: 12,
    marginBottom: 8,
  },
  receiptOrgName: {
    fontSize: 20,
    fontWeight: '800',
    color: apple.colors.label,
    letterSpacing: 0.5,
  },
  receiptOrgNit: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  statusBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeConfirmed: {
    backgroundColor: '#E8F5E9',
  },
  badgePending: {
    backgroundColor: '#FFF3E0',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textConfirmed: {
    color: apple.colors.success,
  },
  textPending: {
    color: '#E65100',
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 14,
  },
  amountBox: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: apple.colors.tertiaryLabel,
    letterSpacing: 0.8,
  },
  amountValue: {
    fontSize: 28,
    fontWeight: '800',
    color: apple.colors.success,
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  detailLabel: {
    fontSize: 13,
    color: apple.colors.secondaryLabel,
  },
  detailVal: {
    fontSize: 13,
    color: apple.colors.label,
    fontWeight: '500',
    maxWidth: '65%',
    textAlign: 'right',
  },
  footerNote: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  footerNoteText: {
    fontSize: 10,
    color: apple.colors.tertiaryLabel,
    textAlign: 'center',
    lineHeight: 14,
  },
  actions: {
    flexDirection: 'row',
    padding: 14,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0.5,
    borderTopColor: apple.colors.separator,
  },
  closeBtnAction: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: apple.colors.fill,
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: apple.colors.label,
  },
  shareBtn: {
    flex: 1.4,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: apple.colors.blue,
    gap: 8,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

