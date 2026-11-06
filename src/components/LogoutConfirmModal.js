// src/components/LogoutConfirmModal.js
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../theme/appleTheme';

export default function LogoutConfirmModal({
  visible,
  onClose,
  onConfirm,
  title = '¿Cerrar sesión?',
  subtitle = 'Saldrás de tu cuenta y volverás al inicio de sesión.',
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (onConfirm) {
        await onConfirm();
      }
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      backdropOpacity={0.4}
      animationIn="slideInUp"
      animationOut="slideOutDown"
      useNativeDriver
      hideModalContentWhileAnimating
    >
      <View style={styles.logoutSheet}>
        <View style={styles.logoutHandle} />
        <View style={styles.logoutIcon}>
          <Icon name="sign-out" size={22} color="#EE272D" />
        </View>
        <Text style={styles.logoutTitle}>{title}</Text>
        <Text style={styles.logoutSub}>{subtitle}</Text>
        <View style={styles.logoutActions}>
          <TouchableOpacity
            style={styles.logoutCancel}
            onPress={onClose}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.logoutCancelText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.logoutConfirm}
            onPress={handleConfirm}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.logoutConfirmText}>Cerrar sesión</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  logoutSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 20,
    paddingBottom: 24,
  },
  logoutHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D0D5DD',
    alignSelf: 'center',
    marginBottom: 16,
  },
  logoutIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E1E1F',
    textAlign: 'center',
  },
  logoutSub: {
    fontSize: 13,
    color: '#667085',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 12,
  },
  logoutActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  logoutCancel: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F1F3F7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  logoutCancelText: {
    fontWeight: '700',
    color: '#1E1E1F',
  },
  logoutConfirm: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#EE272D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutConfirmText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
