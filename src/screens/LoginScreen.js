import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import { getData, getDbConnection } from '../database/db';
import { getInvoice } from '../services/services';

export default function LoginScreen({ }) {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const LoadData = async () => {
      try {
        console.log('Intentando conectar con la BD local...');
        const db = await getDbConnection();
        console.log('Conexión exitosa.');
  
        const parametrizacion = await getData(
          db,
          `select * from parametrizacion `,
        );
        console.log('parametrizacion', parametrizacion);
      } catch (error) {
        console.error('Error al cargar datos de parametrización:', error);
      }
    };
    LoadData();
  }, []);
  

  const handleLogin = async () => {
    try {
      // Check if user exists in perfiles table
      console.log("Intentando login con:", {
        email: email,
        password: password
      });

      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('login', email)
        .eq('password', password);

      console.log("Respuesta completa:", {
        data: profileData,
        error: profileError
      });

      if (profileError) {
        console.log('Error de perfil:', profileError);
        Alert.alert('Error', 'Error al verificar el perfil del usuario');
        return;
      }

      if (!profileData || profileData.length === 0) {
        console.log('No se encontraron coincidencias');
        Alert.alert('Error', 'Usuario no encontrado en la base de datos');
        return;
      }

      // If everything is successful, show success message
      console.log("Usuario encontrado:", profileData[0]);
      const invoice = await getInvoice();
      console.log('invoice', invoice);



      navigation.navigate('Main', { user: profileData[0] });

      //Alert.alert('Éxito', 'Usuario encontrado correctamente');
    } catch (error) {
      console.log("Error del inicio:", error);
      Alert.alert('Error', 'Ocurrió un error durante el inicio de sesión');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a Zenda</Text>
      <TextInput
        placeholder="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
      />
      <TouchableOpacity onPress={handleLogin} style={styles.button}>
        <Text style={styles.buttonText}>Iniciar sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});