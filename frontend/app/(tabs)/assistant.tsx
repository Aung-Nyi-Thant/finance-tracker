import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { AmbientBackground } from '../../components/fx/AmbientBackground';
import { SpringPressable } from '../../components/fx/SpringPressable';
import { SkeletonBlock } from '../../components/SkeletonBlock';
import { TipCard } from '../../components/TipCard';
import * as api from '../../services/api';
import { cardStyle, useTheme } from '../../theme/colors';
import type { Advice, ChatMessage } from '../../types';
import { lineHeightFor } from '../../utils/text';

const SUGGESTIONS = [
  'How much did I spend on food this month compared to last week?',
  'Can I afford a game purchase?',
  'Where did most of my money go?',
  'Am I on track this month?',
];

const CHAT_KEY = 'assistant.chat.v1';
const MAX_SAVED = 30;

const VISIBLE_TIPS = 4;

interface Bubble extends ChatMessage {
  error?: boolean;
}

export default function Assistant() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [advice, setAdvice] = useState<Advice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [showAllTips, setShowAllTips] = useState(false);

  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [restored, setRestored] = useState(false);

  // The conversation survives app restarts; the assistant's knowledge of your money comes from the backend.
  useEffect(() => {
    Storage.getItem(CHAT_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Bubble[];
        if (Array.isArray(saved)) setMessages(saved.filter((m) => !m.error).slice(-MAX_SAVED));
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);

  useEffect(() => {
    if (!restored) return;
    const kept = messages.filter((m) => !m.error).slice(-MAX_SAVED);
    Storage.setItem(CHAT_KEY, JSON.stringify(kept)).catch(() => {});
  }, [messages, restored]);

  const loadAdvice = useCallback(async (refresh = false) => {
    setAdviceLoading(true);
    setAdviceError(null);
    try {
      setAdvice(await api.getAdvice({ refresh }));
    } catch (err) {
      setAdviceError((err as Error).message);
    } finally {
      setAdviceLoading(false);
    }
  }, []);

  // Cached on the backend, so reopening the tab is free unless spending changed.
  useFocusEffect(
    useCallback(() => {
      loadAdvice();
    }, [loadAdvice]),
  );

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

  async function send(text: string) {
    const message = text.trim();
    if (!message || thinking) return;
    const history = messages.filter((m) => !m.error);
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setDraft('');
    setThinking(true);
    scrollToEnd();
    try {
      const reply = await api.askAssistant(message, history);
      Haptics.selectionAsync();
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: (err as Error).message, error: true }]);
    } finally {
      setThinking(false);
      scrollToEnd();
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]} edges={['top']}>
      <AmbientBackground />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 49 + insets.bottom : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.title, { color: t.text }]}>Assistant</Text>

          {/* ---- Monthly review ---- */}
          {adviceLoading && !advice ? (
            <View style={{ gap: 12 }}>
              <SkeletonBlock height={26} width="80%" radius={10} />
              <SkeletonBlock height={78} radius={20} />
              <SkeletonBlock height={78} radius={20} />
            </View>
          ) : adviceError && !advice ? (
            <View style={[styles.notice, { backgroundColor: `${t.danger}1A`, borderColor: `${t.danger}55` }]}>
              <Ionicons name="cloud-offline" size={20} color={t.danger} />
              <Text style={[styles.noticeText, { color: t.danger }]}>{adviceError}</Text>
            </View>
          ) : advice ? (
            <>
              <View style={styles.sourceRow}>
                <Ionicons name={advice.source === 'ai' ? 'sparkles' : 'bulb-outline'} size={14} color={t.accent} />
                <Text style={[styles.source, { color: t.accent, flex: 1 }]}>
                  {advice.source === 'ai' ? 'AI monthly review' : 'Spending insights'}
                </Text>
                <SpringPressable onPress={() => loadAdvice(true)} disabled={adviceLoading} hitSlop={10} haptic="selection" style={styles.refreshLink}>
                  {adviceLoading ? (
                    <ActivityIndicator size="small" color={t.accent} />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={14} color={t.textSecondary} />
                      <Text style={[styles.refreshText, { color: t.textSecondary }]}>Refresh</Text>
                    </>
                  )}
                </SpringPressable>
              </View>
              <Text style={[styles.headline, { color: t.text, lineHeight: lineHeightFor(advice.headline, 22, 1.27) }]}>{advice.headline}</Text>
              <View style={styles.tips}>
                {(showAllTips ? advice.tips : advice.tips.slice(0, VISIBLE_TIPS)).map((tip, i) => (
                  <TipCard key={`${tip.title}-${i}`} tip={tip} index={i} />
                ))}
              </View>
              {advice.tips.length > VISIBLE_TIPS && (
                <SpringPressable onPress={() => setShowAllTips((v) => !v)} style={styles.moreBtn} hitSlop={8} haptic="selection">
                  <Text style={[styles.moreText, { color: t.accent }]}>
                    {showAllTips ? 'Show fewer' : `Show ${advice.tips.length - VISIBLE_TIPS} more`}
                  </Text>
                </SpringPressable>
              )}
              {advice.ai_error && (
                <Text style={[styles.aiNote, { color: t.textTertiary }]}>
                  AI review unavailable right now ({advice.ai_error}). Showing built-in insights.
                </Text>
              )}
            </>
          ) : null}

          {/* ---- Chat ---- */}
          <View style={styles.askRow}>
            <Text style={[styles.section, styles.askTitle, { color: t.text }]}>Ask about your spending</Text>
            {messages.length > 0 && (
              <SpringPressable onPress={() => setMessages([])} hitSlop={10} haptic="selection">
                <Text style={[styles.clear, { color: t.textSecondary }]}>Clear</Text>
              </SpringPressable>
            )}
          </View>

          {messages.length === 0 && (
            <View style={styles.chips}>
              {SUGGESTIONS.map((s, i) => (
                <Animated.View key={s} entering={FadeInDown.delay(i * 70).springify().damping(15)}>
                  <SpringPressable onPress={() => send(s)} pressedScale={0.95} style={[styles.chip, cardStyle(t, 18)]}>
                    <Text style={[styles.chipText, { color: t.text }]}>{s}</Text>
                  </SpringPressable>
                </Animated.View>
              ))}
            </View>
          )}

          <View style={{ gap: 10 }}>
            {messages.map((m, i) => {
              const mine = m.role === 'user';
              return (
                <Animated.View
                  key={i}
                  entering={FadeInUp.springify().damping(14).stiffness(150)}
                  layout={LinearTransition.springify()}
                  style={[
                    styles.bubble,
                    mine
                      ? { alignSelf: 'flex-end', backgroundColor: t.accent }
                      : {
                          alignSelf: 'flex-start',
                          backgroundColor: m.error ? `${t.danger}1A` : t.card,
                          borderColor: m.error ? `${t.danger}55` : t.border,
                          borderWidth: StyleSheet.hairlineWidth,
                        },
                  ]}
                >
                  <Text
                    style={[styles.bubbleText, { color: mine ? t.accentText : m.error ? t.danger : t.text, lineHeight: lineHeightFor(m.content, 15) }]}
                    selectable
                  >
                    {m.content}
                  </Text>
                </Animated.View>
              );
            })}
            {thinking && (
              <View style={[styles.bubble, { alignSelf: 'flex-start', backgroundColor: t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth, gap: 8, width: 190 }]}>
                <SkeletonBlock height={12} radius={6} />
                <SkeletonBlock height={12} width="70%" radius={6} />
              </View>
            )}
          </View>
        </ScrollView>

        <View style={[styles.inputBar, { backgroundColor: t.background, borderTopColor: t.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask anything about your money…"
            placeholderTextColor={t.textTertiary}
            style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
            multiline
            maxLength={1000}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => send(draft)}
          />
          <SpringPressable
            onPress={() => send(draft)}
            disabled={!draft.trim() || thinking}
            pressedScale={0.88}
            style={[styles.send, { backgroundColor: t.accent, opacity: !draft.trim() || thinking ? 0.4 : 1, shadowColor: t.accent }]}
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={22} color={t.accentText} />
          </SpringPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 24 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: 0.3, marginBottom: 16 },
  refreshLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshText: { fontSize: 13, fontWeight: '600' },
  moreBtn: { alignSelf: 'center', paddingVertical: 12 },
  moreText: { fontSize: 14, fontWeight: '700' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  source: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  headline: { fontSize: 22, fontWeight: '800', lineHeight: 28, marginBottom: 14 },
  tips: { gap: 10 },
  aiNote: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1 },
  noticeText: { flex: 1, fontSize: 14, fontWeight: '600' },
  section: { fontSize: 20, fontWeight: '700', marginTop: 30, marginBottom: 12 },
  askRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  askTitle: { flex: 1 },
  clear: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 11 },
  chipText: { fontSize: 14, fontWeight: '600' },
  bubble: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleText: { fontSize: 15 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
});
