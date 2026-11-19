// src/i18n/I18nContext.js
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

export const STORAGE_KEY_LANGUAGE = 'user_app_language';

export const SUPPORTED_LANGUAGES = [
  { code: 'es', label: 'Español', flag: '🇪🇸', description: 'Latinoamérica / España' },
  { code: 'en', label: 'English', flag: '🇺🇸', description: 'Dominican Rep, PR, USA' },
  { code: 'pt', label: 'Português', flag: '🇧🇷', description: 'Brasil' },
];

const dictionaries = { es, en, pt };

const I18nContext = createContext({
  language: 'es',
  currentLanguage: SUPPORTED_LANGUAGES[0],
  changeLanguage: async () => {},
  t: (key, params) => key,
});

/**
 * Obtiene el valor anidado en el objeto de traducción mediante notación por puntos: 'common.save'
 */
const getNestedValue = (obj, path) => {
  if (!obj || !path) return null;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return typeof current === 'string' ? current : null;
};

export const I18nProvider = ({ children }) => {
  const [language, setLanguage] = useState('es');

  // 1. Cargar idioma almacenado localmente al iniciar
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const savedLang = await AsyncStorage.getItem(STORAGE_KEY_LANGUAGE);
        if (savedLang && dictionaries[savedLang] && isMounted) {
          setLanguage(savedLang);
        }
      } catch (err) {
        console.log('Error loading saved language:', err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Función para cambiar el idioma y persistir en AsyncStorage y Supabase
  const changeLanguage = useCallback(async (newLang) => {
    if (!newLang || !dictionaries[newLang]) return;
    setLanguage(newLang);

    try {
      await AsyncStorage.setItem(STORAGE_KEY_LANGUAGE, newLang);
    } catch (e) {
      console.log('Error saving language locally:', e);
    }

    // Sincronizar en segundo plano con el perfil de Supabase si hay sesión activa
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({ idioma: newLang })
          .eq('id', userId);
      }
    } catch (errSupabase) {
      // No bloquea la ejecución si está offline
      console.log('Error syncing language to Supabase profile:', errSupabase);
    }
  }, []);

  // 3. Función de traducción interpolada: t('payments.to_visit') o t('greeting', { name: 'Juan' })
  const t = useCallback(
    (key, params = {}) => {
      const activeDict = dictionaries[language] || dictionaries.es;
      let text = getNestedValue(activeDict, key);

      // Si no existe en el idioma activo, buscar fallback en español
      if (!text && language !== 'es') {
        text = getNestedValue(dictionaries.es, key);
      }

      // Si no existe en ningún diccionario, retornar la clave original
      if (!text) return key;

      // Reemplazo de variables de interpolación: {name} -> 'Juan'
      if (params && typeof params === 'object') {
        Object.keys(params).forEach((p) => {
          text = text.replace(new RegExp(`{${p}}`, 'g'), String(params[p]));
        });
      }

      return text;
    },
    [language]
  );

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  return (
    <I18nContext.Provider
      value={{
        language,
        currentLanguage,
        changeLanguage,
        t,
        supportedLanguages: SUPPORTED_LANGUAGES,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
};

export default I18nContext;
