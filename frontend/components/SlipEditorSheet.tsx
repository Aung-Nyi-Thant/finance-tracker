import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoney } from '../store/SettingsContext';
import { categoryStyle } from '../theme/categories';
import { cardStyle, tint, useTheme } from '../theme/colors';
import { CATEGORIES, type Category, type PendingEdits, type Transaction } from '../types';
import { dateToISO, isoToDate } from '../utils/format';
import { CategoryIcon } from './CategoryIcon';
import { SpringPressable } from './fx/SpringPressable';
import { SpringSheet } from './fx/SpringSheet';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  /** The slip being edited, or null when the sheet is closed. */
  tx: Transaction | null;
  onClose: () => void;
  onSave: (id: number, edits: PendingEdits) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function Editor({ tx, onClose, onSave, onDelete }: Omit<Props, 'tx'> & { tx: Transaction }) {
  const t = useTheme();
  const { symbol } = useMoney();
  const [amount, setAmount] = useState(String(tx.amount));
  const [merchant, setMerchant] = useState(tx.merchant_name);
  const [date, setDate] = useState(tx.transaction_date);
  const [category, setCategory] = useState<Category>(tx.category);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);

  const amountValue = parseFloat(amount.replace(',', '.'));
  const valid = Number.isFinite(amountValue) && amountValue > 0 && merchant.trim().length > 0;

  const edits: PendingEdits = {};
  if (valid && Math.round(amountValue * 100) / 100 !== tx.amount) edits.amount = Math.round(amountValue * 100) / 100;
  if (merchant.trim() !== tx.merchant_name && merchant.trim()) edits.merchant_name = merchant.trim();
  if (date !== tx.transaction_date) edits.transaction_date = date;
  if (category !== tx.category) edits.category = category;
  const changed = Object.keys(edits).length > 0;

  async function save() {
    if (!valid || !changed || busy) return;
    setBusy('save');
    try {
      await onSave(tx.id, edits);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      Alert.alert('Could not save changes', (err as Error).message);
      setBusy(null);
    }
  }

  function confirmDelete() {
    if (busy) return;
    Alert.alert('Delete this slip?', `${tx.merchant_name} will be removed from your history and totals.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await onDelete(tx.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onClose();
          } catch (err) {
            Alert.alert('Could not delete', (err as Error).message);
            setBusy(null);
          }
        },
      },
    ]);
  }

  const field = [styles.field, { backgroundColor: t.cardElevated, borderColor: t.border }];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={[styles.title, { color: t.text }]}>Edit slip</Text>

      <View style={[...field, styles.amountField]}>
        <Text style={[styles.symbol, { color: t.textSecondary }]}>{symbol}</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          accessibilityLabel="Amount"
          style={[styles.amountInput, { color: t.text }]}
        />
      </View>

      <TextInput
        value={merchant}
        onChangeText={setMerchant}
        placeholder="Merchant"
        placeholderTextColor={t.textTertiary}
        accessibilityLabel="Merchant"
        style={[...field, styles.input, { color: t.text }]}
      />

      <View style={[...field, styles.rowField]}>
        <Text style={[styles.label, { color: t.text }]}>Date</Text>
        <DateTimePicker
          value={isoToDate(date)}
          mode="date"
          display="compact"
          maximumDate={new Date()}
          themeVariant={t.isDark ? 'dark' : 'light'}
          onValueChange={(_, d) => setDate(dateToISO(d))}
        />
      </View>

      <Text style={[styles.section, { color: t.textSecondary }]}>CATEGORY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {CATEGORIES.map((c) => {
          const { color, label } = categoryStyle(c);
          const selected = c === category;
          return (
            <SpringPressable
              key={c}
              haptic="selection"
              pressedScale={0.94}
              accessibilityState={{ selected }}
              onPress={() => setCategory(c)}
              style={[
                styles.chip,
                { borderColor: selected ? color : t.border, backgroundColor: selected ? tint(color, t) : t.cardElevated },
              ]}
            >
              <CategoryIcon category={c} size={30} />
              <Text style={[styles.chipText, { color: selected ? color : t.textSecondary }]}>{label}</Text>
            </SpringPressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <PrimaryButton title="Save changes" onPress={save} disabled={!valid || !changed} loading={busy === 'save'} />
        <SpringPressable
          onPress={confirmDelete}
          disabled={!!busy}
          haptic="light"
          accessibilityLabel="Delete slip"
          style={[styles.delete, cardStyle(t, 20), { borderColor: tint(t.danger, t, 'strong') }]}
        >
          <Ionicons name="trash-outline" size={18} color={t.danger} />
          <Text style={[styles.deleteText, { color: t.danger }]}>{busy === 'delete' ? 'Deleting…' : 'Delete slip'}</Text>
        </SpringPressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Bottom sheet for correcting or deleting a saved slip. */
export function SlipEditorSheet({ tx, onClose, onSave, onDelete }: Props) {
  return (
    <SpringSheet visible={tx !== null} onClose={onClose}>
      {/* keyed by id so each slip starts from its own values */}
      {tx && <Editor key={tx.id} tx={tx} onClose={onClose} onSave={onSave} onDelete={onDelete} />}
    </SpringSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', marginBottom: 14 },
  field: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  amountField: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 64 },
  symbol: { fontSize: 26, fontWeight: '600', marginRight: 6 },
  amountInput: { flex: 1, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  input: { height: 54, paddingHorizontal: 16, fontSize: 17, fontWeight: '500' },
  rowField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 54, paddingHorizontal: 16 },
  label: { fontSize: 17, fontWeight: '500' },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 4, marginBottom: 8, marginLeft: 4 },
  chips: { gap: 10, paddingBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingLeft: 8, paddingRight: 14, borderRadius: 24, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  actions: { gap: 12, marginTop: 16 },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50 },
  deleteText: { fontSize: 16, fontWeight: '700' },
});
