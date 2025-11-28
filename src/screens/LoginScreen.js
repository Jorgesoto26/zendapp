import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getData, getDbConnection, insertOrReplaceData, updateData } from '../database/db';
import { AuthService } from '../services/services';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';


export default function LoginScreen() {
  let db
  const navigation = useNavigation();
  const [email, setEmail] = useState('gogicolombia@gmail.com');
  const [password, setPassword] = useState('Admin1234!');
  const [modalVisible, setModalVisible] = useState(false);
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const LoadData = async () => {
      try {
        db = await getDbConnection();
        const datosParams = await getData(db, `select * from parametrizacion`);
        console.log('Datos de parametrización cargados....:', datosParams);

        // ✅ Solicitar permisos después de cargar los datos
        await requestLocationPermissions();
      } catch (error) {
        console.error('Error al cargar datos de parametrización:', error);
      }
    };
    LoadData();
  }, []);

  const requestLocationPermissions = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Permisos de ubicación',
            message: 'Esta aplicación necesita acceso a tu ubicación para registrar visitas o pagos.',
            buttonNeutral: 'Preguntar después',
            buttonNegative: 'Cancelar',
            buttonPositive: 'Aceptar',
          }
        );

        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('✅ Permiso de ubicación concedido');
        } else {
          Alert.alert(
            'Permiso requerido',
            'Debes habilitar el acceso a la ubicación para continuar usando la aplicación.'
          );
        }
      } else if (Platform.OS === 'ios') {
        const result = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
        if (result === RESULTS.GRANTED) {
          console.log('✅ Permiso de ubicación concedido en iOS');
        } else {
          Alert.alert(
            'Permiso requerido',
            'Por favor activa el acceso a tu ubicación en Configuración > Privacidad.'
          );
        }
      }
    } catch (error) {
      console.error('Error solicitando permisos de ubicación:', error);
    }
  };



  const handleLogin = async () => {
    setLoading(true);
    const result = await AuthService(db, email, password);

    if (result.success) {
      setLoading(false);
      navigation.replace('Main', { user: result.user });
    } else {
      Alert.alert('Error', result.message);
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      if (!regEmail || !regPassword) {
        Alert.alert('Error', 'Por favor completa todos los campos');
        return;
      }

      const { error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
      });

      if (error) throw error;

      Alert.alert('¡Registro exitoso!', 'Inicia sesion con tus datos');
      setModalVisible(false);
      setRegEmail('');
      setRegPassword('');
    } catch (error) {
      Alert.alert('Error', error.message || 'Ocurrió un error durante el registro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      /> */}

      <Text style={styles.title}>Bienvenido a Zenda</Text>

      <Text style={styles.label}>Correo electrónico</Text>
      <TextInput
        placeholder="tucorreo@ejemplo.com"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholderTextColor="#888"
      />

      <Text style={styles.label}>Contraseña</Text>
      <View style={styles.passwordContainer}>
        <TextInput
          placeholder="Ingresa tu contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          style={styles.inputPassword}
          placeholderTextColor="#888"
        />
        <TouchableOpacity
          onPress={() => setShowPassword(!showPassword)}
          style={styles.iconButton}
        >
          <Icon
            name={showPassword ? 'eye' : 'eye-slash'}
            size={20}
            color="#888"
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={handleLogin}
        style={styles.button}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Iniciar sesión</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={styles.registerButton}
      >
        <Text style={styles.registerButtonText}>¿No tienes cuenta? Regístrate</Text>
      </TouchableOpacity>

      {/* Modal de Registro */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Crear nueva cuenta</Text>

            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              placeholder="tucorreo@ejemplo.com"
              value={regEmail}
              onChangeText={setRegEmail}
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor="#888"
            />

            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                placeholder="Crea una contraseña"
                value={regPassword}
                onChangeText={setRegPassword}
                secureTextEntry={!showRegPassword}
                style={styles.inputPassword}
                placeholderTextColor="#888"
              />
              <TouchableOpacity
                onPress={() => setShowRegPassword(!showRegPassword)}
                style={styles.iconButton}
              >
                <Icon
                  name={showRegPassword ? 'eye' : 'eye-slash'}
                  size={20}
                  color="#888"
                />
              </TouchableOpacity>
            </View>

            <View style={styles.buttonGroup}>
              <Pressable
                style={[styles.button, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.buttonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={styles.button}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Registrarse</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 25,
    backgroundColor: '#f8f9fa',
  },
  logo: {
    width: 150,
    height: 150,
    alignSelf: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 30,
    textAlign: 'center',
    color: '#2c3e50',
  },
  label: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 8,
    marginLeft: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    color: '#2c3e50',
    backgroundColor: '#fff',
    fontSize: 16,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  inputPassword: {
    flex: 1,
    padding: 15,
    color: '#2c3e50',
    fontSize: 16,
  },
  iconButton: {
    padding: 10,
  },
  button: {
    backgroundColor: '#3498db',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  registerButton: {
    padding: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  registerButtonText: {
    color: '#3498db',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 25,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 25,
    color: '#2c3e50',
    textAlign: 'center',
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    marginRight: 10,
    flex: 1,
  },
});
