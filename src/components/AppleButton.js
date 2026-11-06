import React, { useRef } from 'react';
import { Pressable, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { apple } from '../theme/appleTheme';

export function AppleButton({ title, onPress, variant = 'primary', loading = false, disabled = false, icon, style }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  const isPrimary = variant === 'primary';
  const isDestructive = variant === 'destructive';
  const isCarbon = variant === 'carbon';
  const bg = disabled
    ? '#D0D5DD'
    : isPrimary
    ? apple.colors.blue
    : isCarbon
    ? (apple.colors.carbon || '#1E1E1F')
    : isDestructive
    ? apple.colors.danger
    : apple.colors.fill;
  const color = isPrimary || isDestructive || isCarbon ? '#FFFFFF' : apple.colors.blue;

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onIn}
        onPressOut={onOut}
        disabled={disabled || loading}
        android_ripple={{ color: 'rgba(255,255,255,0.15)', borderless: false }}
        style={[styles.btn, { backgroundColor: bg }, disabled && { opacity: 0.6 }]}
      >
        {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.text, { color }]}>{title}</Text>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: apple.radius.s,
    overflow: 'hidden',
  },
  btn: {
    height: 50,
    borderRadius: apple.radius.s,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  text: { fontSize: 17, fontWeight: '600', letterSpacing: -0.41 },
});
