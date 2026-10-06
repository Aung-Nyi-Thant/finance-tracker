import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoney } from '../store/SettingsContext';
import { categoryStyle } from '../theme/categories';
import { useTheme } from '../theme/colors';
import { mix } from '../theme/fx';
import type { Category, PendingEdits, Transaction } from '../types';
import { formatDay } from '../utils/format';
import { lineHeightFor } from '../utils/text';
import { CategoryBadge } from './CategoryBadge';
import { CategoryIcon } from './CategoryIcon';
import { CategoryPicker } from './CategoryPicker';
import { SpringPressable } from './fx/SpringPressable';
import { ParallaxLayer, TiltCard } from './fx/TiltCard';

interface Props {
  tx: Transaction;
  onConfirm: (id: number, edits?: PendingEdits) => Promise<void>;
  onDiscard: (id: number) => Promise<void>;
}

/** An auto-imported transaction awaiting the user's 1-tap confirmation. Tilts under the finger like the hero card. */
export function PendingCard({ tx, onConfirm, onDiscard }: Props) {
  const t = useTheme();
  const { format } = useMoney();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(tx.amount));
  const [merchant, setMerchant] = useState(tx.merchant_name);
  const [category, setCategory] = useState<Category>(tx.category);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null);

  const amountValue = parseFloat(amount.replace(',', '.'));
  const valid = Number.isFinite(amountValue) && amountValue > 0 && merchant.trim().length > 0;
  const { color } = categoryStyle(category);

  async function confirm() {
    if (!valid || busy) return;
    const edits: PendingEdits = {};
    if (amountValue !== tx.amount) edits.amount = Math.round(amountValue * 100) / 100;
    if (merchant.trim() !== tx.merchant_name) edits.merchant_name = merchant.trim();
    if (category !== tx.category) edits.category = category;
    setBusy('confirm');
    try {
      await onConfirm(tx.id, edits);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not save', (err as Error).message);
      setBusy(null);
    }
  }

  async function discard() {
    if (busy) return;
    setBusy('discard');
    try {
      await onDiscard(tx.id);
      Haptics.selectionAsync();
    } catch (err) {
      Alert.alert('Could not discard', (err as Error).message);
      setBusy(null);
    }
  }

  const faceTop = t.isDark ? mix(t.card, '#FFFFFF', 0.07) : '#FFFFFF';
  const faceBottom = t.isDark ? mix(t.card, '#000000', 0.22) : mix('#FFFFFF', '#C9D3E8', 0.4);
  const inputStyle = [styles.input, { color: t.text, backgroundColor: t.cardElevated, borderColor: t.border }];

  return (
    <TiltCard radius={28} baseColor={t.card} glowColor={color} dark={t.isDark} maxTilt={6}>
      <LinearGradient colors={[faceTop, faceBottom]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View style={styles.body}>
        <View style={styles.top}>
          <ParallaxLayer depth={9}>
            <CategoryIcon category={category} size={56} float />
          </ParallaxLayer>
          <ParallaxLayer depth={4} style={styles.info}>
            {editing ? (
              <TextInput value={merchant} onChangeText={setMerchant} style={inputStyle} placeholder="Merchant" placeholderTextColor={t.textTertiary} />
            ) : (
              <Text style={[styles.merchant, { color: t.text, lineHeight: lineHeightFor(merchant, 17, 1.3) }]} numberOfLines={1}>
                {merchant}
              </Text>
            )}
            <View style={styles.metaRow}>
              <SpringPressable onPress={() => setPickerOpen(true)} haptic="selection" hitSlop={6} style={{ alignSelf: 'flex-start' }}>
                <CategoryBadge category={category} />
              </SpringPressable>
              <Text style={[styles.date, { color: t.textSecondary }]}>{formatDay(tx.transaction_date)}</Text>
            </View>
          </ParallaxLayer>
          <ParallaxLayer depth={7}>
            {editing ? (
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={[...inputStyle, styles.amountInput]} />
            ) : (
              <Text style={[styles.amount, { color: t.text }]}>{format(amountValue || 0)}</Text>
            )}
          </ParallaxLayer>
        </View>

        <View style={styles.actions}>
          <SpringPressable
            onPress={confirm}
            disabled={!valid || !!busy}
            pressedScale={0.95}
            style={[styles.confirmWrap, { opacity: valid ? 1 : 0.45, shadowColor: t.accent }]}
          >
            <LinearGradient colors={[mix(t.accent, '#FFFFFF', 0.2), t.accent, mix(t.accent, '#000000', 0.2)]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.confirm}>
              {busy === 'confirm' ? (
                <ActivityIndicator color={t.accentText} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color={t.accentText} />
                  <Text style={[styles.confirmText, { color: t.accentText }]}>Confirm</Text>
                </>
              )}
            </LinearGradient>
          </SpringPressable>
          <SpringPressable
            onPress={() => setEditing((e) => !e)}
            haptic="selection"
            style={[styles.iconBtn, { backgroundColor: t.cardElevated, borderColor: t.border }]}
            accessibilityLabel={editing ? 'Done editing' : 'Edit'}
          >
            <Ionicons name={editing ? 'checkmark-done' : 'create-outline'} size={20} color={t.text} />
          </SpringPressable>
          <SpringPressable onPress={discard} disabled={!!busy} style={[styles.iconBtn, { backgroundColor: t.cardElevated, borderColor: t.border }]} accessibilityLabel="Discard">
            {busy === 'discard' ? <ActivityIndicator color={t.danger} /> : <Ionicons name="trash-outline" size={20} color={t.danger} />}
          </SpringPressable>
        </View>
      </View>

      <CategoryPicker visible={pickerOpen} selected={category} onSelect={setCategory} onClose={() => setPickerOpen(false)} />
    </TiltCard>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  info: { flex: 1, gap: 8 },
  merchant: { fontSize: 17, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  date: { fontSize: 12, fontWeight: '600' },
  amount: { fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, height: 38, fontSize: 15, fontWeight: '600' },
  amountInput: { width: 96, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10 },
  confirmWrap: { flex: 1, height: 50, borderRadius: 18, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  confirm: { flex: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  confirmText: { fontSize: 16, fontWeight: '800' },
  iconBtn: { width: 50, height: 50, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
