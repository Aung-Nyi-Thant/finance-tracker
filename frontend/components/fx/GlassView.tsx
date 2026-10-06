import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/colors';

interface Props {
  children?: ReactNode;
  intensity?: number;
  radius?: number;
  /** Force a tint regardless of theme (e.g. "light" glass sitting on a saturated gradient). */
  tint?: 'light' | 'dark' | 'default';
  /** Extra white veil, 0-1, to lift the glass off the background. */
  veil?: number;
  style?: StyleProp<ViewStyle>;
}

/** Frosted glass: blurred backdrop, a faint white veil, and a bright hairline rim. */
export function GlassView({ children, intensity = 40, radius = 18, tint, veil = 0.08, style }: Props) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <BlurView intensity={intensity} tint={tint ?? (t.isDark ? 'dark' : 'light')} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255,255,255,${veil})` }]} />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.45)',
            borderLeftColor: 'rgba(255,255,255,0.28)',
            borderRightColor: 'rgba(255,255,255,0.1)',
            borderBottomColor: 'rgba(255,255,255,0.08)',
          },
        ]}
      />
      {children}
    </View>
  );
}
