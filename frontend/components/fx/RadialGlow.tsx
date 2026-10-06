import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

interface Props {
  size: number;
  color?: string;
  /** Opacity at the centre; it fades to 0 at the edge. */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}

/** A soft round light (React Native has no radial gradients, so this is an SVG one). */
export function RadialGlow({ size, color = '#FFFFFF', intensity = 0.5, style }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={intensity} />
            <Stop offset="0.55" stopColor={color} stopOpacity={intensity * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export const absoluteGlow = StyleSheet.create({ pos: { position: 'absolute' } }).pos;
