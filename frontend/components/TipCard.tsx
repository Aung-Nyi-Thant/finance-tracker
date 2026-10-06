import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { cardStyle, useTheme } from '../theme/colors';
import { severityStyle } from '../theme/severity';
import type { Tip } from '../types';
import { lineHeightFor } from '../utils/text';
import { NeuBadge } from './fx/NeuBadge';

export function TipCard({ tip, index = 0 }: { tip: Tip; index?: number }) {
  const t = useTheme();
  const { color, icon } = severityStyle(tip.severity, t);
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 70).springify().damping(15)} layout={LinearTransition.springify().damping(18)} style={[styles.card, cardStyle(t, 24)]}>
      <View style={[styles.accent, { backgroundColor: color }]} />
      <NeuBadge icon={icon} color={color} size={46} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.text, lineHeight: lineHeightFor(tip.title, 15, 1.3) }]}>{tip.title}</Text>
        <Text style={[styles.body, { color: t.textSecondary, lineHeight: lineHeightFor(tip.body, 14, 1.43) }]}>{tip.body}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 14 },
});
