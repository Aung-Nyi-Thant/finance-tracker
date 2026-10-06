import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/colors';
import { SkeletonBlock } from './SkeletonBlock';

/** Placeholder card shown while the backend is reading a freshly detected receipt. */
export function PendingSkeleton() {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.top}>
        <SkeletonBlock width={56} height={56} radius={14} />
        <View style={{ flex: 1, gap: 10 }}>
          <SkeletonBlock width="60%" height={18} radius={8} />
          <SkeletonBlock width="35%" height={14} radius={7} />
        </View>
        <SkeletonBlock width={70} height={22} radius={8} />
      </View>
      <SkeletonBlock height={48} radius={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
