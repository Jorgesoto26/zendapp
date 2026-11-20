// src/components/PinLockScreen.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  Platform,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Image,
  Pressable,
  PanResponder,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../theme/zendappTheme';
import { getAppVersion } from '../utils/utilities';
import { appAlert } from './AppAlert';
import {
  verifyPin,
  savePin,
  hasConfiguredPin,
  getInactivityTimeout,
  setInactivityTimeout,
} from '../services/pinService';
import CamouflageCalculator from './CamouflageCalculator';
import { useAuth } from '../context/AuthContext';
import { AuthService } from '../services/services';
import { getDbConnection, getData } from '../database/db';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureAuthenticatedSession } from '../lib/supabase';

const TIMEOUT_OPTIONS = [
  { label: 'Inmediato', value: 0 },
  { label: '1 min', value: 1 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
];

export default function PinLockScreen() {
  const { session, profile, setAuthSession, signOut, unlockApp } = useAuth();
  const [pin, setPin] = useState('');
  const [showCalculator, setShowCalculator] = useState(false);
  const [secretModalVisible, setSecretModalVisible] = useState(false);

  // Estados modal secreto
  const [secretEmail, setSecretEmail] = useState('');
  const [secretPassword, setSecretPassword] = useState('');
  const [showSecretPassword, setShowSecretPassword] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [selectedTimeout, setSelectedTimeout] = useState(5);
  const [savingSecret, setSavingSecret] = useState(false);

  // Animaciones
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  const resetPanY = useCallback(() => {
    Animated.spring(panY, {
      toValue: 0,
      tension: 60,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [panY]);

  const dismissModal = useCallback(() => {
    Animated.timing(panY, {
      toValue: 600,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setSecretModalVisible(false);
      panY.setValue(0);
    });
  }, [panY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 5;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          dismissModal();
        } else {
          resetPanY();
        }
      },
    })
  ).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();

    (async () => {
      const t = await getInactivityTimeout();
      setSelectedTimeout(t);
    })();
  }, []);

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Manejo de pulsación numérica
  const handlePressDigit = useCallback(async (digit) => {
    if (pin.length >= 5) return;
    const nextPin = pin + digit;
    setPin(nextPin);

    // Cuando se ingresan los 5 dígitos
    if (nextPin.length === 5) {
      const isValid = await verifyPin(nextPin);
      if (isValid) {
        // Si ya hay sesión activa en contexto
        if (session) {
          unlockApp();
          return;
        }

        // Si la sesión no estaba activa en memoria, intentar restaurarla
        const sess = await ensureAuthenticatedSession();
        if (sess) {
          setAuthSession(sess);
          unlockApp();
          return;
        }

        // Si estamos sin conexión o falló sesión remota, restaurar perfil offline
        try {
          const db = await getDbConnection();
          const params = await getData(db, `SELECT id, valor FROM parametrizacion WHERE id IN (3, 5, 7)`);
          const pMap = {};
          params?.forEach(p => { pMap[p.id] = p.valor; });
          if (pMap[3]) {
            const pStr = await AsyncStorage.getItem('cached_profile');
            const cachedProf = pStr ? JSON.parse(pStr) : null;
            const offlineUser = { id: pMap[5] || cachedProf?.id || 'offline_user', email: pMap[3] };
            setAuthSession({ user: offlineUser }, cachedProf);
            unlockApp();
            return;
          }
        } catch (eOffline) {
          console.log('Error restaurando offline en PinLockScreen:', eOffline);
        }

        // Si no hay datos de usuario vinculados en absoluto, abrir modal secreto
        setSecretModalVisible(true);
      } else {
        // PIN INCORRECTO: Sacudir y activar MODO CALCULADORA (Camuflaje / Despiste)
        triggerShake();
        setTimeout(() => {
          setPin('');
          setShowCalculator(true);
        }, 300);
      }
    }
  }, [pin, session, unlockApp, setAuthSession, triggerShake]);

  const handleBackspace = useCallback(() => {
    setPin((prev) => (prev.length > 0 ? prev.slice(0, -1) : ''));
  }, []);

  const handleClear = useCallback(() => {
    setPin('');
  }, []);

  // Apertura del modal secreto (toque sostenido de 2 segundos en la versión)
  const handleSecretLongPress = useCallback(() => {
    panY.setValue(0);
    if (session?.user?.email) {
      setSecretEmail(session.user.email);
    }
    setSecretModalVisible(true);
  }, [session, panY]);

  // Guardado de configuración en el modal secreto
  const handleSaveSecretConfig = async () => {
    setSavingSecret(true);
    try {
      let authUser = session?.user;

      // 1. Si se ingresó correo y contraseña, autenticar con AuthService
      if (secretEmail.trim() && secretPassword.trim()) {
        const db = await getDbConnection();
        const res = await AuthService(db, secretEmail.trim(), secretPassword.trim());
        if (!res.success) {
          appAlert('Error de autenticación', res.message || 'Credenciales inválidas');
          setSavingSecret(false);
          return;
        }
        if (res.session) {
          authUser = res.session.user;
          setAuthSession(res.session, res.profile);
        }
      }

      // 2. Si se ingresó nuevo PIN, validar y guardar
      if (newPin.trim()) {
        if (newPin.trim().length !== 5 || isNaN(Number(newPin.trim()))) {
          appAlert('PIN inválido', 'El PIN de seguridad debe contener exactamente 5 dígitos numéricos.');
          setSavingSecret(false);
          return;
        }
        await savePin(newPin.trim());
      }

      // 3. Guardar timeout de inactividad
      await setInactivityTimeout(selectedTimeout);

      setSecretModalVisible(false);
      setSecretPassword('');
      setNewPin('');
      appAlert('Configuración guardada', 'Parámetros de acceso y seguridad actualizados correctamente.');

      // Si tenemos usuario y PIN configurado, desbloquear directamente
      const hasPinNow = await hasConfiguredPin();
      if (hasPinNow && (session || authUser)) {
        unlockApp();
      }
    } catch (e) {
      appAlert('Error', e.message || 'No fue posible guardar la configuración');
    } finally {
      setSavingSecret(false);
    }
  };

  const handleSignOutSecret = () => {
    appAlert(
      'Cerrar sesión',
      '¿Deseas desvincular este dispositivo y cerrar la sesión actual?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            setSecretModalVisible(false);
            await signOut();
          },
        },
      ]
    );
  };

  // Si se activó la calculadora señuelo por código incorrecto:
  if (showCalculator) {
    return (
      <CamouflageCalculator
        onExit={() => {
          setShowCalculator(false);
          setPin('');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <Image
        source={require('../assets/images/fondoApp.png')}
        style={StyleSheet.absoluteFillObject}
        resizeMode="stretch"
      />

      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Header con Logotipo */}
        <View style={styles.headerWrap}>
          <View style={styles.logoCircle}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandTitle}>ZENDAPP</Text>
          <Text style={styles.promptSubtitle}>
            {profile?.nombre
              ? `Hola, ${profile.nombre}`
              : 'Introduce tu PIN de acceso'}
          </Text>
          <Text style={styles.pinHint}>Código de 5 dígitos para desbloquear</Text>
        </View>

        {/* Indicador de 5 Dígitos */}
        <Animated.View
          style={[
            styles.dotsContainer,
            { transform: [{ translateX: shakeAnim }] },
          ]}
        >
          {[0, 1, 2, 3, 4].map((idx) => {
            const isFilled = pin.length > idx;
            return (
              <View
                key={idx}
                style={[
                  styles.pinDot,
                  isFilled && styles.pinDotFilled,
                ]}
              />
            );
          })}
        </Animated.View>

        {/* Teclado Numérico Ergonómico */}
        <View style={styles.keypad}>
          {/* Fila 1 */}
          <View style={styles.keypadRow}>
            {[1, 2, 3].map((num) => (
              <TouchableOpacity
                key={num}
                style={styles.numKey}
                onPress={() => handlePressDigit(num)}
                activeOpacity={0.65}
              >
                <Text style={styles.numKeyText}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Fila 2 */}
          <View style={styles.keypadRow}>
            {[4, 5, 6].map((num) => (
              <TouchableOpacity
                key={num}
                style={styles.numKey}
                onPress={() => handlePressDigit(num)}
                activeOpacity={0.65}
              >
                <Text style={styles.numKeyText}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Fila 3 */}
          <View style={styles.keypadRow}>
            {[7, 8, 9].map((num) => (
              <TouchableOpacity
                key={num}
                style={styles.numKey}
                onPress={() => handlePressDigit(num)}
                activeOpacity={0.65}
              >
                <Text style={styles.numKeyText}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Fila 4: Limpiar, 0, Borrar */}
          <View style={styles.keypadRow}>
            <TouchableOpacity
              style={styles.actionKey}
              onPress={handleClear}
              activeOpacity={0.65}
            >
              <Text style={styles.actionKeyText}>C</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.numKey}
              onPress={() => handlePressDigit(0)}
              activeOpacity={0.65}
            >
              <Text style={styles.numKeyText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionKey}
              onPress={handleBackspace}
              activeOpacity={0.65}
            >
              <Icon name="chevron-left" size={18} color="#475467" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer con versión (Toque sostenido de 2 segundos para modal secreto) */}
        <View style={styles.footerWrap}>
          <TouchableOpacity
            activeOpacity={1}
            delayLongPress={800}
            onLongPress={handleSecretLongPress}
            style={styles.versionTouchable}
          >
            <Text style={styles.versionText}>Versión {getAppVersion()}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* MODAL SECRETO DE INGRESO / CONFIGURACIÓN DE USUARIO */}
      <Modal
        visible={secretModalVisible}
        transparent
        animationType="fade"
        onRequestClose={dismissModal}
      >
        <View style={styles.modalOverlay}>
          {/* Tocar fuera para cerrar el modal */}
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissModal} />

          {/* Tarjeta con gesto para deslizar hacia abajo y cerrar */}
          <Animated.View
            style={[
              styles.sheetCard,
              { transform: [{ translateY: panY }] },
            ]}
          >
            {/* Barra y cabecera arrastrable hacia abajo */}
            <View {...panResponder.panHandlers} style={styles.dragHeaderArea}>
              <View style={styles.sheetHandle} />

              <View style={styles.sheetHeaderRow}>
                <View style={styles.shieldIconCircle}>
                  <Icon name="shield" size={18} color={zendapp.colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.sheetTitle}>Configuración de Acceso</Text>
                  <Text style={styles.sheetSubtitle}>Vincular usuario y parámetros de seguridad</Text>
                </View>
                <TouchableOpacity
                  onPress={dismissModal}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Icon name="times" size={18} color="#98A2B3" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Sección Usuario Maestro */}
              <Text style={styles.sectionLabel}>Credenciales de Usuario</Text>

              <Text style={styles.fieldLabel}>Correo Electrónico</Text>
              <View style={styles.inputContainer}>
                <Icon name="envelope" size={14} color="#98A2B3" style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.textInput}
                  placeholder="ejemplo@zendapp.com"
                  placeholderTextColor="#98A2B3"
                  value={secretEmail}
                  onChangeText={setSecretEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <Text style={styles.fieldLabel}>Contraseña de Acceso</Text>
              <View style={styles.inputContainer}>
                <Icon name="lock" size={16} color="#98A2B3" style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Ingresa la contraseña para vincular"
                  placeholderTextColor="#98A2B3"
                  value={secretPassword}
                  onChangeText={setSecretPassword}
                  secureTextEntry={!showSecretPassword}
                />
                <TouchableOpacity onPress={() => setShowSecretPassword(!showSecretPassword)}>
                  <Icon
                    name={showSecretPassword ? 'eye' : 'eye-slash'}
                    size={16}
                    color="#98A2B3"
                  />
                </TouchableOpacity>
              </View>

              {/* Sección PIN de 5 dígitos */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                PIN de 5 Dígitos para Desbloqueo
              </Text>
              <Text style={styles.fieldLabel}>Nuevo PIN (5 dígitos)</Text>
              <View style={styles.inputContainer}>
                <Icon name="key" size={14} color="#98A2B3" style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Ej. 12345"
                  placeholderTextColor="#98A2B3"
                  value={newPin}
                  onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, '').slice(0, 5))}
                  keyboardType="numeric"
                  maxLength={5}
                />
              </View>

              {/* Sección Tiempo de Inactividad */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                Tiempo de Inactividad para Bloqueo
              </Text>
              <Text style={styles.fieldLabel}>Bloquear tras segundo plano:</Text>
              <View style={styles.pillsRow}>
                {TIMEOUT_OPTIONS.map((opt) => {
                  const isSel = selectedTimeout === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.timeoutPill, isSel && styles.timeoutPillActive]}
                      onPress={() => setSelectedTimeout(opt.value)}
                    >
                      <Text
                        style={[
                          styles.timeoutPillText,
                          isSel && styles.timeoutPillTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Acciones */}
            <View style={styles.sheetActionsRow}>
              {session && (
                <TouchableOpacity
                  style={styles.btnDesvincular}
                  onPress={handleSignOutSecret}
                >
                  <Icon name="sign-out" size={14} color="#D92D20" />
                  <Text style={styles.btnDesvincularText}>Desvincular</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.btnGuardar,
                  savingSecret && styles.btnGuardarDisabled,
                ]}
                onPress={handleSaveSecretConfig}
                disabled={savingSecret}
              >
                {savingSecret ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnGuardarText}>Guardar</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 40 : 28,
    paddingBottom: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerWrap: {
    alignItems: 'center',
    marginTop: 10,
  },
  logoCircle: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 0 },
    }),
  },
  logoImage: {
    width: 52,
    height: 52,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#1E1E1F',
  },
  promptSubtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#344054',
    marginTop: 6,
  },
  pinHint: {
    fontSize: 12,
    color: '#667085',
    marginTop: 2,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginVertical: 18,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D0D5DD',
    backgroundColor: 'transparent',
  },
  pinDotFilled: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
    transform: [{ scale: 1.15 }],
  },
  keypad: {
    width: '100%',
    maxWidth: 290,
    gap: 14,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  numKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E4E7EC',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 0 },
    }),
  },
  numKeyText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1E1E1F',
  },
  actionKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionKeyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#475467',
  },
  footerWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  versionTouchable: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  versionText: {
    fontSize: 12,
    color: '#98A2B3',
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // Modal Secreto
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 24, 40, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  dragHeaderArea: {
    paddingBottom: 4,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4E7EC',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  shieldIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E1E1F',
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#667085',
    marginTop: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: zendapp.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#344054',
    marginBottom: 4,
    marginTop: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#1E1E1F',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  timeoutPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F2F4F7',
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  timeoutPillActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
  },
  timeoutPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475467',
  },
  timeoutPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sheetActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
  },
  btnDesvincular: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#FEF3F2',
    borderWidth: 1,
    borderColor: '#FECDCA',
  },
  btnDesvincularText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D92D20',
  },
  btnGuardar: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: zendapp.colors.primary,
  },
  btnGuardarDisabled: {
    opacity: 0.65,
  },
  btnGuardarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
