// src/components/UserProfileModal.js
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import Toast from 'react-native-toast-message';
import { useAuth } from '../context/AuthContext';
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n';
import { getUserDisplayName, getUserRoleLabel } from './UserHeaderBadge';
import { zendapp } from '../theme/zendappTheme';

export default function UserProfileModal({ visible, onClose }) {
  const { profile, signOut } = useAuth() || {};
  const { t, language, changeLanguage } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);

  const displayName = getUserDisplayName(profile);
  const roleLabel = getUserRoleLabel(profile?.rol);
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'U';

  const handleSelectLanguage = async (code) => {
    if (code === language) return;
    await changeLanguage(code);
    Toast.show({
      type: 'success',
      text1: t('profile.language_changed'),
      position: 'bottom',
      visibilityTime: 2000,
    });
  };

  const handleSignOutPress = () => {
    Alert.alert(
      t('profile.sign_out_title'),
      t('profile.sign_out_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.logout'),
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              if (onClose) onClose();
              if (signOut) await signOut();
            } catch (err) {
              console.log('Error signing out:', err);
            } finally {
              setSigningOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      backdropOpacity={0.45}
      animationIn="slideInUp"
      animationOut="slideOutDown"
      useNativeDriver
      hideModalContentWhileAnimating
      style={styles.modal}
    >
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {/* Cabecera */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('profile.my_profile')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="times" size={16} color="#667085" />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          {/* Tarjeta del Usuario */}
          <View style={styles.userCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{roleLabel}</Text>
              </View>
              {profile?.email ? (
                <Text style={styles.userMeta} numberOfLines={1}>
                  <Icon name="envelope-o" size={11} color="#98A2B3" /> {profile.email}
                </Text>
              ) : null}
              {profile?.celular || profile?.telefono ? (
                <Text style={styles.userMeta} numberOfLines={1}>
                  <Icon name="phone" size={11} color="#98A2B3" /> {profile.celular || profile.telefono}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Sección de Idiomas */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="globe" size={14} color={zendapp.colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.sectionTitle}>{t('languages.title')}</Text>
            </View>

            <View style={styles.languagesList}>
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isSelected = language === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.langItem, isSelected && styles.langItemActive]}
                    onPress={() => handleSelectLanguage(lang.code)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.flagText}>{lang.flag}</Text>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.langLabel, isSelected && styles.langLabelActive]}>
                        {lang.label}
                      </Text>
                      <Text style={styles.langDesc}>{lang.description}</Text>
                    </View>
                    {isSelected ? (
                      <View style={styles.checkedCircle}>
                        <Icon name="check" size={11} color="#FFFFFF" />
                      </View>
                    ) : (
                      <View style={styles.uncheckedCircle} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Botón de Cerrar Sesión */}
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOutPress}
            disabled={signingOut}
            activeOpacity={0.8}
          >
            <Icon name="sign-out" size={15} color="#DC2626" style={{ marginRight: 8 }} />
            <Text style={styles.signOutText}>{t('profile.sign_out')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#EAECF0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F7',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#101828',
    letterSpacing: -0.3,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  userInfo: {
    flex: 1,
    marginLeft: 14,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D2939',
    marginBottom: 3,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  userMeta: {
    fontSize: 11,
    color: '#667085',
    marginTop: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#344054',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  languagesList: {
    gap: 8,
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EAECF0',
  },
  langItemActive: {
    borderColor: zendapp.colors.primary,
    backgroundColor: '#FEF2F2',
  },
  flagText: {
    fontSize: 24,
  },
  langLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
  },
  langLabelActive: {
    fontWeight: '800',
    color: zendapp.colors.primary,
  },
  langDesc: {
    fontSize: 11,
    color: '#667085',
    marginTop: 1,
  },
  checkedCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uncheckedCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
});
