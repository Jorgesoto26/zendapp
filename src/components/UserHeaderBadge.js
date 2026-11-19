import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useAuth } from '../context/AuthContext';
import { zendapp } from '../theme/zendappTheme';
import UserProfileModal from './UserProfileModal';

/**
 * Componente uniforme para mostrar el usuario autenticado (nombre y rol) en toda la aplicación.
 * 
 * Variantes:
 * - 'inline': Fila compacta con icono y texto (ideal para subtítulo de header).
 * - 'pill': Badge tipo cápsula con fondo suave, borde e icono destacado (ideal para barras superiores).
 */
export const getUserDisplayName = (profile) => {
  if (!profile) return 'Usuario';
  const nombre = (profile.nombre || '').trim();
  const apellidos = (profile.apellidos || profile.apellido || '').trim();
  if (nombre && apellidos) return `${nombre} ${apellidos}`;
  if (nombre) return nombre;
  if (apellidos) return apellidos;
  return 'Usuario';
};

export const getUserRoleLabel = (rol) => {
  const r = String(rol || 'vendedor').toLowerCase().trim();
  if (r === 'admin') return 'Administrador';
  if (r === 'superadmin') return 'Superadmin';
  if (r === 'cliente') return 'Cliente';
  return 'Vendedor';
};

export default function UserHeaderBadge({ variant = 'inline', style, textStyle, showIcon = true }) {
  const { profile } = useAuth() || {};
  const [modalVisible, setModalVisible] = useState(false);
  const displayName = getUserDisplayName(profile);
  const roleLabel = getUserRoleLabel(profile?.rol);

  const badgeContent = variant === 'pill' ? (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => setModalVisible(true)}
      style={[styles.pillContainer, style]}
    >
      {showIcon && (
        <View style={styles.pillIconWrap}>
          <Icon name="user" size={10} color="#FFFFFF" />
        </View>
      )}
      <Text style={[styles.pillName, textStyle]} numberOfLines={1} ellipsizeMode="tail">
        {displayName}
      </Text>
      <View style={styles.pillDivider} />
      <Text style={styles.pillRole}>
        {roleLabel}
      </Text>
      <Icon name="angle-down" size={12} color={zendapp.colors.primary} style={{ marginLeft: 2 }} />
    </TouchableOpacity>
  ) : (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => setModalVisible(true)}
      style={[styles.inlineContainer, style]}
    >
      {showIcon && (
        <Icon name="user-circle" size={12} color={zendapp.colors.primary} style={styles.inlineIcon} />
      )}
      <Text style={[styles.inlineText, textStyle]} numberOfLines={1} ellipsizeMode="tail">
        <Text style={styles.inlineName}>{displayName}</Text>
        <Text style={styles.inlineRole}> · {roleLabel}</Text>
      </Text>
      <Icon name="angle-down" size={11} color="#98A2B3" style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );

  return (
    <>
      {badgeContent}
      <UserProfileModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineIcon: {
    marginRight: 5,
  },
  inlineText: {
    fontSize: 12,
    color: '#475467',
    fontWeight: '500',
  },
  inlineName: {
    fontWeight: '700',
    color: '#1D2939',
  },
  inlineRole: {
    color: '#667085',
    fontWeight: '500',
  },
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(254, 242, 242, 0.90)',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    gap: 5,
  },
  pillIconWrap: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D2939',
    maxWidth: 130,
  },
  pillDivider: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#98A2B3',
  },
  pillRole: {
    fontSize: 10,
    fontWeight: '600',
    color: zendapp.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
