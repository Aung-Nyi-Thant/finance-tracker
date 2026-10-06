import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { cardStyle, useTheme } from '../theme/colors';
import { severityStyle } from '../theme/severity';
import type { Advice } from '../types';
import { lineHeightFor } from '../utils/text';
import { SpringPressable } from './fx/SpringPressable';

/** Dashboard teaser for the AI assistant: headline + the most important tip. */
export function InsightCard({ advice }: { advice: Advice }) {
  const t = useTheme();
  const router = useRouter();
  const top = advice.tips[0];
  const { color } = top ? severityStyle(top.severity, t) : { color: t.accent };

  return (
    <SpringPressable onPress={() => router.navigate('/assistant')} haptic="selection" pressedScale={0.98} style={[styles.card, cardStyle(t, 26)]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: `${t.accent}22` }]}>
          <Ionicons name="sparkles" size={14} color={t.accent} />
          <Text style={[styles.badgeText, { color: t.accent }]}>{advice.source === 'ai' ? 'AI insight' : 'Insight'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textTertiary} />
      </View>
      <Text style={[styles.headline, { color: t.text, lineHeight: lineHeightFor(advice.headline, 17, 1.35) }]}>{advice.headline}</Text>
      {top && (
        <View style={styles.tipRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.tip, { color: t.textSecondary, lineHeight: lineHeightFor(top.body, 14, 1.43) }]} numberOfLines={2}>
            {top.body}
          </Text>
        </View>
      )}
    </SpringPressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
  tipRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  tip: { flex: 1, fontSize: 14 },
});
