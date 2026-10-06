import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTransactions } from '../store/TransactionsContext';
import type { Impact } from '../types';
import { useTheme } from '../theme/colors';
import { AMBER } from '../theme/severity';
import { GlassView } from './fx/GlassView';
import { SpringPressable } from './fx/SpringPressable';

/** Glass toast that drops in with a spring after a slip is saved and says what it did to the budget. */
export function Toast() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { notice, dismissNotice } = useTransactions();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = notice ? withSpring(1, { damping: 13, stiffness: 190, mass: 0.8 }) : withTiming(0, { duration: 220 });
  }, [notice, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -70 }, { scale: 0.92 + progress.value * 0.08 }],
  }));

  const shown = useShown(notice);
  if (!shown) return null;
  const color = shown.status === 'over' ? t.danger : shown.status === 'warning' ? AMBER : t.positive;

  return (
    <Animated.View pointerEvents={notice ? 'auto' : 'none'} style={[styles.wrap, { top: insets.top + 8 }, style]}>
      <SpringPressable onPress={dismissNotice} haptic={false} pressedScale={0.97} style={[styles.shadow, { shadowColor: color }]}>
        <GlassView radius={22} intensity={60} veil={t.isDark ? 0.06 : 0.55} style={styles.toast}>
          <Ionicons name={shown.status === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={24} color={color} />
          <Text style={[styles.text, { color: t.text }]} numberOfLines={3}>
            <Text style={{ fontWeight: '800' }}>Saved. </Text>
            {shown.message}
          </Text>
        </GlassView>
      </SpringPressable>
    </Animated.View>
  );
}

/** Keeps the last non-null value so the toast can finish sliding out with its content intact. */
function useShown(value: Impact | null): Impact | null {
  const ref = useRef<Impact | null>(value);
  if (value) ref.current = value;
  return ref.current;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 50 },
  shadow: { borderRadius: 22, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  text: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '500' },
});
