import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { mix, rgba } from '../../theme/fx';
import { useTheme } from '../../theme/colors';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IconName;
  color: string;
  size?: number;
  /** Gentle idle bobbing, as if floating. Keep it to a few badges per screen. */
  float?: boolean;
  /** Pressed-in / selected look. */
  active?: boolean;
  /** Stagger for the idle motion so neighbouring badges don't bob in lockstep. */
  phase?: number;
}

/**
 * Round neumorphic badge: a soft raised disc (light shadow top-left, dark shadow bottom-right), a
 * concave inner dish tinted with the category colour, and an embossed icon.
 */
export function NeuBadge({ icon, color, size = 48, float = false, active = false, phase = 0 }: Props) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (!float || reduce) return;
    bob.value = withDelay(
      phase * 260,
      withRepeat(
        withSequence(
          withTiming(-1, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
  }, [float, reduce, phase, bob]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value * size * 0.035 }],
  }));

  const base = t.isDark ? t.cardElevated : t.card;
  const highlight = t.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,1)';
  const shade = t.isDark ? 'rgba(0,0,0,0.7)' : 'rgba(110,125,160,0.55)';
  const off = size * 0.075;
  const dish = size * 0.74;

  return (
    <Animated.View style={[{ width: size, height: size }, floatStyle]}>
      {/* outer light + dark shadows (neumorphism needs both) */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.round,
          { backgroundColor: base, shadowColor: highlight, shadowOpacity: 1, shadowRadius: size * 0.16, shadowOffset: { width: -off, height: -off } },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.round,
          { backgroundColor: base, shadowColor: shade, shadowOpacity: active ? 0.4 : 1, shadowRadius: size * 0.2, shadowOffset: { width: off, height: off * 1.2 } },
        ]}
      />
      {/* raised face */}
      <LinearGradient
        colors={active ? [mix(base, '#000000', 0.18), mix(base, '#FFFFFF', 0.04)] : [mix(base, '#FFFFFF', t.isDark ? 0.1 : 0.0), mix(base, t.isDark ? '#000000' : '#8896B3', t.isDark ? 0.28 : 0.2)]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.round, styles.center, { borderWidth: StyleSheet.hairlineWidth, borderColor: t.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.9)' }]}
      >
        {/* concave inner dish, tinted by the category colour */}
        <LinearGradient
          colors={t.isDark ? [mix(color, '#000000', 0.62), mix(color, base, 0.55)] : [mix(color, '#FFFFFF', 0.12), mix(color, '#000000', 0.14)]}
          start={{ x: 0.15, y: 0.05 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.round, styles.center, { width: dish, height: dish, borderWidth: 1, borderTopColor: 'rgba(0,0,0,0.28)', borderLeftColor: 'rgba(0,0,0,0.18)', borderBottomColor: 'rgba(255,255,255,0.22)', borderRightColor: 'rgba(255,255,255,0.14)' }]}
        >
          {/* embossed icon: a dark copy underneath, the bright one on top */}
          <Ionicons name={icon} size={size * 0.38} color="rgba(0,0,0,0.35)" style={{ position: 'absolute', transform: [{ translateX: 0.8 }, { translateY: 1.4 }] }} />
          <Ionicons name={icon} size={size * 0.38} color={t.isDark ? mix(color, '#FFFFFF', 0.2) : '#FFFFFF'} />
        </LinearGradient>
        {/* specular glint */}
        <View pointerEvents="none" style={[styles.glint, { top: size * 0.08, left: size * 0.22, width: size * 0.26, height: size * 0.1, backgroundColor: rgba('#FFFFFF', t.isDark ? 0.1 : 0.55) }]} />
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  round: { borderRadius: 999 },
  center: { alignItems: 'center', justifyContent: 'center' },
  glint: { position: 'absolute', borderRadius: 999, transform: [{ rotate: '-24deg' }] },
});
