import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as api from '../services/api';
import { useMoney } from '../store/SettingsContext';
import { categoryLabel } from '../theme/categories';
import { useTheme } from '../theme/colors';
import { budgetColor } from '../theme/severity';
import { CATEGORIES, type Budget, type BudgetKey } from '../types';
import { CategoryIcon } from './CategoryIcon';
import { NeuBadge } from './fx/NeuBadge';
import { SpringSheet } from './fx/SpringSheet';
import { PrimaryButton } from './PrimaryButton';

const KEYS: BudgetKey[] = ['Total', ...CATEGORIES.filter((c): c is Exclude<typeof c, 'Income'> => c !== 'Income')];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after limits were saved so the dashboard can refresh. */
  onSaved: () => void;
}

/** Edit monthly limits: one overall budget plus optional per-category budgets. Empty = no limit. */
export function BudgetSheet({ visible, onClose, onSaved }: Props) {
  const t = useTheme();
  const { format, symbol } = useMoney();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<Record<string, Budget>>({});
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBudgets()
      .then((budgets) => {
        if (cancelled) return;
        const byKey = Object.fromEntries(budgets.map((b) => [b.category, b]));
        setOriginal(byKey);
        setValues(Object.fromEntries(budgets.map((b) => [b.category, String(b.monthly_limit)])));
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  async function save() {
    setSaving(true);
    try {
      for (const key of KEYS) {
        const raw = (values[key] ?? '').trim().replace(',', '.');
        const had = original[key];
        if (!raw) {
          if (had) await api.deleteBudget(key);
          continue;
        }
        const limit = parseFloat(raw);
        if (!Number.isFinite(limit) || limit <= 0) {
          throw new Error(`Enter a positive amount for ${key === 'Total' ? 'the monthly budget' : categoryLabel(key)}.`);
        }
        if (!had || had.monthly_limit !== limit) await api.setBudget(key, Math.round(limit * 100) / 100);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save budgets', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SpringSheet visible={visible} onClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]}>Monthly budgets</Text>
        </View>
        <Text style={[styles.hint, { color: t.textSecondary }]}>
          You'll get alerts at 80% and when a limit is passed. Leave blank for no limit.
        </Text>

        {loading ? (
          <ActivityIndicator color={t.accent} style={{ marginVertical: 40 }} />
        ) : error ? (
          <Text style={[styles.error, { color: t.danger }]}>{error}</Text>
        ) : (
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {KEYS.map((key, i) => {
              const b = original[key];
              return (
                <Animated.View
                  key={key}
                  entering={FadeInDown.delay(60 + i * 26).springify().damping(16)}
                  style={[styles.row, { borderBottomColor: t.border }]}
                >
                  {key === 'Total' ? <NeuBadge icon="wallet" color={t.accent} size={40} /> : <CategoryIcon category={key} size={40} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: t.text }]}>{key === 'Total' ? 'Everything' : categoryLabel(key)}</Text>
                    {b && (
                      <Text style={[styles.spent, { color: budgetColor(b.status, t.textSecondary, t) }]}>
                        {format(b.spent)} spent · {Math.round(b.percent)}%
                      </Text>
                    )}
                  </View>
                  <View style={[styles.inputWrap, { backgroundColor: t.cardElevated, borderColor: t.border }]}>
                    <Text style={{ color: t.textSecondary, fontWeight: '600' }}>{symbol}</Text>
                    <TextInput
                      value={values[key] ?? ''}
                      onChangeText={(v) => setValues((s) => ({ ...s, [key]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="No limit"
                      placeholderTextColor={t.textTertiary}
                      style={[styles.input, { color: t.text }]}
                    />
                  </View>
                </Animated.View>
              );
            })}
          </ScrollView>
        )}

        <PrimaryButton title="Save budgets" onPress={save} loading={saving} disabled={loading || !!error} style={{ marginTop: 14 }} />
      </KeyboardAvoidingView>
    </SpringSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  error: { fontSize: 14, marginVertical: 24, textAlign: 'center' },
  list: { flexGrow: 0, maxHeight: 440 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '600' },
  spent: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, height: 42, width: 118 },
  input: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
});
