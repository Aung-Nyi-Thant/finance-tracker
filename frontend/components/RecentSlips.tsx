import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import * as api from '../services/api';
import { useMoney } from '../store/SettingsContext';
import { categoryLabel } from '../theme/categories';
import { cardStyle, useTheme } from '../theme/colors';
import type { Category, SearchResult, Transaction } from '../types';
import { formatDay, relativeDay } from '../utils/format';
import { lineHeightFor } from '../utils/text';
import { CategoryBadge } from './CategoryBadge';
import { CategoryIcon } from './CategoryIcon';
import { NeuBadge } from './fx/NeuBadge';
import { SpringPressable } from './fx/SpringPressable';

const COLLAPSED_COUNT = 8;
const SPRING_LAYOUT = LinearTransition.springify().damping(18).stiffness(160);

function SlipRow({ tx, index, onEdit }: { tx: Transaction; index: number; onEdit?: (tx: Transaction) => void }) {
  const t = useTheme();
  const { format } = useMoney();
  const income = tx.category === 'Income';
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(16)}
      exiting={FadeOut.duration(140)}
      layout={SPRING_LAYOUT}
    >
      <SpringPressable
        onPress={() => onEdit?.(tx)}
        disabled={!onEdit}
        haptic="selection"
        pressedScale={0.975}
        accessibilityLabel={`Edit ${tx.merchant_name}`}
        style={[styles.row, cardStyle(t, 22)]}
      >
        <CategoryIcon category={tx.category} size={50} />
        <View style={styles.middle}>
          <Text style={[styles.merchant, { color: t.text, lineHeight: lineHeightFor(tx.merchant_name, 16, 1.3) }]} numberOfLines={1}>
            {tx.merchant_name}
          </Text>
          <View style={styles.meta}>
            <CategoryBadge category={tx.category} compact />
            <Text style={[styles.date, { color: t.textTertiary }]}>{formatDay(tx.transaction_date)}</Text>
          </View>
        </View>
        <Text style={[styles.amount, { color: income ? t.positive : t.text }]}>
          {income ? '+' : '−'}
          {format(tx.amount)}
        </Text>
      </SpringPressable>
    </Animated.View>
  );
}

interface Props {
  /** The latest confirmed slips, shown when no search or filter is active. */
  transactions: Transaction[];
  /** Active category filter from the chips above (or null). */
  category: Category | null;
  onClearCategory: () => void;
  /** Called when a slip is tapped (opens the editor). */
  onEdit?: (tx: Transaction) => void;
  /** When set (a past month is on screen), searches are limited to it unless the query names its own dates. */
  month?: string | null;
}

/**
 * "Recent slips": grouped by day, each slip a soft 3D-styled card. A smart search box understands things like
 * "food over 200 last month" or "uber >500 august"; rows spring in, out and into their new positions.
 */
export function RecentSlips({ transactions, category, onClearCategory, onEdit, month = null }: Props) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<SearchResult | null>(null);
  const [failed, setFailed] = useState(false);

  const searching = query.trim().length > 0 || category !== null;

  // Debounced server-side search; re-run when the feed itself changes (e.g. a slip was just saved).
  useEffect(() => {
    if (!searching) {
      setRemote(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.searchTransactions(query, category, 50, month);
        if (!cancelled) {
          setRemote(result);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, category, searching, transactions, month]);

  const all = searching ? remote?.results ?? [] : transactions;
  const rows = searching || expanded ? all : all.slice(0, COLLAPSED_COUNT);

  const groups = useMemo(() => {
    const out: { day: string; items: Transaction[] }[] = [];
    for (const tx of rows) {
      const last = out[out.length - 1];
      if (last && last.day === tx.transaction_date) last.items.push(tx);
      else out.push({ day: tx.transaction_date, items: [tx] });
    }
    return out;
  }, [rows]);

  let index = 0;

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Recent slips</Text>
        {!searching && transactions.length > COLLAPSED_COUNT && (
          <SpringPressable onPress={() => setExpanded((v) => !v)} haptic="selection" hitSlop={10} style={styles.toggle}>
            <Text style={[styles.toggleText, { color: t.accent }]}>{expanded ? 'Show less' : 'See all'}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={14} color={t.accent} />
          </SpringPressable>
        )}
      </View>

      <View style={[styles.search, cardStyle(t, 20)]}>
        <Ionicons name="search" size={18} color={t.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search: uber, food over 200, last month…"
          placeholderTextColor={t.textTertiary}
          style={[styles.input, { color: t.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
        />
        {query.length > 0 && (
          <SpringPressable onPress={() => setQuery('')} hitSlop={10} haptic={false} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={t.textTertiary} />
          </SpringPressable>
        )}
      </View>

      {searching && (
        <Animated.View entering={FadeIn.duration(200)} layout={SPRING_LAYOUT} style={styles.interpretation}>
          <Text style={[styles.interpretText, { color: t.textSecondary }]} numberOfLines={2}>
            {failed
              ? "Couldn't search right now."
              : `${all.length} ${all.length === 1 ? 'slip' : 'slips'}${
                  [category ? categoryLabel(category) : null, ...(remote?.interpretation ?? []).filter((n) => n !== category)].filter(Boolean).length
                    ? ' · ' + [category ? categoryLabel(category) : null, ...(remote?.interpretation ?? []).filter((n) => n !== category)].filter(Boolean).join(' · ')
                    : ''
                }`}
          </Text>
          {category && (
            <SpringPressable onPress={onClearCategory} haptic="selection" hitSlop={8}>
              <Text style={[styles.clear, { color: t.accent }]}>Clear filter</Text>
            </SpringPressable>
          )}
        </Animated.View>
      )}

      {groups.map((g) => (
        <Animated.View key={g.day} layout={SPRING_LAYOUT} style={styles.group}>
          <Text style={[styles.day, { color: t.textSecondary }]}>{relativeDay(g.day).toUpperCase()}</Text>
          <View style={{ gap: 11 }}>
            {g.items.map((tx) => (
              <SlipRow key={tx.id} tx={tx} index={index++} onEdit={onEdit} />
            ))}
          </View>
        </Animated.View>
      ))}

      {searching && !failed && remote && all.length === 0 && (
        <Animated.View entering={FadeInDown.springify().damping(16)} style={[styles.empty, cardStyle(t, 24)]}>
          <NeuBadge icon="search" color={t.accent} size={56} float />
          <Text style={[styles.emptyTitle, { color: t.text }]}>No slips match</Text>
          <Text style={[styles.emptyBody, { color: t.textSecondary }]}>Try a merchant name, a category, or something like “over 500 last month”.</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  toggleText: { fontSize: 14, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 50 },
  input: { flex: 1, fontSize: 15, fontWeight: '500', height: 50 },
  interpretation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingHorizontal: 4 },
  interpretText: { flex: 1, fontSize: 13, fontWeight: '600' },
  clear: { fontSize: 13, fontWeight: '700' },
  group: { marginTop: 18 },
  day: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 13 },
  middle: { flex: 1, gap: 6 },
  merchant: { fontSize: 16, fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  date: { fontSize: 12, fontWeight: '600' },
  amount: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 8, padding: 26, marginTop: 18 },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginTop: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
