import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useMoney } from '../store/SettingsContext';
import { useTheme } from '../theme/colors';
import type { Summary } from '../types';
import { formatMonth } from '../utils/format';
import { DonutRing } from './DonutRing';
import { GlassView } from './fx/GlassView';
import { RadialGlow } from './fx/RadialGlow';
import { SpringPressable } from './fx/SpringPressable';
import { ParallaxLayer, TiltCard } from './fx/TiltCard';

interface Props {
  summary: Summary | null;
  /** The month being shown, "YYYY-MM" (shown immediately, before the data for it has loaded). */
  month?: string;
  canGoNext?: boolean;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  onCurrencyPress: () => void;
  onBudgetPress: () => void;
}

/**
 * The hero card. Touch and drag it: it tilts in 3D, its highlight follows your finger, and the layers
 * (light orbs, text, glass tiles, spending ring) slide at different depths for parallax.
 */
export function SummaryCard({ summary, month, canGoNext = false, onPrevMonth, onNextMonth, onCurrencyPress, onBudgetPress }: Props) {
  const t = useTheme();
  const { format, split, currency } = useMoney();

  const shownMonth = month ?? summary?.month;
  const total = summary?.total_spent ?? 0;
  const income = summary?.total_income ?? 0;
  const count = summary?.transaction_count ?? 0;
  const budget = summary?.total_budget ?? null;
  const percent = Math.min(summary?.total_budget_percent ?? 0, 100);
  const status = summary?.total_status;
  const remaining = budget !== null ? budget - total : 0;
  const barColor = status === 'over' ? '#FCA5A5' : status === 'warning' ? '#FDE68A' : '#FFFFFF';

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withSpring(percent, { damping: 16, stiffness: 70, mass: 1 });
  }, [percent, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));

  const [whole, fraction] = split(total);

  return (
    <TiltCard radius={32} baseColor={t.gradient[1]} glowColor={t.gradient[2]} dark={t.isDark} maxTilt={8}>
      <LinearGradient colors={t.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {/* deepest layer: lighting */}
      <ParallaxLayer depth={-9} style={StyleSheet.absoluteFill}>
        <RadialGlow size={340} color="#FFFFFF" intensity={0.3} style={{ position: 'absolute', right: -110, top: -140 }} />
        <RadialGlow size={300} color={t.gradient[0]} intensity={0.6} style={{ position: 'absolute', left: -120, bottom: -130 }} />
      </ParallaxLayer>

      <View style={styles.content}>
        <ParallaxLayer depth={5} style={styles.topRow}>
          <View style={styles.pill}>
            <SpringPressable onPress={onPrevMonth} disabled={!onPrevMonth} hitSlop={10} haptic="selection" accessibilityLabel="Previous month">
              <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
            </SpringPressable>
            <Text style={styles.pillText}>{shownMonth ? formatMonth(shownMonth) : 'This month'}</Text>
            <SpringPressable
              onPress={onNextMonth}
              disabled={!canGoNext || !onNextMonth}
              hitSlop={10}
              haptic="selection"
              accessibilityLabel="Next month"
              style={{ opacity: canGoNext ? 1 : 0.3 }}
            >
              <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
            </SpringPressable>
          </View>
          <SpringPressable onPress={onCurrencyPress} hitSlop={8} accessibilityLabel={`Currency ${currency}. Tap to change`} style={styles.pill}>
            <Text style={styles.pillText}>{currency}</Text>
            <Ionicons name="chevron-down" size={12} color="#FFFFFF" />
          </SpringPressable>
        </ParallaxLayer>

        <ParallaxLayer depth={13}>
          <Text style={styles.label}>Total spent</Text>
          <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
            {whole}
            {fraction ? <Text style={styles.fraction}>{fraction}</Text> : null}
          </Text>
        </ParallaxLayer>

        <ParallaxLayer depth={8}>
          {budget !== null ? (
            <View style={styles.budgetBlock}>
              <View style={styles.budgetRow}>
                <Text style={styles.budgetLeft}>
                  {remaining >= 0 ? (
                    <>
                      <Text style={styles.budgetStrong}>{format(remaining)}</Text> left of {format(budget)}
                    </>
                  ) : (
                    <>
                      <Text style={[styles.budgetStrong, { color: '#FCA5A5' }]}>{format(-remaining)} over</Text> your {format(budget)} budget
                    </>
                  )}
                </Text>
                <SpringPressable onPress={onBudgetPress} hitSlop={10} haptic="selection">
                  <Text style={styles.edit}>Edit</Text>
                </SpringPressable>
              </View>
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { backgroundColor: barColor }, fillStyle]} />
              </View>
              <Text style={styles.percent}>{Math.round(summary?.total_budget_percent ?? 0)}% of monthly budget used</Text>
            </View>
          ) : (
            <SpringPressable onPress={onBudgetPress} style={styles.setBudget}>
              <Ionicons name="speedometer" size={16} color="#FFFFFF" />
              <Text style={styles.setBudgetText}>Set a monthly budget</Text>
              <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
            </SpringPressable>
          )}
        </ParallaxLayer>

        <View style={styles.bottom}>
          <ParallaxLayer depth={18} style={styles.ringShadow}>
            <DonutRing categories={summary?.categories ?? []} total={total} />
          </ParallaxLayer>
          <ParallaxLayer depth={10} style={styles.stats}>
            <GlassView tint="dark" intensity={34} veil={0.1} radius={18} style={styles.stat}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(110,231,183,0.28)' }]}>
                <Ionicons name="arrow-down" size={14} color="#6EE7B7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statLabel}>Income</Text>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                  +{format(income)}
                </Text>
              </View>
            </GlassView>
            <GlassView tint="dark" intensity={34} veil={0.1} radius={18} style={styles.stat}>
              <View style={styles.statIcon}>
                <Ionicons name="receipt" size={14} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statLabel}>Slips</Text>
                <Text style={styles.statValue}>{count}</Text>
              </View>
            </GlassView>
          </ParallaxLayer>
        </View>
      </View>
    </TiltCard>
  );
}

const styles = StyleSheet.create({
  content: { padding: 22 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  pillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  label: { color: 'rgba(255,255,255,0.74)', fontSize: 14, fontWeight: '600', marginTop: 22 },
  total: { color: '#FFFFFF', fontSize: 46, fontWeight: '800', marginTop: 2, letterSpacing: -0.5, fontVariant: ['tabular-nums'], textShadowColor: 'rgba(20,10,80,0.35)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 10 },
  fraction: { fontSize: 24, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  budgetBlock: { marginTop: 16 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetLeft: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500', flex: 1 },
  budgetStrong: { color: '#FFFFFF', fontWeight: '800' },
  edit: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  track: { height: 11, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.22)', overflow: 'hidden', marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  fill: { height: '100%', borderRadius: 6 },
  percent: { color: 'rgba(255,255,255,0.68)', fontSize: 12, fontWeight: '600', marginTop: 7 },
  setBudget: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, marginTop: 16 },
  setBudgetText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  ringShadow: { shadowColor: '#0B0630', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 10 } },
  stats: { flex: 1, gap: 10 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11 },
  statIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 1 },
});
