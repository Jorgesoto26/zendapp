import * as React from 'react';
import { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/FontAwesome';

import LoginScreen from './LoginScreen';
import Payments from './payments/Payments';
import CrearCliente from './createClient/CrearCliente';
/* import CreateClient from './clients/CreateClient';
import Movements from './movements/Movements';
import Caja from './caja/Caja';
import AbrirCaja from './caja/AbrirCaja';
import NuevoCliente from './clients/NuevoCliente';
import Facturas from './facturas/Facturas'; */

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Mapeo de rutas a componentes
const routeComponents = {
  CreateClient: CrearCliente,
  Payments: Payments,
  /* AbrirCaja: AbrirCaja,
  Movements: Movements,
  Caja: Caja,
  NuevoCliente: NuevoCliente,
  Facturas: Facturas, */
};

const menuOptions = {
  seller: [
    { title: 'Pagos', route: 'Payments', icon: 'money' }, 
    { title: 'Crear Cliente', route: 'CreateClient', icon: 'user-plus' },
    { title: 'Movimientos', route: 'Movements', icon: 'exchange' },
    { title: 'Caja', route: 'Caja', icon: 'shopping-cart' },
  ],
  admin: [
    { title: 'Abrir Caja', route: 'AbrirCaja', icon: 'unlock' },
    { title: 'Registrar Cliente', route: 'NuevoCliente', icon: 'user-plus' },
    { title: 'Ver Facturas', route: 'Facturas', icon: 'file-text' },
  ],
};

function MainTabs(route) {
  const { user } = route.route.params;
  console.log('Usuario:', user);
  
  const [perfil, setPerfil] = useState('seller');

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderColor: '#ccc',
          paddingVertical: 10,
        },
        tabBarLabelStyle: {
          fontSize: 12,
        },
        tabBarActiveTintColor: '#007bff',
        tabBarInactiveTintColor: '#666',
        headerShown: false,
      }}
    >
      {menuOptions[perfil]?.map((item, index) => (
        <Tab.Screen
          key={index}
          name={item.route}
          component={routeComponents[item.route] || CrearCliente}
          options={{
            tabBarIcon: ({ color }) => (
              <Icon name={item.icon} size={24} color={color} />
            ),
            tabBarLabel: item.title,
          }}
          initialParams={{ user }} // Pasar el usuario como parámetro
        />
      ))}
    </Tab.Navigator>
  );
}

export default function Navigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
} 