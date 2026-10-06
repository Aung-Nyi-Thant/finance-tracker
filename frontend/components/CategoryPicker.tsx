import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { categoryLabel } from '../theme/categories';
import { useTheme } from '../theme/colors';
import { CATEGORIES, type Category } from '../types';
import { CategoryIcon } from './CategoryIcon';
import { SpringPressable } from './fx/SpringPressable';
import { SpringSheet } from './fx/SpringSheet';

interface Props {
  visible: boolean;
  selected: Category;
  onSelect: (c: Category) => void;
  onClose: () => void;
}

export function CategoryPicker({ visible, selected, onSelect, onClose }: Props) {
  const t = useTheme();
  return (
    <SpringSheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: t.text }]}>Category</Text>
      <View style={{ gap: 4 }}>
        {CATEGORIES.map((c, i) => (
          <Animated.View key={c} entering={FadeInDown.delay(60 + i * 28).springify().damping(16)}>
            <SpringPressable
              haptic="selection"
              pressedScale={0.97}
              style={[styles.row, c === selected && { backgroundColor: t.cardElevated }]}
              onPress={() => {
                onSelect(c);
                onClose();
              }}
            >
              <CategoryIcon category={c} size={42} />
              <Text style={[styles.name, { color: t.text }]}>{categoryLabel(c)}</Text>
              {c === selected && <Ionicons name="checkmark-circle" size={22} color={t.accent} />}
            </SpringPressable>
          </Animated.View>
        ))}
      </View>
    </SpringSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 8, borderRadius: 18 },
  name: { flex: 1, fontSize: 17, fontWeight: '600' },
});
