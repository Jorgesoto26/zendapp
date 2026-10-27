import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, Pressable,
  ActivityIndicator, ScrollView, Platform, PermissionsAndroid, Animated, KeyboardAvoidingView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getData, getDbConnection } from '../database/db';
import { AuthService } from '../services/services';
import { useAuth } from '../context/AuthContext';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { apple } from '../theme/appleTheme';
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
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
    (async () => {
      try {
        dbRef.current = await getDbConnection();
        await getData(dbRef.current, 'select * from parametrizacion');
        await requestLocationPermissions();
      } catch (e) { console.error(e); }
    })();
  }, []);

  const requestLocationPermissions = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
          title: 'Permisos de ubicación',
          message: 'Esta aplicación necesita acceso a tu ubicación para registrar visitas o pagos.',
          buttonNeutral: 'Preguntar después', buttonNegative: 'Cancelar', buttonPositive: 'Aceptar',
        });
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) appAlert('Permiso requerido', 'Debes habilitar el acceso a la ubicación para continuar.');
      } else if (Platform.OS === 'ios') {
        const result = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
        if (result !== RESULTS.GRANTED) appAlert('Permiso requerido', 'Activa ubicación en Configuración > Privacidad.');
      }
    } catch (e) { console.error(e); }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return appAlert('Error', 'Completa email y contraseña');
    setLoading(true);
    try {
      if (!dbRef.current) dbRef.current = await getDbConnection();
      const result = await AuthService(dbRef.current, email, password);
      if (!result.success) {
        const title = (result.message && result.message.toLowerCase().includes('caja')) ? 'Caja requerida' : 'Error';
        appAlert(title, result.message);
      } else if (result.session) {
        if (result.isOffline) {
          appAlert(
            'Modo sin conexion',
            'Has ingresado sin conexion a internet. Tu ruta y cobros registrados se sincronizaran cuando recuperes la senal.',
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
    } catch (e) { appAlert('Error', e.message); } finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      if (!regEmail || !regPassword) { appAlert('Error', 'Por favor completa todos los campos'); return; }
      const { error } = await supabase.auth.signUp({ email: regEmail, password: regPassword });
      if (error) throw error;
      appAlert('¡Registro exitoso!', 'Inicia sesión con tus datos');
      setModalVisible(false); setRegEmail(''); setRegPassword('');
    } catch (error) { appAlert('Error', error.message || 'Ocurrió un error durante el registro'); }
    finally { setLoading(false); }
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
            {/* Logo / marca */}
            <View style={styles.brand}>
              <View style={styles.logoCircle}><Text style={styles.logoText}>Z</Text></View>
              <Text style={styles.brandTitle}>Zenda</Text>
              <Text style={styles.brandSub}>Cartera · Crédito · Caja</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Bienvenido</Text>
              <Text style={styles.cardSub}>Ingresa a tu cuenta para continuar</Text>

              <Text style={styles.label}>Correo electrónico</Text>
              <View style={styles.inputWrap}>
                <Icon name="envelope" size={16} color={apple.colors.tertiaryLabel} style={styles.inputIcon} />
                <TextInput
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>

              <Text style={styles.label}>Contraseña</Text>
              <View style={styles.inputWrap}>
                <Icon name="lock" size={16} color={apple.colors.tertiaryLabel} style={styles.inputIcon} />
                <TextInput
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  style={styles.inputFlex}
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Icon name={showPassword ? 'eye' : 'eye-slash'} size={18} color={apple.colors.tertiaryLabel} />
                </TouchableOpacity>
              </View>

              <AppleButton title="Iniciar sesión" onPress={handleLogin} loading={loading} style={{ marginTop: 8 }} />

              <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.linkBtn}>
                <Text style={styles.linkText}>¿No tienes cuenta? <Text style={styles.linkTextBold}>Regístrate</Text></Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.footnote}>Al continuar aceptas los términos de Zenda. Tus datos están protegidos.</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Crear cuenta</Text>
            <Text style={styles.sheetSub}>Usa un correo válido y una contraseña segura</Text>

            <Text style={styles.label}>Correo electrónico</Text>
            <View style={styles.inputWrap}>
              <Icon name="envelope" size={16} color={apple.colors.tertiaryLabel} style={styles.inputIcon} />
              <TextInput placeholder="tucorreo@ejemplo.com" value={regEmail} onChangeText={setRegEmail} style={styles.input} keyboardType="email-address" autoCapitalize="none" placeholderTextColor={apple.colors.tertiaryLabel} />
            </View>

            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.inputWrap}>
              <Icon name="lock" size={16} color={apple.colors.tertiaryLabel} style={styles.inputIcon} />
              <TextInput placeholder="Crea una contraseña" value={regPassword} onChangeText={setRegPassword} secureTextEntry={!showRegPassword} style={styles.inputFlex} placeholderTextColor={apple.colors.tertiaryLabel} />
              <TouchableOpacity onPress={() => setShowRegPassword(!showRegPassword)}><Icon name={showRegPassword ? 'eye' : 'eye-slash'} size={18} color={apple.colors.tertiaryLabel} /></TouchableOpacity>
            </View>

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setModalVisible(false)}><Text style={styles.sheetCancelText}>Cancelar</Text></TouchableOpacity>
              <View style={{ flex: 1 }}><AppleButton title="Registrarse" onPress={handleRegister} loading={loading} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: apple.colors.bgGrouped },
  container: { flexGrow: 1, padding: 20, paddingTop: 56, paddingBottom: 32 },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: apple.radius.xl,
    backgroundColor: apple.colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '800' },
  brandTitle: { ...apple.typography.title1, marginTop: 12 },
  brandSub: { ...apple.typography.subheadline, marginTop: 2 },
  card: {
    padding: 20,
    borderRadius: apple.radius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  cardTitle: { ...apple.typography.title2, marginBottom: 4 },
  cardSub: { ...apple.typography.subheadline, marginBottom: 20 },
  label: { ...apple.typography.footnote, fontWeight: '600', color: apple.colors.secondaryLabel, marginBottom: 6, marginTop: 12 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.s, borderWidth: 1, borderColor: apple.colors.separator, paddingHorizontal: 12, height: 48,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: apple.colors.label, fontSize: 16, height: '100%' },
  inputFlex: { flex: 1, color: apple.colors.label, fontSize: 16 },
  linkBtn: { alignItems: 'center', marginTop: 16, padding: 8 },
  linkText: { ...apple.typography.subheadline, color: apple.colors.secondaryLabel },
  linkTextBold: { color: apple.colors.blue, fontWeight: '600' },
  footnote: { ...apple.typography.caption1, textAlign: 'center', marginTop: 16, paddingHorizontal: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: apple.colors.card,
    borderTopLeftRadius: apple.radius.xl,
    borderTopRightRadius: apple.radius.xl,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: '#E8EAED',
  },
  sheetHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: apple.colors.separator, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { ...apple.typography.title3, textAlign: 'center' },
  sheetSub: { ...apple.typography.subheadline, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 20, alignItems: 'center' },
  sheetCancel: { flex: 1, height: 50, borderRadius: apple.radius.s, backgroundColor: apple.colors.fill, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { fontSize: 17, fontWeight: '600', color: apple.colors.label },
});
