// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: AsyncStorage,
  },
});

/**
 * Obtiene una sesión válida, renovando el token automáticamente si está expirado o próximo a expirar.
 * Evita fallos de "No autenticado" por sesiones desfasadas o timers dormidos en móvil.
 */
export async function ensureAuthenticatedSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (session) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (session.expires_at && session.expires_at < nowSec + 120) {
        console.log('Token de sesión próximo a expirar o expirado, renovando con Supabase...');
        const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
        if (!refreshErr && refreshData?.session) {
          return refreshData.session;
        }
      }
      return session;
    }

    // Si getSession devuelve null, intentar recuperar/renovar desde el refresh token persistido
    const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr && refreshData?.session) {
      return refreshData.session;
    }
  } catch (err) {
    console.log('ensureAuthenticatedSession error:', err);
  }
  return null;
}
