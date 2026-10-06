import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it squashes while held (1 = not at all). */
  pressedScale?: number;
  haptic?: 'light' | 'selection' | false;
}

/** Pressable with spring physics: squashes under the finger and bounces back with a little overshoot. */
export function SpringPressable({ children, style, pressedScale = 0.95, haptic = 'light', onPressIn, onPressOut, onPress, ...rest }: Props) {
  const scale = useSharedValue(1);
  const reduce = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      onPressIn={(e) => {
        if (!reduce) scale.value = withSpring(pressedScale, { damping: 18, stiffness: 520, mass: 0.6 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduce) scale.value = withSpring(1, { damping: 8, stiffness: 300, mass: 0.7 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        else if (haptic === 'selection') Haptics.selectionAsync();
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
