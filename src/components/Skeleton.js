// src/components/Skeleton.js
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { zendapp } from '../theme/zendappTheme';

/**
 * Bloque elemental de Skeleton con pulsación shimmer 100% nativa (GPU, 60fps)
 */
export function SkeletonItem({
  width = '100%',
  height = 14,
  borderRadius = 6,
  style,
}) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.9,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.skeletonBase,
        {
          width,
          height,
          borderRadius,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
}

/**
 * Skeleton que imita de forma idéntica la silueta de una tarjeta de cobro (itemPayments)
 */
export function SkeletonPaymentCard({ style }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.content}>
        {/* Fila 1: Nombre + Pill teléfono + Botón GPS */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SkeletonItem width="55%" height={16} borderRadius={6} />
              <SkeletonItem width={76} height={18} borderRadius={999} />
            </View>
            <SkeletonItem width="75%" height={12} borderRadius={4} style={{ marginTop: 8 }} />
          </View>
          <SkeletonItem width={28} height={28} borderRadius={8} />
        </View>

        {/* Fila 2: Caja de cuota y saldo */}
        <View style={styles.infoRow}>
          <View>
            <SkeletonItem width={50} height={9} borderRadius={4} />
            <SkeletonItem width={80} height={16} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <SkeletonItem width={50} height={9} borderRadius={4} />
            <SkeletonItem width={70} height={14} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        </View>

        {/* Fila 3: Botones de acción */}
        <View style={styles.actions}>
          <SkeletonItem width="32%" height={36} borderRadius={18} />
          <SkeletonItem width="32%" height={36} borderRadius={18} />
          <SkeletonItem width="32%" height={36} borderRadius={18} />
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton para pantalla de Caja (tarjeta de balance + movimientos)
 */
export function SkeletonCaja() {
  return (
    <View style={{ padding: 16 }}>
      {/* Tarjeta resumen */}
      <View style={[styles.card, { padding: 20, marginBottom: 16 }]}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <SkeletonItem width={56} height={56} borderRadius={28} style={{ marginBottom: 12 }} />
          <SkeletonItem width={120} height={12} borderRadius={4} style={{ marginBottom: 8 }} />
          <SkeletonItem width={180} height={26} borderRadius={6} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <SkeletonItem width="48%" height={44} borderRadius={12} />
          <SkeletonItem width="48%" height={44} borderRadius={12} />
        </View>
      </View>

      {/* Lista de movimientos placeholders */}
      <SkeletonItem width={140} height={14} borderRadius={4} style={{ marginBottom: 12, marginLeft: 4 }} />
      {[1, 2, 3].map((k) => (
        <View key={k} style={[styles.card, { padding: 14, marginBottom: 8 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <SkeletonItem width={36} height={36} borderRadius={18} />
              <View>
                <SkeletonItem width={110} height={14} borderRadius={4} style={{ marginBottom: 6 }} />
                <SkeletonItem width={80} height={10} borderRadius={3} />
              </View>
            </View>
            <SkeletonItem width={70} height={16} borderRadius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeleton para tarjetas de usuarios en Admin
 */
export function SkeletonUserCard() {
  return (
    <View style={[styles.card, { padding: 14, marginHorizontal: 16, marginBottom: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SkeletonItem width={42} height={42} borderRadius={21} />
        <View style={{ flex: 1 }}>
          <SkeletonItem width="50%" height={15} borderRadius={4} style={{ marginBottom: 6 }} />
          <SkeletonItem width="70%" height={12} borderRadius={4} />
        </View>
        <SkeletonItem width={60} height={22} borderRadius={11} />
      </View>
    </View>
  );
}

/**
 * Skeleton para tarjetas de cartera en Admin
 */
export function SkeletonCarteraCard() {
  return (
    <View style={[styles.card, { padding: 14, marginHorizontal: 16, marginBottom: 8 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <SkeletonItem width="60%" height={16} borderRadius={4} style={{ marginBottom: 8 }} />
          <SkeletonItem width="40%" height={12} borderRadius={4} />
        </View>
        <SkeletonItem width={75} height={18} borderRadius={999} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderColor: '#EAECF0' }}>
        <SkeletonItem width={90} height={14} borderRadius={4} />
        <SkeletonItem width={80} height={14} borderRadius={4} />
      </View>
    </View>
  );
}

/**
 * Contenedor genérico para renderizar N tarjetas de Skeleton
 */
export function SkeletonList({ count = 4, Component = SkeletonPaymentCard, style }) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, index) => (
        <Component key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonBase: {
    backgroundColor: '#E5E7EB',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#D8DCE4',
    overflow: 'hidden',
    marginHorizontal: 16,
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
  },
  content: {
    padding: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
});

