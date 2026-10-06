import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoney } from '../store/SettingsContext';
import { categoryLabel } from '../theme/categories';
import { useTransactions } from '../store/TransactionsContext';
import { useTheme } from '../theme/colors';
import type { Category } from '../types';
import { dateToISO, isoToDate, todayISO } from '../utils/format';
import { CategoryIcon } from './CategoryIcon';
import { CategoryPicker } from './CategoryPicker';
import { PrimaryButton } from './PrimaryButton';

/** Fallback for payments with no receipt/screenshot. */
export function ManualEntryForm({ onSaved }: { onSaved: () => void }) {
  const t = useTheme();
  const { saveTransaction } = useTransactions();
  const { symbol } = useMoney();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [date, setDate] = useState(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const amountValue = parseFloat(amount.replace(',', '.'));
  const canSave = Number.isFinite(amountValue) && amountValue > 0 && merchant.trim().length > 0;
  const field = [styles.field, { backgroundColor: t.card, borderColor: t.border }];

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveTransaction({
        amount: Math.round(amountValue * 100) / 100,
        merchant_name: merchant.trim(),
        category,
        transaction_date: date,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={[...field, styles.amountField]}>
        <Text style={[styles.currency, { color: t.textSecondary }]}>{symbol}</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={t.textTertiary}
          style={[styles.amountInput, { color: t.text }]}
        />
      </View>
      <TextInput
        value={merchant}
        onChangeText={setMerchant}
        placeholder="Merchant"
        placeholderTextColor={t.textTertiary}
        style={[...field, styles.input, { color: t.text }]}
      />
      <View style={[...field, styles.rowField]}>
        <Text style={[styles.value, { color: t.text }]}>Date</Text>
        <DateTimePicker
          value={isoToDate(date)}
          mode="date"
          display="compact"
          themeVariant={t.isDark ? 'dark' : 'light'}
          onValueChange={(_, d) => setDate(dateToISO(d))}
        />
      </View>
      <Pressable onPress={() => setPickerOpen(true)} style={[...field, styles.rowField]}>
        <CategoryIcon category={category} size={32} />
        <Text style={[styles.value, { color: t.text, flex: 1, marginLeft: 12 }]}>{categoryLabel(category)}</Text>
        <Ionicons name="chevron-down" size={20} color={t.textSecondary} />
      </Pressable>
      <PrimaryButton title="Save" onPress={save} disabled={!canSave} loading={saving} />
      <CategoryPicker visible={pickerOpen} selected={category} onSelect={setCategory} onClose={() => setPickerOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  input: { height: 56, paddingHorizontal: 16, fontSize: 17, fontWeight: '500' },
  amountField: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 64 },
  currency: { fontSize: 26, fontWeight: '600', marginRight: 6 },
  amountInput: { flex: 1, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowField: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 16, justifyContent: 'space-between' },
  value: { fontSize: 17, fontWeight: '500' },
});
