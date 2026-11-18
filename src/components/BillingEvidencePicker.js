// src/components/BillingEvidencePicker.js
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { pickImage } from '../services/multimediaService';
import { appAlert } from './AppAlert';
import EvidencePreviewModal from './EvidencePreviewModal';
import { zendapp } from '../theme/zendappTheme';

export default function BillingEvidencePicker({
  evidence,
  onSelectEvidence,
  onRemoveEvidence,
  disabled = false,
  style,
}) {
  const [picking, setPicking] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  const handlePick = async (sourceType) => {
    if (disabled || picking) return;
    try {
      setPicking(true);
      const res = await pickImage(sourceType, 'DOCUMENT');
      if (res && !res.cancelled && res.localUri) {
        onSelectEvidence({
          uri: res.localUri,
          base64: res.base64,
          fileName: res.fileName || `comprobante_${Date.now()}.jpg`,
          fileSize: res.fileSize || 0,
          type: res.type || 'image/jpeg',
        });
      }
    } catch (err) {
      console.log('Error seleccionando evidencia de pago:', err);
      appAlert('Error', err.message || 'No se pudo cargar la imagen seleccionada.');
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={[styles.container, style]}>
      {picking ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={zendapp.colors.primary} />
          <Text style={styles.loadingText}>Procesando imagen...</Text>
        </View>
      ) : evidence ? (
        <View style={styles.evidenceCard}>
          <TouchableOpacity
            style={styles.thumbWrapper}
            onPress={() => setPreviewVisible(true)}
            activeOpacity={0.85}
          >
            <Image source={{ uri: evidence.uri }} style={styles.thumb} resizeMode="cover" />
            <View style={styles.expandPill}>
              <Icon name="search-plus" size={10} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <View style={styles.infoWrapper}>
            <View style={styles.tagSuccess}>
              <Icon name="check-circle" size={11} color="#059669" style={{ marginRight: 4 }} />
              <Text style={styles.tagSuccessText}>Comprobante cargado</Text>
            </View>
            <Text style={styles.fileName} numberOfLines={1}>
              {evidence.fileName || 'comprobante_bancario.jpg'}
            </Text>
            {evidence.fileSize > 0 && (
              <Text style={styles.fileSize}>
                {(evidence.fileSize / 1024).toFixed(0)} KB
              </Text>
            )}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={() => handlePick('gallery')}
                disabled={disabled}
              >
                <Icon name="refresh" size={11} color={zendapp.colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.changeBtnText}>Cambiar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={onRemoveEvidence}
                disabled={disabled}
              >
                <Icon name="trash-o" size={12} color="#DC2626" style={{ marginRight: 4 }} />
                <Text style={styles.deleteBtnText}>Quitar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.pickerBox}>
          <View style={styles.pickerIconCircle}>
            <Icon name="camera" size={20} color={zendapp.colors.primary} />
          </View>
          <Text style={styles.pickerTitle}>Comprobante de Transferencia</Text>
          <Text style={styles.pickerSub}>
            Toma una fotografía o selecciona la captura de tu app bancaria
          </Text>

          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.cameraBtn]}
              onPress={() => handlePick('camera')}
              disabled={disabled}
              activeOpacity={0.8}
            >
              <Icon name="camera" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.cameraBtnText}>Tomar Foto</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.galleryBtn]}
              onPress={() => handlePick('gallery')}
              disabled={disabled}
              activeOpacity={0.8}
            >
              <Icon name="image" size={13} color={zendapp.colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.galleryBtnText}>Galería</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Modal para ver imagen ampliada */}
      {evidence?.uri && (
        <EvidencePreviewModal
          visible={previewVisible}
          onClose={() => setPreviewVisible(false)}
          title="Comprobante de Transferencia"
          imageUri={evidence.uri}
          readOnly={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  loadingBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  pickerBox: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  pickerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EE272D12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 3,
  },
  pickerSub: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 12,
    lineHeight: 16,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtn: {
    backgroundColor: zendapp.colors.primary,
  },
  cameraBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  galleryBtn: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  galleryBtnText: {
    color: zendapp.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  evidenceCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  thumbWrapper: {
    position: 'relative',
    width: 76,
    height: 76,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  expandPill: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  infoWrapper: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  tagSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  tagSuccessText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  fileName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  fileSize: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: zendapp.colors.primary,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#DC2626',
  },
});
