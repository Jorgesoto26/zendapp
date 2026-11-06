import { Platform } from 'react-native';

// Paleta Zenda - identidad propia (no Apple genérico)
export const zenda = {
  colors: {
    // Brand
    navy: '#0F1A2E',
    navyLight: '#1A2B4A',
    gold: '#C9A86A',
    goldDark: '#A88A4A',
    goldLight: '#F5E6C8',
    // Neutrals cálidos
    bg: '#F8F7F5',
    bgCard: '#FFFFFF',
    ink: '#1A1E2E',
    inkMuted: '#6B7280',
    inkFaint: '#9CA3AF',
    line: '#E8E6E1',
    lineStrong: '#D1CCC4',
    // Accent funcional
    success: '#0E7A5A',
    warning: '#C77A0F',
    danger: '#B91C1C',
    info: '#1E5A8A',
  },
  radius: { xs: 6, s: 8, m: 12, l: 16, xl: 20, pill: 999 },
  shadow: {
    soft: Platform.select({ ios: { shadowColor: '#0F1A2E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 }, android: { elevation: 0 }, default: {} }),
    card: Platform.select({ ios: { shadowColor: '#0F1A2E', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16 }, android: { elevation: 0 }, default: {} }),
  },
  font: {
    display: { fontFamily: 'System', fontWeight: '800' },
    title: { fontWeight: '700' },
    body: { fontWeight: '500' },
  },
};
