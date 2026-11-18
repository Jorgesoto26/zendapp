// src/components/BillingAlertBanner.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { FormatMoneyDecimales } from '../utils/utilities';

export default function BillingAlertBanner({ style, onPress }) {
  const navigation = useNavigation();
  const { billingStatus, rol } = useAuth() || {};

  if (!billingStatus) return null;

  const status = billingStatus.billing_status;
  if (!status || status === 'al_dia') return null;

  const diasPago = billingStatus.dias_para_pago ?? 0;
  const diasBloqueo = billingStatus.dias_para_bloqueo ?? 0;
  const total = billingStatus.factura_actual?.total || 0;
  const isAdmin = rol === 'admin' || rol === 'superadmin';

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (isAdmin) {
      try {
        navigation.navigate('AdminReportes');
      } catch {}
    }
  };

  let bannerConfig = null;

  if (status === 'alerta_previa') {
    bannerConfig = {
      bg: '#FFFBEB',
      border: '#F59E0B',
      textColor: '#92400E',
      icon: 'exclamation-triangle',
      iconColor: '#D97706',
      title: 'Próximo vencimiento de suscripción',
      message: isAdmin
        ? `Quedan ${Math.max(1, diasPago)} día${diasPago === 1 ? '' : 's'} para el corte del 28 (${FormatMoneyDecimales(total, 'COP')}). Toca aquí para ver los datos de pago.`
        : `Recordatorio: La suscripción de la organización vence en ${Math.max(1, diasPago)} día${diasPago === 1 ? '' : 's'}.`,
    };
  } else if (status === 'gracia_lectura') {
    bannerConfig = {
      bg: '#FEF2F2',
      border: '#EE272D',
      textColor: '#B91C1C',
      icon: 'clock-o',
      iconColor: '#EE272D',
      title: 'Pago vencido — Modo solo lectura',
      message: isAdmin
        ? `El pago de suscripción está vencido. La app se encuentra en modo solo lectura. Quedan ${diasBloqueo} días antes de suspensión total. Toca para reportar el pago.`
        : `Atención: La suscripción se encuentra vencida. Operaciones de registro deshabilitadas temporalmente.`,
    };
  } else if (status === 'mora_critica') {
    bannerConfig = {
      bg: '#FEE2E2',
      border: '#DC2626',
      textColor: '#7F1D1D',
      icon: 'exclamation-circle',
      iconColor: '#DC2626',
      title: '🚨 Suspensión inminente',
      message: isAdmin
        ? `¡Atención! Quedan solo ${diasBloqueo} día${diasBloqueo === 1 ? '' : 's'} antes del bloqueo total de la aplicación. Realiza la transferencia ahora.`
        : `Alerta: La cuenta de la organización está próxima a ser suspendida por falta de pago.`,
    };
  } else if (status === 'en_revision') {
    bannerConfig = {
      bg: '#FEF3C7',
      border: '#FDE68A',
      textColor: '#92400E',
      icon: 'hourglass-half',
      iconColor: '#D97706',
      title: 'Pago en verificación',
      message: 'Tu reporte de transferencia está siendo validado por Zenda Manager. Tu servicio continúa activo.',
    };
  }

  if (!bannerConfig) return null;

  return (
    <TouchableOpacity
      activeOpacity={isAdmin ? 0.8 : 1}
      onPress={handlePress}
      style={[
        styles.banner,
        { backgroundColor: bannerConfig.bg, borderColor: bannerConfig.border },
        style,
      ]}
      disabled={!isAdmin}
    >
      <View style={styles.iconWrap}>
        <Icon name={bannerConfig.icon} size={14} color={bannerConfig.iconColor} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: bannerConfig.textColor }]}>
          {bannerConfig.title}
        </Text>
        <Text style={[styles.message, { color: bannerConfig.textColor }]}>
          {bannerConfig.message}
        </Text>
      </View>
      {isAdmin && status !== 'en_revision' && (
        <Icon name="chevron-right" size={11} color={bannerConfig.iconColor} style={styles.chevron} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  iconWrap: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  message: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  chevron: {
    marginLeft: 8,
  },
});
