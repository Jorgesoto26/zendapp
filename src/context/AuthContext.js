import { appAlert } from '../components/AppAlert';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = useCallback(async (userId, accessToken) => {
    try {
      const response = await fetch(
        'https://gwpwntdwogxzmtegaaom.supabase.co/functions/v1/get-user-profile',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
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
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      const { profile: p } = await fetchUserData(data.session.user.id, data.session.access_token);
      if (p && p.activo === false) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        appAlert('Cuenta inhabilitada', 'Tu cuenta ha sido inhabilitada por el administrador.');
        return;
      }
      setProfile(p);
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

        // Bloqueo inmediato de usuarios inhabilitados
        if (p && p.activo === false) {
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoading(false);
            appAlert(
              'Cuenta inhabilitada',
              'Tu cuenta ha sido inhabilitada por el administrador. Se ha cerrado la sesin.'
            );
          }
          return;
        }

        const isAdmin = p?.rol === 'admin' || p?.rol === 'superadmin';

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

        if (!isAdmin && !tieneCaja) {
          // Bloquear vendedor sin caja abierta
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoading(false);
            if (isInitial) {
              appAlert(
                'Caja requerida',
                'No tienes una caja abierta. Tu administrador debe realizar la apertura de tu caja antes de que puedas ingresar.'
              );
            }
          }
          return;
        }

        if (mounted) {
          setProfile(p);
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

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) checkSessionAndCaja(data.session, true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_OUT') {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setLoading(false);
        }
      } else if (newSession) {
        // En SIGNED_IN AuthService hace la validación primaria, aquí aseguramos la sesión
        checkSessionAndCaja(newSession, false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchUserData]);

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

    await supabase.auth.signOut();
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
