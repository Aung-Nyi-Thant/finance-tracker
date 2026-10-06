import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/colors';

const SCREEN_H = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet with spring physics: springs up over a blurred, dimmed backdrop, follows the finger when
 * dragged by the grabber, and flings away (or snaps back) on release.
 */
export function SpringSheet({ visible, onClose, children }: Props) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(SCREEN_H);
  const backdrop = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = SCREEN_H;
      y.value = reduce ? withTiming(0, { duration: 1 }) : withSpring(0, { damping: 17, stiffness: 170, mass: 0.9 });
      backdrop.value = withTiming(1, { duration: 260 });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: 200 });
      y.value = withTiming(SCREEN_H, { duration: 240 }, (finished) => {
        if (finished) runOnJS(unmount)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      y.value = Math.max(0, e.translationY);
      backdrop.value = Math.max(0.2, 1 - e.translationY / 500);
    })
    .onEnd((e) => {
      if (e.translationY > 130 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        y.value = withSpring(0, { damping: 15, stiffness: 220 });
        backdrop.value = withTiming(1, { duration: 150 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <BlurView intensity={28} tint={t.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)' }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View style={[styles.sheetWrap, sheetStyle]} pointerEvents="box-none">
          <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border, shadowColor: '#000' }]}>
            <GestureDetector gesture={pan}>
              <View style={styles.grabberArea}>
                <View style={[styles.grabber, { backgroundColor: t.textTertiary }]} />
              </View>
            </GestureDetector>
            {children}
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingBottom: 34,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
  },
  grabberArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 12 },
  grabber: { width: 42, height: 5, borderRadius: 3, opacity: 0.5 },
});
