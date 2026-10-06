import { createContext, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { RadialGlow } from './RadialGlow';

interface TiltValue {
  /** Horizontal / vertical touch position across the card, -1 (left/top) to 1 (right/bottom). */
  tx: SharedValue<number>;
  ty: SharedValue<number>;
}

const TiltContext = createContext<TiltValue | null>(null);

const SPRING = { damping: 14, stiffness: 150, mass: 0.7 };

interface Props {
  children: ReactNode;
  radius?: number;
  /** Colour behind the face; shadows are cast from it, so it should match the face's dominant colour. */
  baseColor: string;
  /** Colour of the large, soft, tinted ambient shadow. */
  glowColor?: string;
  maxTilt?: number;
  /** Moving specular highlight that follows the finger. */
  glare?: boolean;
  /** Light-theme cards want a softer shadow. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
}

/**
 * A card with real depth: it tilts toward the finger in 3D (perspective + rotateX/Y), casts layered
 * shadows that shift with the tilt, catches a moving highlight, and exposes the tilt to ParallaxLayer
 * children so content floats at different depths. Scrolling still works: the gesture only observes touches.
 */
export function TiltCard({
  children,
  radius = 28,
  baseColor,
  glowColor,
  maxTilt = 9,
  glare = true,
  dark = true,
  style,
  faceStyle,
}: Props) {
  const reduce = useReducedMotion();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const press = useSharedValue(0);
  const width = useSharedValue(1);
  const height = useSharedValue(1);
  const [size, setSize] = useState({ w: 1, h: 1 });

  const gesture = Gesture.Manual()
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      tx.value = withSpring(Math.max(-1, Math.min(1, (t.x / width.value) * 2 - 1)), SPRING);
      ty.value = withSpring(Math.max(-1, Math.min(1, (t.y / height.value) * 2 - 1)), SPRING);
      press.value = withSpring(1, SPRING);
    })
    .onTouchesMove((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      tx.value = withSpring(Math.max(-1, Math.min(1, (t.x / width.value) * 2 - 1)), { ...SPRING, stiffness: 260 });
      ty.value = withSpring(Math.max(-1, Math.min(1, (t.y / height.value) * 2 - 1)), { ...SPRING, stiffness: 260 });
    })
    .onTouchesUp(() => {
      tx.value = withSpring(0, { damping: 9, stiffness: 120, mass: 0.8 });
      ty.value = withSpring(0, { damping: 9, stiffness: 120, mass: 0.8 });
      press.value = withSpring(0, SPRING);
    })
    .onTouchesCancelled(() => {
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
      press.value = withSpring(0, SPRING);
    });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    width.value = w;
    height.value = h;
    setSize({ w, h });
  };

  const body = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateX: `${-ty.value * maxTilt}deg` },
      { rotateY: `${tx.value * maxTilt}deg` },
      { scale: 1 + press.value * 0.018 },
    ],
  }));

  // The far, soft shadow slides opposite to the tilt so the card looks like it hovers over the page.
  const ambient = useAnimatedStyle(() => ({
    shadowOffset: { width: -tx.value * 14, height: 22 + ty.value * 10 },
    shadowOpacity: (dark ? 0.5 : 0.28) - press.value * 0.08,
    shadowRadius: 34 + press.value * 8,
  }));
  const contact = useAnimatedStyle(() => ({
    shadowOffset: { width: -tx.value * 5, height: 7 + ty.value * 3 },
    shadowOpacity: (dark ? 0.55 : 0.22) + press.value * 0.1,
  }));

  const glareStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + press.value * 0.8,
    transform: [{ translateX: tx.value * size.w * 0.42 }, { translateY: ty.value * size.h * 0.42 }],
  }));

  const content = (
    <TiltContext.Provider value={{ tx, ty }}>
      <View style={[styles.face, { borderRadius: radius }, faceStyle]}>
        {children}
        {glare && (
          <Animated.View pointerEvents="none" style={[styles.glare, glareStyle]}>
            <RadialGlow size={Math.max(size.w, 160) * 0.95} intensity={0.34} />
          </Animated.View>
        )}
        {/* rim light: brighter along the top-left edge, darker along the bottom-right */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.38)',
              borderLeftColor: 'rgba(255,255,255,0.22)',
              borderRightColor: 'rgba(255,255,255,0.06)',
              borderBottomColor: 'rgba(0,0,0,0.12)',
            },
          ]}
        />
      </View>
    </TiltContext.Provider>
  );

  return (
    <GestureDetector gesture={reduce ? Gesture.Manual() : gesture}>
      <Animated.View onLayout={onLayout} style={[style, body]}>
        {/* layered shadows: tinted ambient + tight contact, both cast from solid base-coloured plates */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, backgroundColor: baseColor, shadowColor: glowColor ?? baseColor },
            ambient,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: baseColor, shadowColor: '#000' }, contact]}
        />
        {content}
      </Animated.View>
    </GestureDetector>
  );
}

interface LayerProps {
  /** How far this layer travels with the tilt, in points. Positive floats toward the viewer. */
  depth: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Content that floats above (positive depth) or sinks below (negative) the card face as it tilts. */
export function ParallaxLayer({ depth, children, style }: LayerProps) {
  const tilt = useContext(TiltContext);
  const animated = useAnimatedStyle(() => ({
    transform: [
      { translateX: (tilt?.tx.value ?? 0) * depth },
      { translateY: (tilt?.ty.value ?? 0) * depth },
    ],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  face: { overflow: 'hidden' },
  glare: { position: 'absolute', left: 0, top: 0 },
});
