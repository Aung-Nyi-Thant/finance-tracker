import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '../theme/colors';
import { AMBER } from '../theme/severity';
import type { Alert } from '../types';

/** Budget limit alerts from the summary API (approaching = amber, exceeded = red). */
export function AlertBanner({ alerts }: { alerts: Alert[] }) {
  const t = useTheme();
  if (!alerts.length) return null;
  const shown = alerts.slice(0, 2);
  return (
    <View style={styles.wrap}>
      {shown.map((a, i) => {
        const color = a.level === 'over' ? t.danger : AMBER;
        return (
          <Animated.View
            key={`${a.category ?? 'total'}-${i}`}
            entering={FadeInDown.delay(i * 70).springify().damping(15)}
            layout={LinearTransition.springify()}
            style={[styles.row, { backgroundColor: `${color}1A`, borderColor: `${color}55` }]}
          >
            <Ionicons name={a.level === 'over' ? 'alert-circle' : 'warning'} size={20} color={color} />
            <Text style={[styles.text, { color: t.text }]}>{a.message}</Text>
          </Animated.View>
        );
      })}
      {alerts.length > shown.length && (
        <Text style={[styles.more, { color: t.textSecondary }]}>
          +{alerts.length - shown.length} more budget {alerts.length - shown.length === 1 ? 'alert' : 'alerts'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1 },
  more: { fontSize: 13, fontWeight: '600', marginLeft: 4 },
  text: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 19 },
});
