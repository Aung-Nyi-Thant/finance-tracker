import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../../components/fx/AmbientBackground';
import { AutoImportCard } from '../../components/AutoImportCard';
import { ClipboardImport } from '../../components/ClipboardImport';
import { ManualEntryForm } from '../../components/ManualEntryForm';
import { PendingCard } from '../../components/PendingCard';
import { PendingSkeleton } from '../../components/PendingSkeleton';
import { useAutoImport } from '../../store/AutoImportContext';
import { useTransactions } from '../../store/TransactionsContext';
import { useTheme } from '../../theme/colors';

export default function Inbox() {
  const t = useTheme();
  const router = useRouter();
  const { pending, refreshPending, confirmPending, discardPending } = useTransactions();
  const { importing, scanNow } = useAutoImport();
  const [manualOpen, setManualOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshPending();
      scanNow();
    }, [refreshPending, scanNow]),
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]} edges={['top']}>
      <AmbientBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.title, { color: t.text }]}>Inbox</Text>

          <AutoImportCard />

          {(pending.length > 0 || importing > 0) && (
            <>
              <Text style={[styles.section, { color: t.text }]}>
                To review{pending.length > 0 ? ` · ${pending.length}` : ''}
              </Text>
              <View style={{ gap: 14 }}>
                {Array.from({ length: importing }).map((_, i) => (
                  <PendingSkeleton key={`sk-${i}`} />
                ))}
                {pending.map((tx, i) => (
                  <Animated.View
                    key={tx.id}
                    entering={FadeInDown.delay(Math.min(i, 6) * 70).springify().damping(15)}
                    exiting={FadeOut.duration(180)}
                    layout={LinearTransition.springify().damping(18)}
                  >
                    <PendingCard tx={tx} onConfirm={confirmPending} onDiscard={discardPending} />
                  </Animated.View>
                ))}
              </View>
            </>
          )}

          {pending.length === 0 && importing === 0 && (
            <View style={styles.allClear}>
              <Ionicons name="checkmark-circle" size={44} color={t.positive} />
              <Text style={[styles.clearTitle, { color: t.text }]}>All caught up</Text>
              <Text style={[styles.clearBody, { color: t.textSecondary }]}>
                Screenshot a payment slip and it will appear here.
              </Text>
            </View>
          )}

          <Text style={[styles.section, { color: t.text }]}>Other ways to add</Text>
          <ClipboardImport />

          <Pressable
            onPress={() => setManualOpen((o) => !o)}
            style={[styles.manualToggle, { backgroundColor: t.card, borderColor: t.border }]}
          >
            <Ionicons name="create" size={20} color={t.textSecondary} />
            <Text style={[styles.manualText, { color: t.text }]}>Add manually</Text>
            <Ionicons name={manualOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.textSecondary} />
          </Pressable>
          {manualOpen && (
            <View style={{ marginTop: 14 }}>
              <ManualEntryForm
                onSaved={() => {
                  setManualOpen(false);
                  router.navigate('/');
                }}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: 0.3, marginBottom: 16 },
  section: { fontSize: 20, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  allClear: { alignItems: 'center', gap: 6, paddingVertical: 34 },
  clearTitle: { fontSize: 18, fontWeight: '700', marginTop: 6 },
  clearBody: { fontSize: 14, textAlign: 'center' },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginTop: 12,
  },
  manualText: { flex: 1, fontSize: 16, fontWeight: '600' },
});
