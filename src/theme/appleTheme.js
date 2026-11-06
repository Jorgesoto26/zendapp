import { Platform } from 'react-native';
import { zendapp } from './zendappTheme';

/**
 * Tema compatible Zendapp
 * Mapea las propiedades históricas (apple.*) hacia los tokens oficiales de la marca Zendapp
 */
export const apple = {
  colors: {
    // Backgrounds
    bg: zendapp.colors.bg,
    bgGrouped: zendapp.colors.bgGrouped,
    card: zendapp.colors.card,

    // Accent - Zendapp Brand Red (#EE272D)
    blue: zendapp.colors.primary,
    bluePressed: zendapp.colors.primaryDark,
    blueLight: zendapp.colors.primaryLight,
    brandRed: zendapp.colors.primary,

    // Carbon / Oscuros
    carbon: zendapp.colors.carbon,
    carbonDark: zendapp.colors.carbonDark,

    // Semántica Fintech
    success: zendapp.colors.success,
    warning: zendapp.colors.warning,
    danger: zendapp.colors.danger,

    // Neutros y Tipografía
    label: zendapp.colors.textPrimary,
    secondaryLabel: zendapp.colors.textSecondary,
    tertiaryLabel: zendapp.colors.textTertiary,
    separator: zendapp.colors.border,
    separator2: zendapp.colors.borderStrong,
    fill: zendapp.colors.fill,

    // Tab bar
    tabBg: '#FFFFFF',
    tabActive: zendapp.colors.primary,
    tabInactive: '#98A2B3',
  },
  radius: zendapp.radius,
  spacing: zendapp.spacing,
  typography: zendapp.typography,
  shadow: zendapp.shadow,
  border: {
    hairline: 1,
    card: zendapp.border.card,
  },
};

export { zendapp };
export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };
