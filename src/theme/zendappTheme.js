// src/theme/zendappTheme.js
import { Platform } from 'react-native';

/**
 * Sistema de Diseño Oficial Zendapp
 * Basado en la identidad visual del logo (Rojo Escarlata + Negro Carbón + Blanco)
 */
export const zendapp = {
  colors: {
    // Brand - Rojo Escarlata / Carmesí oficial del Isotipo
    primary: '#EE272D',
    primaryHover: '#D81E24',
    primaryDark: '#C4191E',
    primaryLight: '#FEECEC',
    primaryBorder: '#F8C8CB',

    // Carbon / Estructura - Negro Carbón oficial del Isotipo
    carbon: '#1E1E1F',
    carbonDark: '#121213',
    carbonLight: '#2C2C2E',
    carbonMuted: '#48484A',
    carbonSurface: '#242426',

    // Superficies y Fondos (Translucidez Glassmorphism para dejar ver el fondo institucional)
    bg: 'transparent',
    bgGrouped: 'transparent',
    card: 'rgba(255, 255, 255, 0.88)',
    cardSolid: '#FFFFFF',
    cardTranslucent: 'rgba(255, 255, 255, 0.88)',
    cardSubtle: 'rgba(248, 249, 250, 0.75)',
    fill: 'rgba(232, 236, 242, 0.75)',
    inputBg: 'rgba(255, 255, 255, 0.92)',

    // Tipografía y Contraste
    textPrimary: '#1E1E1F',
    textSecondary: '#555E6D',
    textTertiary: '#7A8494',
    textPlaceholder: '#98A2B3',
    textWhite: '#FFFFFF',

    // Separadores y Bordes
    border: '#D8DCE4',
    borderFocus: '#EE272D',
    borderStrong: '#C4CAD5',
    separator: '#E2E6EC',

    // Estados Semánticos (Fintech)
    success: '#10B981',       // Verde esmeralda (Recaudos, Cuotas al día, Caja abierta)
    successDark: '#059669',
    successLight: '#ECFDF5',
    successBorder: '#A7F3D0',

    warning: '#F59E0B',       // Ámbar (Alerta de vencimiento, saldo pendiente)
    warningDark: '#D97706',
    warningLight: '#FFFBEB',
    warningBorder: '#FDE68A',

    danger: '#EE272D',        // Rojo Zendapp (Morosidad, Caja cerrada, reversión)
    dangerDark: '#B91C1C',
    dangerLight: '#FEF2F2',
    dangerBorder: '#FECACA',

    info: '#2563EB',          // Azul informativo
    infoLight: '#EFF6FF',
    infoBorder: '#BFDBFE',
  },

  radius: {
    xs: 6,
    s: 8,
    m: 12,
    l: 16,
    xl: 20,
    pill: 999,
  },

  spacing: {
    xs: 4,
    s: 8,
    m: 12,
    l: 16,
    xl: 20,
    xxl: 28,
    xxxl: 36,
  },

  typography: {
    display: {
      fontSize: 32,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: '#1E1E1F',
    },
    title1: {
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.3,
      color: '#1E1E1F',
    },
    title2: {
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: -0.2,
      color: '#1E1E1F',
    },
    title3: {
      fontSize: 18,
      fontWeight: '700',
      color: '#1E1E1F',
    },
    headline: {
      fontSize: 16,
      fontWeight: '700',
      color: '#1E1E1F',
    },
    body: {
      fontSize: 15,
      fontWeight: '400',
      color: '#1E1E1F',
    },
    bodyBold: {
      fontSize: 15,
      fontWeight: '600',
      color: '#1E1E1F',
    },
    subheadline: {
      fontSize: 14,
      fontWeight: '500',
      color: '#667085',
    },
    footnote: {
      fontSize: 13,
      fontWeight: '500',
      color: '#667085',
    },
    caption1: {
      fontSize: 12,
      fontWeight: '500',
      color: '#8E8E93',
    },
    captionBold: {
      fontSize: 12,
      fontWeight: '700',
      color: '#1E1E1F',
    },
    microBadge: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  },

  shadow: {
    card: Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
    cardElevated: Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
    buttonPrimary: Platform.select({
      ios: {
        shadowColor: '#EE272D',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
    buttonCarbon: Platform.select({
      ios: {
        shadowColor: '#1E1E1F',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
    fab: Platform.select({
      ios: {
        shadowColor: '#EE272D',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
    subtle: Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
  },

  border: {
    card: {
      borderWidth: 1.2,
      borderColor: '#D8DCE4',
    },
    cardHover: {
      borderWidth: 1,
      borderColor: '#EE272D',
    },
    input: {
      borderWidth: 1,
      borderColor: '#D0D5DD',
    },
    inputFocused: {
      borderWidth: 1.5,
      borderColor: '#EE272D',
    },
  },
};

export default zendapp;

