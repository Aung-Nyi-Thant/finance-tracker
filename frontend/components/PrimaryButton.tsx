import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { mix } from '../theme/fx';
import { useTheme } from '../theme/colors';
import { SpringPressable } from './fx/SpringPressable';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
}

/** Springy button. Primary is a lit, glowing gradient slab; secondary is a quiet raised pill. */
export function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', style }: Props) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <SpringPressable
      onPress={onPress}
      disabled={disabled || loading}
      pressedScale={0.96}
      style={[
        styles.btn,
        { opacity: disabled ? 0.45 : 1 },
        primary
          ? { shadowColor: t.accent, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 9 } }
          : { shadowColor: t.shadow, shadowOpacity: t.isDark ? 0.4 : 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
        style,
      ]}
    >
      <LinearGradient
        colors={primary ? [mix(t.accent, '#FFFFFF', 0.22), t.accent, mix(t.accent, '#000000', 0.18)] : [t.cardElevated, t.card]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[styles.fill, { borderColor: primary ? 'rgba(255,255,255,0.35)' : t.border }]}
      >
        <View style={styles.sheen} pointerEvents="none" />
        {loading ? (
          <ActivityIndicator color={primary ? t.accentText : t.text} />
        ) : (
          <Text style={[styles.label, { color: primary ? t.accentText : t.text }]}>{title}</Text>
        )}
      </LinearGradient>
    </SpringPressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 56, borderRadius: 20 },
  fill: { flex: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%', backgroundColor: 'rgba(255,255,255,0.12)' },
  label: { fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
});
