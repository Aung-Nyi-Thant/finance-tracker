import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/colors';
import { RadialGlow } from './RadialGlow';

/** Soft coloured light pools behind a screen's content, so cards sit in a lit space instead of on flat fill. */
export function AmbientBackground() {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <RadialGlow size={520} color={t.gradient[0]} intensity={t.isDark ? 0.34 : 0.22} style={{ position: 'absolute', top: -170, right: -190 }} />
      <RadialGlow size={460} color={t.gradient[2]} intensity={t.isDark ? 0.24 : 0.16} style={{ position: 'absolute', top: 360, left: -230 }} />
      <RadialGlow size={420} color={t.accent} intensity={t.isDark ? 0.16 : 0.1} style={{ position: 'absolute', bottom: -120, right: -140 }} />
    </View>
  );
}
