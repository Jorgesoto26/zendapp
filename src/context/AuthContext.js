import { appAlert } from '../components/AppAlert';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';
import { SUPABASE_URL } from '../config/env';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDbConnection, getData } from '../database/db';

let isAuthServiceRunning = false;
export const setAuthServiceRunning = (val) => {
  isAuthServiceRunning = Boolean(val);
};
export const getAuthServiceRunning = () => isAuthServiceRunning;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = useCallback(async (userId, accessToken) => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/get-user-profile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ id: userId }),
        },
      );
      if (!response.ok) return { profile: null, caja: null };
      const result = await response.json();
      return { profile: result.profile || null, caja: result.caja || null };
    } catch {
      return { profile: null, caja: null };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const sess = await ensureAuthenticatedSession();
    if (sess?.user) {
      const { profile: p } = await fetchUserData(sess.user.id, sess.access_token);
      if (p && p.activo === false) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        appAlert('Cuenta inhabilitada', 'Tu cuenta ha sido inhabilitada por el administrador.');
        return;
      }
      if (p) setProfile(p);
    }
  }, [fetchUserData]);

  useEffect(() => {
    let mounted = true;

    const checkSessionAndCaja = async (sess, isInitial = false) => {
      if (!sess?.user) {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      try {
        const { profile: p, caja: c } = await fetchUserData(sess.user.id, sess.access_token);

        // Bloqueo inmediato de usuarios inhabilitados confirmado por el servidor
        if (p && p.activo === false) {
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoading(false);
            appAlert(
              'Cuenta inhabilitada',
              'Tu cuenta ha sido inhabilitada por el administrador. Se ha cerrado la sesión.'
            );
          }
          return;
        }

        // Si la consulta remota de perfil falló por red/offline y ya teníamos sesión o no es login inicial:
        // PRESERVAR la sesión y consultar caché/SQLite para no cerrar sesión por error de red
        let effectiveProfile = p;
        if (p) {
          try {
            await AsyncStorage.setItem('cached_profile', JSON.stringify(p));
          } catch {}
        } else {
          try {
            const pStr = await AsyncStorage.getItem('cached_profile');
            if (pStr) {
              const parsed = JSON.parse(pStr);
              if (parsed?.id === sess.user.id) {
                effectiveProfile = parsed;
              }
            }
          } catch {}
        }

        const isAdmin = effectiveProfile?.rol === 'admin' || effectiveProfile?.rol === 'superadmin';

        let tieneCaja = c && c.id && c.estado === 'abierta';
        if (!isAdmin && !tieneCaja) {
          try {
            const { data: dbCaja } = await supabase
              .from('cajas')
              .select('*')
              .eq('usuario_id', sess.user.id)
              .eq('estado', 'abierta')
              .order('fecha_apertura', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (dbCaja) tieneCaja = true;
          } catch {}
        }

        // Si aún no se detecta caja abierta en Supabase, verificar SQLite local antes de cualquier bloqueo
        if (!isAdmin && !tieneCaja) {
          try {
            const db = await getDbConnection();
            const localCajas = await getData(
              db,
              `SELECT id FROM cajas WHERE estado = 'abierta' AND (usuario_id = ? OR usuario_id IS NULL OR usuario_id = '') LIMIT 1`,
              [sess.user.id]
            );
            if (localCajas && localCajas.length > 0) tieneCaja = true;
          } catch {}
        }

        // Solo bloquear por falta de caja si es inicio de sesión inicial explícito Y no estamos en modo offline
        if (!isAdmin && !tieneCaja && isInitial && p) {
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoading(false);
            appAlert(
              'Caja requerida',
              'No tienes una caja abierta. Tu administrador debe realizar la apertura de tu caja antes de que puedas ingresar.'
            );
          }
          return;
        }

        if (mounted) {
          if (effectiveProfile) setProfile(effectiveProfile);
          setSession(sess);
          setLoading(false);
        }
      } catch (e) {
        if (mounted) {
          setSession(sess);
          setLoading(false);
        }
      }
    };

    ensureAuthenticatedSession().then((sess) => {
      if (mounted) checkSessionAndCaja(sess, true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_OUT') {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setLoading(false);
        }
      } else if (newSession) {
        // Si AuthService está ejecutando el inicio de sesión y sincronización SQLite,
        // no activar la sesión prematuramente para evitar condiciones de carrera en navegación
        if (isAuthServiceRunning) {
          return;
        }
        checkSessionAndCaja(newSession, false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchUserData]);

  const setAuthSession = useCallback((sess, p) => {
    setProfile(p || null);
    setSession(sess || null);
    setLoading(false);
    if (p) {
      AsyncStorage.setItem('cached_profile', JSON.stringify(p)).catch(() => {});
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { getPendingSyncCount } = require('../services/cajaService');
      const pendingCount = await getPendingSyncCount();
      if (pendingCount > 0) {
        appAlert(
          '¡Espera un momento!',
          `Tienes ${pendingCount} cobro(s) o movimiento(s) guardados en este teléfono que aún no se han enviado al sistema. Si sales ahora podrías perder información. Conéctate a internet y sincroniza antes de cerrar sesión.`
        );
        return false;
      }
    } catch (e) {
      console.log('Error verificando pendientes en signOut:', e);
    }

    try { await supabase.auth.signOut(); } catch (e) { console.log("offline signOut:", e); }
    try { await AsyncStorage.removeItem('cached_profile'); } catch {}
    try {
      const db = await getDbConnection();
      await db.executeSql(`UPDATE parametrizacion SET valor = NULL WHERE id IN (2, 3, 4, 5, 6, 7, 8)`);
    } catch {}
    setSession(null);
    setProfile(null);
    return true;
  }, []);

  const value = {
    session,
    profile,
    rol: profile?.rol || null,
    userId: session?.user?.id || null,
    accessToken: session?.access_token || null,
    loading,
    refreshProfile,
    signOut,
    setAuthSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
