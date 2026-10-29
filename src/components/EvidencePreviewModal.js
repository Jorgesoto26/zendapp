// src/components/EvidencePreviewModal.js
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../theme/appleTheme';
import { getSignedEvidenceUrl } from '../services/multimediaService';

const { width, height } = Dimensions.get('window');

export default function EvidencePreviewModal({
  visible,
  onClose,
  title = 'Evidencia Multimedia',
  imageUri,
  filePath,
  readOnly = false,
  onTakePhoto,
  onPickGallery,
  onRemovePhoto,
}) {
  const [loading, setLoading] = useState(false);
  const [resolvedUri, setResolvedUri] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function resolve() {
      if (imageUri) {
        setResolvedUri(imageUri);
        return;
      }
      if (filePath) {
        setLoading(true);
        try {
          const signed = await getSignedEvidenceUrl(filePath);
          if (isMounted) setResolvedUri(signed);
        } catch (e) {
          console.log('Error resolving signed url in EvidencePreviewModal:', e);
        } finally {
          if (isMounted) setLoading(false);
        }
      } else {
        setResolvedUri(null);
      }
    }
    if (visible) {
      resolve();
    }
    return () => {
      isMounted = false;
    };
  }, [visible, imageUri, filePath]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="times" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Image Canvas */}
          <View style={styles.imageBox}>
            {loading ? (
              <ActivityIndicator size="large" color={apple.colors.blue} />
            ) : resolvedUri ? (
              <Image
                source={{ uri: resolvedUri }}
                style={styles.image}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.emptyBox}>
                <Icon name="picture-o" size={48} color={apple.colors.tertiaryLabel} />
                <Text style={styles.emptyText}>No hay imagen adjunta</Text>
              </View>
            )}
          </View>

          {/* Actions */}
          {!readOnly && (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={onTakePhoto}>
                <Icon name="camera" size={16} color="#FFFFFF" />
                <Text style={styles.actionText}>Cámara</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.galleryBtn]} onPress={onPickGallery}>
                <Icon name="image" size={16} color="#FFFFFF" />
                <Text style={styles.actionText}>Galería</Text>
              </TouchableOpacity>
              {resolvedUri && onRemovePhoto && (
                <TouchableOpacity style={[styles.actionBtn, styles.removeBtn]} onPress={onRemovePhoto}>
                  <Icon name="trash" size={16} color="#FFFFFF" />
                  <Text style={styles.actionText}>Quitar</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {readOnly && (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={onClose}>
                <Text style={styles.actionText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: width * 0.94,
    height: height * 0.82,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2C2C2E',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  imageBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121214',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  emptyBox: {
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    color: apple.colors.secondaryLabel,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    padding: 14,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#2C2C2E',
    backgroundColor: '#1C1C1E',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: apple.colors.blue,
    paddingVertical: 12,
    borderRadius: 12,
  },
  galleryBtn: {
    backgroundColor: '#30D158',
  },
  removeBtn: {
    backgroundColor: '#FF453A',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

