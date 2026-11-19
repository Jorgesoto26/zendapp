// src/components/BillingAlertBanner.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { FormatMoneyDecimales } from '../utils/utilities';
import { useTranslation } from '../i18n';

export default function BillingAlertBanner({ style, onPress }) {
  const navigation = useNavigation();
  const { billingStatus, rol } = useAuth() || {};
  const { t } = useTranslation();

  if (!billingStatus) return null;

  const status = billingStatus.billing_status;
  if (!status || status === 'al_dia') return null;

  const diasPago = billingStatus.dias_para_pago ?? 0;
  const diasBloqueo = billingStatus.dias_para_bloqueo ?? 0;
  const total = billingStatus.factura_actual?.total ?? billingStatus.total_estimado ?? 0;
  const diaCorte = billingStatus.config?.dia_facturacion || 28;
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
      title: t('billing.banner_upcoming_title'),
      message: isAdmin
        ? t('billing.banner_upcoming_msg_admin', {
            days: Math.max(1, diasPago),
            day: diaCorte,
            amount: FormatMoneyDecimales(total, 'COP'),
          })
        : t('billing.banner_upcoming_msg_vendor', {
            days: Math.max(1, diasPago),
          }),
    };
  } else if (status === 'gracia_lectura') {
    bannerConfig = {
      bg: '#FEF2F2',
      border: '#EE272D',
      textColor: '#B91C1C',
      icon: 'clock-o',
      iconColor: '#EE272D',
      title: t('billing.banner_overdue_title'),
      message: isAdmin
        ? t('billing.banner_grace_msg_admin', { days: diasBloqueo })
        : t('billing.banner_grace_msg_vendor'),
    };
  } else if (status === 'mora_critica') {
    bannerConfig = {
      bg: '#FEE2E2',
      border: '#DC2626',
      textColor: '#7F1D1D',
      icon: 'exclamation-circle',
      iconColor: '#DC2626',
      title: t('billing.banner_critical_title'),
      message: isAdmin
        ? t('billing.banner_critical_msg_admin', { days: diasBloqueo })
        : t('billing.banner_critical_msg_vendor'),
    };
  } else if (status === 'en_revision') {
    bannerConfig = {
      bg: '#FEF3C7',
      border: '#FDE68A',
      textColor: '#92400E',
      icon: 'hourglass-half',
      iconColor: '#D97706',
      title: t('billing.banner_verification_title'),
      message: t('billing.banner_verification_msg'),
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
