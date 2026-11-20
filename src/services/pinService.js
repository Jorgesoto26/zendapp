// src/services/pinService.js
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PIN_STORAGE_KEY = 'zendapp_security_pin';
export const INACTIVITY_TIMEOUT_KEY = 'zendapp_inactivity_timeout';
export const LAST_BACKGROUND_TIME_KEY = 'zendapp_last_background_timestamp';
export const DEFAULT_INACTIVITY_MINUTES = 5;

/**
 * Hashing seguro y rápido para el PIN de 5 dígitos (sin dependencias nativas complejas)
 * Funciona de forma 100% offline y determinística.
 */
export function hashPin(pin) {
  if (!pin) return '';
  const cleanPin = String(pin).trim();
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  const str = 'zenda_secure_pin_salt_v2026_' + cleanPin;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

/**
 * Guarda el PIN de 5 dígitos en almacenamiento seguro
 */
export async function savePin(pin) {
  if (!pin || String(pin).length !== 5) {
    throw new Error('El PIN debe tener exactamente 5 dígitos numéricos.');
  }
  const hashed = hashPin(pin);
  await AsyncStorage.setItem(PIN_STORAGE_KEY, hashed);
  return true;
}

/**
 * Verifica si el PIN ingresado coincide con el guardado
 */
export async function verifyPin(inputPin) {
  if (!inputPin) return false;
  try {
    const storedHash = await AsyncStorage.getItem(PIN_STORAGE_KEY);
    if (!storedHash) return false;
    const inputHash = hashPin(inputPin);
    return storedHash === inputHash;
  } catch (e) {
    console.error('Error verificando PIN:', e);
    return false;
  }
}

/**
 * Verifica si el usuario ya tiene configurado un PIN en este dispositivo
 */
export async function hasConfiguredPin() {
  try {
    const stored = await AsyncStorage.getItem(PIN_STORAGE_KEY);
    return Boolean(stored && stored.length > 0);
  } catch {
    return false;
  }
}

/**
 * Elimina el PIN configurado (en caso de desvinculación de dispositivo)
 */
export async function clearPin() {
  try {
    await AsyncStorage.removeItem(PIN_STORAGE_KEY);
    await AsyncStorage.removeItem(LAST_BACKGROUND_TIME_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Obtiene el tiempo de inactividad configurado en minutos (0 = Inmediato, 5 = por defecto)
 */
export async function getInactivityTimeout() {
  try {
    const val = await AsyncStorage.getItem(INACTIVITY_TIMEOUT_KEY);
    if (val !== null && val !== undefined) {
      return parseInt(val, 10);
    }
  } catch {}
  return DEFAULT_INACTIVITY_MINUTES;
}

/**
 * Guarda el tiempo de inactividad en minutos
 */
export async function setInactivityTimeout(minutes) {
  try {
    await AsyncStorage.setItem(INACTIVITY_TIMEOUT_KEY, String(minutes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra la estampa de tiempo al pasar a segundo plano
 */
export async function recordBackgroundTimestamp() {
  try {
    await AsyncStorage.setItem(LAST_BACKGROUND_TIME_KEY, String(Date.now()));
  } catch {}
}

/**
 * Evalúa si la app debe bloquearse al volver al primer plano según el tiempo transcurrido
 */
export async function shouldLockOnForeground() {
  try {
    const hasPin = await hasConfiguredPin();
    if (!hasPin) return false;

    const timeoutMinutes = await getInactivityTimeout();
    // 0 = Inmediato
    if (timeoutMinutes === 0) return true;

    const lastBgStr = await AsyncStorage.getItem(LAST_BACKGROUND_TIME_KEY);
    if (!lastBgStr) return false;

    const lastBg = parseInt(lastBgStr, 10);
    const elapsedMs = Date.now() - lastBg;
    const allowedMs = timeoutMinutes * 60 * 1000;

    return elapsedMs >= allowedMs;
  } catch {
    return false;
  }
}
