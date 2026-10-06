import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight, LinearTransition, useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useMoney } from '../store/SettingsContext';
import { categoryStyle, categoryLabel } from '../theme/categories';
import { cardStyle, useTheme, radius } from '../theme/colors';
import { mix } from '../theme/fx';
import { AMBER, budgetColor } from '../theme/severity';
import type { Budget } from '../types';
import { NeuBadge } from './fx/NeuBadge';
import { SpringPressable } from './fx/SpringPressable';
import { ParallaxLayer, TiltCard } from './fx/TiltCard';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const CARD_W = 172;
const CARD_H = 204;
const RING = 66;
const STROKE = 8;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

/** Progress ring that springs to its new value whenever the budget changes. */
function Ring({ percent, color, track }: { percent: number; color: string; track: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(Math.min(percent, 100) / 100, { damping: 15, stiffness: 80, mass: 1 });
  }, [percent, progress]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - progress.value) }));
  return (
    <Svg width={RING} height={RING}>
      <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={track} strokeWidth={STROKE} fill="none" />
      <AnimatedCircle
        cx={RING / 2}
        cy={RING / 2}
        r={R}
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${C} ${C}`}
        animatedProps={props}
        fill="none"
        rotation={-90}
        origin={`${RING / 2}, ${RING / 2}`}
      />
    </Svg>
  );
}

function BudgetCard({ budget, index, onPress }: { budget: Budget; index: number; onPress: () => void }) {
  const t = useTheme();
  const { format } = useMoney();
  const isTotal = budget.category === 'Total';
  const cs = isTotal ? null : categoryStyle(budget.category);
  const accent = cs?.color ?? t.accent;
  const color = budgetColor(budget.status, accent, t);
  const left = budget.monthly_limit - budget.spent;

  const faceTop = t.isDark ? mix(t.card, '#FFFFFF', 0.07) : '#FFFFFF';
  const faceBottom = t.isDark ? mix(t.card, '#000000', 0.25) : mix('#FFFFFF', '#C9D3E8', 0.45);

  return (
    <Animated.View entering={FadeInRight.delay(index * 70).springify().damping(15)} layout={LinearTransition.springify().damping(18)}>
      <SpringPressable onPress={onPress} haptic="selection" pressedScale={0.98}>
        <TiltCard radius={radius.xl} baseColor={t.card} glowColor={color} dark={t.isDark} style={{ width: CARD_W, height: CARD_H }} faceStyle={{ width: CARD_W, height: CARD_H }} maxTilt={11}>
          <LinearGradient colors={[faceTop, faceBottom]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={styles.inner}>
            <View style={styles.top}>
              <ParallaxLayer depth={16}>
                {isTotal ? <NeuBadge icon="wallet" color={t.accent} size={50} float phase={index} /> : <NeuBadge icon={cs!.icon} color={cs!.color} size={50} float phase={index} />}
              </ParallaxLayer>
              <ParallaxLayer depth={8} style={styles.ringWrap}>
                <Ring percent={budget.percent} color={color} track={t.skeleton} />
                <View style={styles.ringCenter} pointerEvents="none">
                  <Text style={[styles.pct, { color: t.text }]}>{Math.round(budget.percent)}%</Text>
                </View>
              </ParallaxLayer>
            </View>

            <ParallaxLayer depth={5} style={styles.bottom}>
              <Text style={[styles.name, { color: t.textSecondary }]} numberOfLines={1}>
                {isTotal ? 'Monthly budget' : categoryLabel(budget.category)}
              </Text>
              <Text style={[styles.left, { color: left < 0 ? t.danger : t.text }]} numberOfLines={1} adjustsFontSizeToFit>
                {left < 0 ? `${format(-left)} over` : `${format(left)} left`}
              </Text>
              <View style={styles.footRow}>
                <Text style={[styles.of, { color: t.textTertiary }]} numberOfLines={1}>
                  of {format(budget.monthly_limit)}
                </Text>
                {budget.status !== 'ok' && (
                  <Ionicons name={budget.status === 'over' ? 'alert-circle' : 'warning'} size={15} color={budget.status === 'over' ? t.danger : AMBER} />
                )}
              </View>
            </ParallaxLayer>
          </View>
        </TiltCard>
      </SpringPressable>
    </Animated.View>
  );
}

interface Props {
  budgets: Budget[];
  onEdit: () => void;
}

/** Horizontal strip of 3D budget cards (overall first), or a call to action when none are set. */
export function BudgetCards({ budgets, onEdit }: Props) {
  const t = useTheme();
  const ordered = [...budgets].sort((a, b) => (a.category === 'Total' ? -1 : b.category === 'Total' ? 1 : b.percent - a.percent));

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Budgets</Text>
        <SpringPressable onPress={onEdit} haptic="selection" hitSlop={10}>
          <Text style={[styles.edit, { color: t.accent }]}>{ordered.length ? 'Edit' : 'Set up'}</Text>
        </SpringPressable>
      </View>
      {ordered.length === 0 ? (
        <SpringPressable onPress={onEdit} pressedScale={0.98} style={[styles.cta, cardStyle(t, radius.xl)]}>
          <NeuBadge icon="speedometer" color={t.accent} size={52} float />
          <View style={{ flex: 1 }}>
            <Text style={[styles.ctaTitle, { color: t.text }]}>Set a spending limit</Text>
            <Text style={[styles.ctaBody, { color: t.textSecondary }]}>Track the whole month or any category, and get alerted before you overspend.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={t.textTertiary} />
        </SpringPressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} style={styles.stripScroll} decelerationRate="fast" snapToInterval={CARD_W + 14}>
          {ordered.map((b, i) => (
            <BudgetCard key={b.category} budget={b} index={i} onPress={onEdit} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  edit: { fontSize: 14, fontWeight: '700' },
  // The scroll view clips children, so pad it enough to hold the cards' soft shadows, then pull the layout back.
  stripScroll: { marginHorizontal: -20, marginTop: -34, marginBottom: -52 },
  strip: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 78, gap: 14 },
  inner: { flex: 1, padding: 16, justifyContent: 'space-between' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute' },
  pct: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bottom: { gap: 2 },
  name: { fontSize: 13, fontWeight: '700' },
  left: { fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 1 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  of: { fontSize: 12, fontWeight: '600', flex: 1 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  ctaTitle: { fontSize: 16, fontWeight: '800' },
  ctaBody: { fontSize: 13, lineHeight: 18, marginTop: 3 },
});
