import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertBanner } from '../../components/AlertBanner';
import { BudgetCards } from '../../components/BudgetCards';
import { BudgetSheet } from '../../components/BudgetSheet';
import { CurrencySheet } from '../../components/CurrencySheet';
import { FilterChips } from '../../components/FilterChips';
import { AmbientBackground } from '../../components/fx/AmbientBackground';
import { NeuBadge } from '../../components/fx/NeuBadge';
import { SpringPressable } from '../../components/fx/SpringPressable';
import { InsightCard } from '../../components/InsightCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RecentSlips } from '../../components/RecentSlips';
import { SlipEditorSheet } from '../../components/SlipEditorSheet';
import { SummaryCard } from '../../components/SummaryCard';
import { useTransactions } from '../../store/TransactionsContext';
import { cardStyle, tint, useTheme } from '../../theme/colors';
import type { Category, Transaction } from '../../types';
import { greeting } from '../../utils/format';

const enter = (i: number) => FadeInDown.delay(i * 80).springify().damping(15).stiffness(120);
const spring = LinearTransition.springify().damping(18);

export default function Dashboard() {
  const t = useTheme();
  const router = useRouter();
  const {
    transactions, pending, advice, summary, budgets, loading, error, refresh,
    month, isCurrentMonth, changeMonth, updateTransaction, deleteTransaction,
  } = useTransactions();
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const empty = !loading && !error && transactions.length === 0;
  const hasSpending = !!summary && summary.categories.length > 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]} edges={['top']}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={t.textSecondary} />}
      >
        <Animated.View entering={enter(0)} style={styles.header}>
          <Text style={[styles.caption, { color: t.textSecondary }]}>{greeting()}</Text>
          <Text style={[styles.title, { color: t.text }]}>Overview</Text>
        </Animated.View>

        <Animated.View entering={enter(1)}>
          <SummaryCard
            summary={summary}
            month={month}
            canGoNext={!isCurrentMonth}
            onPrevMonth={() => changeMonth(-1)}
            onNextMonth={() => changeMonth(1)}
            onCurrencyPress={() => setCurrencyOpen(true)}
            onBudgetPress={() => setBudgetsOpen(true)}
          />
        </Animated.View>

        <Animated.View entering={enter(2)} layout={spring}>
          <AlertBanner alerts={summary?.alerts ?? []} />

          {pending.length > 0 && (
            <SpringPressable
              onPress={() => router.navigate('/add')}
              style={[styles.review, { backgroundColor: tint(t.accent, t), borderColor: tint(t.accent, t, 'strong') }]}
            >
              <NeuBadge icon="file-tray-full" color={t.accent} size={38} float />
              <Text style={[styles.reviewText, { color: t.text }]}>
                {pending.length} {pending.length === 1 ? 'slip' : 'slips'} ready to confirm
              </Text>
              <Ionicons name="chevron-forward" size={18} color={t.accent} />
            </SpringPressable>
          )}

          {error && (
            <View style={[styles.banner, { backgroundColor: tint(t.danger, t), borderColor: tint(t.danger, t, 'strong') }]}>
              <Ionicons name="cloud-offline" size={20} color={t.danger} />
              <Text style={[styles.bannerText, { color: t.danger }]}>{error}</Text>
            </View>
          )}

          {advice && advice.tips.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <InsightCard advice={advice} />
            </View>
          )}
        </Animated.View>

        <Animated.View entering={enter(3)} layout={spring} style={styles.section}>
          <BudgetCards budgets={budgets} onEdit={() => setBudgetsOpen(true)} />
        </Animated.View>

        {hasSpending && (
          <Animated.View entering={enter(4)} layout={spring}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Categories</Text>
            <FilterChips categories={summary!.categories} active={category} onChange={setCategory} />
          </Animated.View>
        )}

        <Animated.View entering={enter(5)} layout={spring} style={styles.section}>
          {empty ? (
            <View style={[styles.empty, cardStyle(t, 28)]}>
              <NeuBadge icon="receipt-outline" color={t.accent} size={64} float />
              <Text style={[styles.emptyTitle, { color: t.text }]}>No slips yet</Text>
              <Text style={[styles.emptyBody, { color: t.textSecondary }]}>Save or screenshot a payment slip and it will show up here.</Text>
              <PrimaryButton title="Open Inbox" onPress={() => router.navigate('/add')} style={{ alignSelf: 'stretch', marginTop: 8 }} />
            </View>
          ) : (
            <RecentSlips
              transactions={transactions}
              category={category}
              onClearCategory={() => setCategory(null)}
              onEdit={setEditing}
              month={isCurrentMonth ? null : month}
            />
          )}
        </Animated.View>
      </ScrollView>

      <SlipEditorSheet tx={editing} onClose={() => setEditing(null)} onSave={updateTransaction} onDelete={deleteTransaction} />
      <BudgetSheet visible={budgetsOpen} onClose={() => setBudgetsOpen(false)} onSaved={refresh} />
      <CurrencySheet visible={currencyOpen} onClose={() => setCurrencyOpen(false)} onChanged={refresh} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 56 },
  header: { marginBottom: 18 },
  caption: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 36, fontWeight: '800', letterSpacing: 0.3, marginTop: 2 },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 22, fontWeight: '800', letterSpacing: 0.2, marginTop: 14, marginBottom: 2 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, borderWidth: 1, marginTop: 16 },
  reviewText: { flex: 1, fontSize: 15, fontWeight: '700' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, marginTop: 16 },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 8, padding: 26 },
  emptyTitle: { fontSize: 19, fontWeight: '800', marginTop: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center' },
});
