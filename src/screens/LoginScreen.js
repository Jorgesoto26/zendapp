import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
  PermissionsAndroid,
  Animated,
  KeyboardAvoidingView,
  Image,
  StatusBar,
} from 'react-native';
import { supabase } from '../lib/supabase';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getData, getDbConnection } from '../database/db';
import { AuthService } from '../services/services';
import { useAuth } from '../context/AuthContext';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { zendapp } from '../theme/zendappTheme';
import { AppleButton } from '../components/AppleButton';
import { appAlert } from '../components/AppAlert';

export default function LoginScreen() {
  const { setAuthSession } = useAuth();
  const dbRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Estados de foco para inputs interactivos
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [regEmailFocused, setRegEmailFocused] = useState(false);
  const [regPasswordFocused, setRegPasswordFocused] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 650, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
    ]).start();

    (async () => {
      try {
        dbRef.current = await getDbConnection();
        await getData(dbRef.current, 'select * from parametrizacion');
        await requestLocationPermissions();
      } catch (e) {
        console.error('Error inicializando en Login:', e);
      }
    })();
  }, []);

  const requestLocationPermissions = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Permisos de ubicación',
            message: 'Zendapp necesita acceso a tu ubicación para registrar visitas y operaciones en campo.',
            buttonNeutral: 'Preguntar después',
            buttonNegative: 'Cancelar',
            buttonPositive: 'Aceptar',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          appAlert('Permiso requerido', 'Debes habilitar el acceso a la ubicación para operar correctamente.');
        }
      } else if (Platform.OS === 'ios') {
        const result = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
        if (result !== RESULTS.GRANTED) {
          appAlert('Permiso requerido', 'Activa ubicación en Configuración > Privacidad.');
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      return appAlert('Atención', 'Por favor ingresa tu correo y contraseña');
    }
    setLoading(true);
    try {
      if (!dbRef.current) dbRef.current = await getDbConnection();
      const result = await AuthService(dbRef.current, email, password);
      if (!result.success) {
        const title =
          result.message && result.message.toLowerCase().includes('cerrada')
            ? 'Caja cerrada'
            : result.message && result.message.toLowerCase().includes('caja')
              ? 'Caja requerida'
              : 'Error de acceso';
        appAlert(title, result.message);
      } else if (result.session) {
        if (result.isOffline) {
          appAlert(
            'Modo sin conexión',
            'Has ingresado sin conexión a internet. Tu ruta y cobros registrados se sincronizarán cuando recuperes la señal.',
            [
              {
                text: 'Continuar',
                onPress: () => {
                  setAuthSession(result.session, result.profile);
                },
              },
            ]
          );
        } else {
          setAuthSession(result.session, result.profile);
        }
      }
    } catch (e) {
      appAlert('Error', e.message || 'No fue posible iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      if (!regEmail.trim() || !regPassword.trim()) {
        appAlert('Error', 'Por favor completa todos los campos');
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: regEmail.trim(),
        password: regPassword.trim(),
      });
      if (error) throw error;
      appAlert('¡Registro exitoso!', 'Inicia sesión con tus credenciales.');
      setModalVisible(false);
      setRegEmail('');
      setRegPassword('');
    } catch (error) {
      appAlert('Error', error.message || 'Ocurrió un error durante el registro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Fondo institucional exclusivo de Login */}
      <Image
        source={require('../assets/images/fondoApp.png')}
        style={StyleSheet.absoluteFillObject}
        resizeMode="stretch"
      />
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
            {/* Header de Marca con Logo Oficial */}
            <View style={styles.brandHeader}>
              <Animated.View
                style={[
                  styles.logoContainer,
                  { transform: [{ scale: logoScale }] },
                ]}
              >
                <Image
                  source={require('../assets/images/logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </Animated.View>
              <Text style={styles.brandTitle}>ZENDAPP</Text>
              {/* <View style={styles.brandTaglineWrap}>
                <View style={styles.brandAccentDot} />
                <Text style={styles.brandTagline}>Gestión de Cartera & Caja</Text>
              </View> */}
            </View>

            {/* Tarjeta Principal de Inicio de Sesión */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Bienvenido</Text>
                {/* <Text style={styles.cardSubtitle}>
                  Ingresa con tu cuenta para iniciar tu jornada
                </Text> */}
              </View>

              {/* Input Correo */}
              <Text style={styles.inputLabel}>Correo electrónico</Text>
              <View
                style={[
                  styles.inputContainer,
                  emailFocused && styles.inputContainerFocused,
                ]}
              >
                <Icon
                  name="envelope"
                  size={15}
                  color={emailFocused ? zendapp.colors.primary : zendapp.colors.textTertiary}
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="tucorreo@ejemplo.com"
                  placeholderTextColor={zendapp.colors.textPlaceholder}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  style={styles.textInputField}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Input Contraseña */}
              <Text style={styles.inputLabel}>Contraseña</Text>
              <View
                style={[
                  styles.inputContainer,
                  passwordFocused && styles.inputContainerFocused,
                ]}
              >
                <Icon
                  name="lock"
                  size={17}
                  color={passwordFocused ? zendapp.colors.primary : zendapp.colors.textTertiary}
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="Ingresa tu contraseña"
                  placeholderTextColor={zendapp.colors.textPlaceholder}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry={!showPassword}
                  style={styles.textInputField}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.eyeBtn}
                >
                  <Icon
                    name={showPassword ? 'eye' : 'eye-slash'}
                    size={17}
                    color={showPassword ? zendapp.colors.primary : zendapp.colors.textTertiary}
                  />
                </TouchableOpacity>
              </View>

              {/* Botón de Ingreso Oficial */}
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                onPress={handleLogin}
                activeOpacity={0.85}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={styles.btnContentRow}>
                    <Text style={styles.primaryBtnText}>Iniciar Sesión</Text>
                    <Icon name="arrow-right" size={14} color="#FFFFFF" style={{ marginLeft: 8 }} />
                  </View>
                )}
              </TouchableOpacity>

              {/* Enlace de Registro */}
              <TouchableOpacity
                onPress={() => setModalVisible(true)}
                style={styles.registerLink}
                activeOpacity={0.7}
              >
                <Text style={styles.registerLinkText}>
                  ¿No tienes una cuenta aún?{' '}
                  <Text style={styles.registerLinkHighlight}>Crear cuenta</Text>
                </Text>
              </TouchableOpacity>
            </View>

            {/* Footer de Seguridad y Versión */}
            <View style={styles.footerWrap}>
              <View style={styles.securityRow}>
                <Icon name="shield" size={12} color={zendapp.colors.textTertiary} />
                <Text style={styles.securityText}>
                  Conexión segura y cifrada de extremo a extremo
                </Text>
              </View>
              <Text style={styles.versionText}>Zendapp v1.0.0 · Todos los derechos reservados</Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal Crear Cuenta */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Crear cuenta nueva</Text>
            <Text style={styles.sheetSub}>
              Ingresa tus datos para registrar tu cuenta en Zendapp
            </Text>

            <Text style={styles.inputLabel}>Correo electrónico</Text>
            <View
              style={[
                styles.inputContainer,
                regEmailFocused && styles.inputContainerFocused,
              ]}
            >
              <Icon
                name="envelope"
                size={15}
                color={regEmailFocused ? zendapp.colors.primary : zendapp.colors.textTertiary}
                style={styles.inputIcon}
              />
              <TextInput
                placeholder="tucorreo@ejemplo.com"
                placeholderTextColor={zendapp.colors.textPlaceholder}
                value={regEmail}
                onChangeText={setRegEmail}
                onFocus={() => setRegEmailFocused(true)}
                onBlur={() => setRegEmailFocused(false)}
                style={styles.textInputField}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <Text style={styles.inputLabel}>Contraseña</Text>
            <View
              style={[
                styles.inputContainer,
                regPasswordFocused && styles.inputContainerFocused,
              ]}
            >
              <Icon
                name="lock"
                size={17}
                color={regPasswordFocused ? zendapp.colors.primary : zendapp.colors.textTertiary}
                style={styles.inputIcon}
              />
              <TextInput
                placeholder="Crea una contraseña segura (mín. 6 caracteres)"
                placeholderTextColor={zendapp.colors.textPlaceholder}
                value={regPassword}
                onChangeText={setRegPassword}
                onFocus={() => setRegPasswordFocused(true)}
                onBlur={() => setRegPasswordFocused(false)}
                secureTextEntry={!showRegPassword}
                style={styles.textInputField}
              />
              <TouchableOpacity
                onPress={() => setShowRegPassword(!showRegPassword)}
                style={styles.eyeBtn}
              >
                <Icon
                  name={showRegPassword ? 'eye' : 'eye-slash'}
                  size={17}
                  color={zendapp.colors.textTertiary}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.sheetCancelBtn}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.sheetCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetSubmitBtn, loading && styles.primaryBtnDisabled]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.sheetSubmitText}>Registrarse</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: 28,
    justifyContent: 'center',
  },

  // Marca y Logotipo
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoContainer: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#1E1E1F',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
      },
      android: { elevation: 0 },
    }),
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginBottom: 14,
  },
  logoImage: {
    width: 76,
    height: 76,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#1E1E1F',
  },
  brandTaglineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  brandAccentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EE272D',
    marginRight: 6,
  },
  brandTagline: {
    fontSize: 13,
    fontWeight: '600',
    color: '#667085',
    letterSpacing: 0.2,
  },

  // Tarjeta de Login
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EAECF0',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: { elevation: 0 },
    }),
  },
  cardHeader: {
    marginBottom: 18,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E1E1F',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#667085',
    marginTop: 3,
  },

  // Campos de Texto
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#344054',
    marginBottom: 6,
    marginTop: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    paddingHorizontal: 14,
    height: 50,
    overflow: 'hidden',
  },
  inputContainerFocused: {
    borderColor: '#EE272D',
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
  },
  inputIcon: {
    marginRight: 10,
  },
  textInputField: {
    flex: 1,
    fontSize: 15,
    color: '#1E1E1F',
    height: '100%',
  },
  eyeBtn: {
    padding: 6,
  },

  // Botón Principal
  primaryBtn: {
    backgroundColor: '#EE272D',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#EE272D',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: { elevation: 0 },
    }),
  },
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Enlace inferior
  registerLink: {
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 6,
  },
  registerLinkText: {
    fontSize: 13,
    color: '#667085',
  },
  registerLinkHighlight: {
    color: '#EE272D',
    fontWeight: '700',
  },

  // Footer
  footerWrap: {
    alignItems: 'center',
    marginTop: 24,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  securityText: {
    fontSize: 11,
    color: '#98A2B3',
    fontWeight: '500',
  },
  versionText: {
    fontSize: 11,
    color: '#98A2B3',
    fontWeight: '400',
  },

  // Modal / Bottom Sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 24, 40, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4E7EC',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E1E1F',
    textAlign: 'center',
  },
  sheetSub: {
    fontSize: 13,
    color: '#667085',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
    alignItems: 'center',
  },
  sheetCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475467',
  },
  sheetSubmitBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EE272D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
