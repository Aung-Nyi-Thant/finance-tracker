import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useAutoImport } from '../store/AutoImportContext';
import { cardStyle, useTheme } from '../theme/colors';
import { NeuBadge } from './fx/NeuBadge';
import { SpringPressable } from './fx/SpringPressable';
import { PrimaryButton } from './PrimaryButton';

function ago(ms: number | null): string {
  if (!ms) return 'Checking…';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'Checked just now';
  if (s < 60) return `Checked ${s}s ago`;
  return `Checked ${Math.round(s / 60)}m ago`;
}

/** Status of the automatic screenshot import — replaces the old "pick a photo" buttons. */
export function AutoImportCard() {
  const t = useTheme();
  const { access, watching, importing, error, lastScanAt, enable, disable } = useAutoImport();

  if (access === 'none') {
    return (
      <View style={[styles.card, cardStyle(t, 26)]}>
        <Header icon="lock-closed" color={t.danger} title="Photo access is off" t={t} />
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Allow Photos access in Settings so payment screenshots can be detected automatically.
        </Text>
        <PrimaryButton title="Open Settings" onPress={() => Linking.openSettings()} variant="secondary" />
      </View>
    );
  }

  if (!watching) {
    return (
      <View style={[styles.card, cardStyle(t, 26)]}>
        <Header icon="sparkles" color={t.accent} title="Auto-import screenshots" t={t} />
        <Text style={[styles.body, { color: t.textSecondary }]}>
          When you screenshot a payment slip, it's detected the next time you open the app, read by AI and waiting
          here for one tap. Only screenshots taken from now on are checked, and each is sent to your own backend.
        </Text>
        <PrimaryButton title="Turn on" onPress={enable} />
      </View>
    );
  }

  return (
    <View style={[styles.card, cardStyle(t, 26)]}>
      <View style={styles.statusRow}>
        <Pulse color={error ? t.danger : t.positive} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]}>
            {importing > 0 ? 'Reading receipt…' : error ? 'Auto-import needs attention' : 'Watching for screenshots'}
          </Text>
          <Text style={[styles.sub, { color: error ? t.danger : t.textSecondary }]} numberOfLines={2}>
            {error ?? (importing > 0 ? 'Hang tight, this takes a few seconds' : ago(lastScanAt))}
          </Text>
        </View>
        {importing > 0 ? (
          <ActivityIndicator color={t.accent} />
        ) : (
          <SpringPressable onPress={disable} hitSlop={10} haptic="selection">
            <Text style={[styles.off, { color: t.textTertiary }]}>Turn off</Text>
          </SpringPressable>
        )}
      </View>
      {access === 'limited' && (
        <Text style={[styles.warn, { color: t.textSecondary }]}>
          Photos access is limited, so new screenshots may be missed. Allow full access in Settings.
        </Text>
      )}
    </View>
  );
}

function Header({ icon, color, title, t }: { icon: any; color: string; title: string; t: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.header}>
      <NeuBadge icon={icon} color={color} size={44} float />
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
    </View>
  );
}

/** Soft breathing dot: green while watching, red when something needs attention. */
function Pulse({ color }: { color: string }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    v.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
  }, [reduce, v]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - v.value), transform: [{ scale: 1 + v.value * 1.8 }] }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color }, ring]} />
      <View style={[styles.pulse, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pulseWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  pulseRing: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  sub: { fontSize: 13, marginTop: 2 },
  off: { fontSize: 13, fontWeight: '600' },
  warn: { fontSize: 12, lineHeight: 17 },
});
