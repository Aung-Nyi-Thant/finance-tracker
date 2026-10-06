import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight, LinearTransition } from 'react-native-reanimated';
import { useMoney } from '../store/SettingsContext';
import { categoryStyle } from '../theme/categories';
import { useTheme } from '../theme/colors';
import { rgba } from '../theme/fx';
import type { Category, CategoryTotal } from '../types';
import { CategoryIcon } from './CategoryIcon';
import { SpringPressable } from './fx/SpringPressable';

interface Props {
  categories: CategoryTotal[];
  active: Category | null;
  onChange: (c: Category | null) => void;
}

/** This month's categories as tappable chips. Tapping one filters the slips feed below (tap again to clear). */
export function FilterChips({ categories, active, onChange }: Props) {
  const t = useTheme();
  const { format } = useMoney();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroll}>
      {categories.map((c, i) => {
        const { color, label } = categoryStyle(c.category);
        const selected = active === c.category;
        return (
          <Animated.View key={c.category} entering={FadeInRight.delay(i * 55).springify().damping(15)} layout={LinearTransition.springify().damping(18)}>
            <SpringPressable
              haptic="selection"
              pressedScale={0.94}
              onPress={() => onChange(selected ? null : c.category)}
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? rgba(color, t.isDark ? 0.2 : 0.14) : t.card,
                  borderColor: selected ? color : t.border,
                  shadowColor: selected ? color : t.shadow,
                  shadowOpacity: selected ? 0.55 : t.isDark ? 0.3 : 0.08,
                  shadowRadius: selected ? 14 : 10,
                  shadowOffset: { width: 0, height: selected ? 6 : 4 },
                },
              ]}
            >
              <CategoryIcon category={c.category} size={38} />
              <View>
                <Text style={[styles.name, { color: selected ? color : t.textSecondary }]}>{label}</Text>
                <Text style={[styles.amount, { color: t.text }]}>{format(c.total)}</Text>
              </View>
            </SpringPressable>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -20 },
  row: { paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingLeft: 10, paddingRight: 16, borderRadius: 26, borderWidth: 1 },
  name: { fontSize: 12, fontWeight: '700' },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 1 },
});
