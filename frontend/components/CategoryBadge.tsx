import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { categoryStyle } from '../theme/categories';
import { tint, useTheme } from '../theme/colors';

/** Small pill with the category's icon and name on a soft tinted background. */
export function CategoryBadge({ category, compact }: { category: string; compact?: boolean }) {
  const t = useTheme();
  const { icon, color, label } = categoryStyle(category);
  return (
    <View style={[styles.pill, compact && styles.compact, { backgroundColor: tint(color, t) }]}>
      <Ionicons name={icon} size={compact ? 11 : 13} color={color} />
      <Text style={[styles.text, compact && styles.textCompact, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  compact: { paddingHorizontal: 7, paddingVertical: 3, gap: 4 },
  text: { fontSize: 12, fontWeight: '700' },
  textCompact: { fontSize: 11 },
});
