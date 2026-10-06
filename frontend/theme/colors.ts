import { useColorScheme, type ViewStyle } from 'react-native';

export interface Palette {
  background: string;
  card: string;
  cardElevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  accent: string;
  accentText: string;
  positive: string;
  danger: string;
  skeleton: string;
  shadow: string;
  gradient: [string, string, string];
  isDark: boolean;
}

export const darkPalette: Palette = {
  background: '#0A0F1E',
  card: '#121A2E',
  cardElevated: '#1A2440',
  text: '#FFFFFF',
  textSecondary: '#9AA4BA',
  textTertiary: '#6A748D',
  border: 'rgba(255,255,255,0.07)',
  accent: '#7C8CFF',
  accentText: '#0A0F1E',
  positive: '#34D399',
  danger: '#F87171',
  skeleton: '#222C47',
  shadow: '#000000',
  gradient: ['#3446D4', '#5B3FD0', '#8A3FC8'],
  isDark: true,
};

export const lightPalette: Palette = {
  background: '#F3F5FA',
  card: '#FFFFFF',
  cardElevated: '#F6F8FC',
  text: '#0A0F1E',
  textSecondary: '#586279',
  textTertiary: '#8E97AB',
  border: 'rgba(10,15,30,0.07)',
  accent: '#4F5FE0',
  accentText: '#FFFFFF',
  positive: '#059669',
  danger: '#DC2626',
  skeleton: '#E3E7F0',
  shadow: '#2A3558',
  gradient: ['#4357E8', '#6A47E0', '#9446D2'],
  isDark: false,
};

export function useTheme(): Palette {
  return useColorScheme() === 'light' ? lightPalette : darkPalette;
}

export const radius = { sm: 12, md: 16, lg: 22, xl: 28 } as const;

/** Soft elevated card: hairline border + a gentle shadow that reads in both themes. */
export function cardStyle(t: Palette, r: number = radius.lg): ViewStyle {
  return {
    backgroundColor: t.card,
    borderRadius: r,
    borderWidth: 1,
    borderColor: t.border,
    shadowColor: t.shadow,
    shadowOpacity: t.isDark ? 0.35 : 0.08,
    shadowRadius: t.isDark ? 18 : 16,
    shadowOffset: { width: 0, height: t.isDark ? 8 : 6 },
  };
}

/** Translucent tint of a colour, e.g. for badge and icon backgrounds. */
export function tint(color: string, t: Palette, strength: 'soft' | 'strong' = 'soft'): string {
  const alpha = strength === 'soft' ? (t.isDark ? 0.16 : 0.12) : t.isDark ? 0.28 : 0.2;
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${color}${a}`;
}
