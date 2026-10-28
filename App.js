/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import * as React from 'react';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import Navigation from './src/screens/Navigation';
import { AuthProvider } from './src/context/AuthContext';
import Toast from 'react-native-toast-message';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EvaluationDataSend } from './src/utils/utilities';
import { SyncWithSupabase } from './src/utils/sync';
import { AppAlertProvider, setGlobalAlertFn, useAppAlert } from './src/components/AppAlert';

// desactivar escalado
import { Text, TextInput } from 'react-native';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;

function AppContentInner() {
  const isSyncingRef = useRef(false);
  const { showAlert } = useAppAlert();
  useEffect(() => { setGlobalAlertFn(showAlert); }, [showAlert]);

  const sincronizarDatosConServidor = async () => {
    let timeoutId;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const lock = await AsyncStorage.getItem('sincronizar');
      if (lock === 'true') return;
      const hasData = await EvaluationDataSend();
      if (!hasData) return;
      const state = await NetInfo.fetch();
      if (!state.isConnected) return;
      await AsyncStorage.setItem('sincronizar', 'true');
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('TIMEOUT_30S')), 30000);
      });
      const syncPromise = new Promise((resolve, reject) => {
        SyncWithSupabase(false, async (flag) => {
          clearTimeout(timeoutId);
          try { resolve(flag); } catch (e) { reject(e); }
        });
      });
      await Promise.race([syncPromise, timeoutPromise]);
    } catch (e) {
      console.log('Sync error', e);
    } finally {
      clearTimeout(timeoutId);
      isSyncingRef.current = false;
      await AsyncStorage.setItem('sincronizar', 'false');
    }
  };

  useEffect(() => {
    let mounted = true;
    const loop = async () => {
      while (mounted) {
        await sincronizarDatosConServidor();
        await new Promise(r => setTimeout(r, 20000));
      }
    };
    loop();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sincronizarDatosConServidor();
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <Navigation />
      <Toast position="bottom" />
    </>
  );
}

function AppContent() {
  return (
    <AppAlertProvider>
      <AppContentInner />
    </AppAlertProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
} 