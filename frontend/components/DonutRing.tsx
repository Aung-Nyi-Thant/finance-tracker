import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { categoryStyle } from '../theme/categories';
import type { CategoryTotal } from '../types';

interface Props {
  categories: CategoryTotal[];
  total: number;
  size?: number;
  stroke?: number;
}

const GAP = 2.5;

/**
 * Category share of the month's spending as a ring, drawn for use on the gradient hero card.
 * The icon in the middle is the biggest category.
 */
export function DonutRing({ categories, total, size = 108, stroke = 14 }: Props) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const hasData = total > 0 && categories.length > 0;

  let offset = 0;
  const segments = hasData
    ? categories.map((c) => {
        const length = (c.total / total) * circumference;
        const seg = { c, length: Math.max(length - GAP, 0.5), offset };
        offset += length;
        return seg;
      })
    : [];
  const top = hasData ? categoryStyle(categories[0].category) : null;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} fill="none" />
          {segments.map(({ c, length, offset: off }) => (
            <Circle
              key={c.category}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={categoryStyle(c.category).color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-off}
              strokeLinecap="butt"
              fill="none"
            />
          ))}
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Ionicons name={top?.icon ?? 'pie-chart-outline'} size={size * 0.27} color={top ? '#FFFFFF' : 'rgba(255,255,255,0.6)'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
