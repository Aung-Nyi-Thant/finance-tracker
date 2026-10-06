import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMoney } from '../store/SettingsContext';
import { tint, useTheme } from '../theme/colors';
import { CURRENCIES, makeFormatter } from '../utils/currency';
import { SpringPressable } from './fx/SpringPressable';
import { SpringSheet } from './fx/SpringSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after the currency changed so screens can refetch text that mentions amounts. */
  onChanged: () => void;
}

/** Choose the display currency. This changes symbols and formatting only; amounts are not converted. */
export function CurrencySheet({ visible, onClose, onChanged }: Props) {
  const t = useTheme();
  const { currency, setCurrency } = useMoney();

  async function pick(code: string) {
    if (code === currency) return onClose();
    Haptics.selectionAsync();
    try {
      await setCurrency(code);
      onChanged();
      onClose();
    } catch (err) {
      Alert.alert('Could not change currency', (err as Error).message);
    }
  }

  return (
    <SpringSheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: t.text }]}>Currency</Text>
      <Text style={[styles.hint, { color: t.textSecondary }]}>
        Changes how amounts are shown. Existing amounts aren't converted.
      </Text>
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        {CURRENCIES.map((c, i) => {
          const active = c.code === currency;
          const f = makeFormatter(c.code);
          return (
            <Animated.View key={c.code} entering={FadeInDown.delay(70 + i * 24).springify().damping(16)}>
              <SpringPressable
                haptic={false}
                pressedScale={0.97}
                onPress={() => pick(c.code)}
                style={[styles.row, active && { backgroundColor: t.cardElevated }]}
              >
                <View style={[styles.symbol, { backgroundColor: tint(t.accent, t) }]}>
                  <Text style={[styles.symbolText, { color: t.accent }]} numberOfLines={1} adjustsFontSizeToFit>
                    {f.symbol.trim()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: t.text }]}>{c.name}</Text>
                  <Text style={[styles.code, { color: t.textSecondary }]}>
                    {c.code} · {f.format(1234.5)}
                  </Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={t.accent} />}
              </SpringPressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </SpringSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', paddingHorizontal: 4 },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4, marginTop: 4, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 16 },
  symbol: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  symbolText: { fontSize: 16, fontWeight: '800' },
  name: { fontSize: 16, fontWeight: '600' },
  code: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
