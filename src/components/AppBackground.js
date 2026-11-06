// src/components/AppBackground.js
import React from 'react';
import { Image, StyleSheet } from 'react-native';

/**
 * Fondo institucional unificado para todas las pantallas de la app
 * Basado en la imagen src/assets/images/fondoGeneral.png
 */
export default function AppBackground() {
  return (
    <Image
      source={require('../assets/images/fondoGeneral.png')}
      style={styles.background}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});

