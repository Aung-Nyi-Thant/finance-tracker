import React, {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../services/api';
import { todayISO } from '../utils/format';
import type { Advice, Budget, Impact, PendingEdits, SavedTransaction, Summary, Transaction, TransactionDraft } from '../types';

interface State {
  transactions: Transaction[];
  pending: Transaction[];
  advice: Advice | null;
  budgets: Budget[];
  /** Brief feedback after saving a slip: how it moved this month's budget. */
  notice: Impact | null;
  summary: Summary | null;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; transactions: Transaction[]; summary: Summary; pending: Transaction[]; advice: Advice | null; budgets: Budget[] | null }
  | { type: 'SET_PENDING'; pending: Transaction[] }
  | { type: 'SET_NOTICE'; notice: Impact | null }
  | { type: 'LOAD_ERROR'; error: string };

const initialState: State = { transactions: [], pending: [], advice: null, budgets: [], notice: null, summary: null, loading: false, error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return {
        ...state,
        transactions: action.transactions,
        pending: action.pending,
        advice: action.advice ?? state.advice,
        budgets: action.budgets ?? state.budgets,
        summary: action.summary,
        loading: false,
        error: null,
      };
    case 'SET_NOTICE':
      return { ...state, notice: action.notice };
    case 'SET_PENDING':
      return { ...state, pending: action.pending };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
  }
}

/** "2026-10" shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

interface ContextValue extends State {
  /** The month the dashboard is showing, "YYYY-MM". Defaults to the current month. */
  month: string;
  isCurrentMonth: boolean;
  /** Move the dashboard to another month; future months are ignored. */
  changeMonth: (delta: -1 | 1) => void;
  refresh: () => Promise<void>;
  refreshPending: () => Promise<void>;
  confirmPending: (id: number, edits?: PendingEdits) => Promise<void>;
  discardPending: (id: number) => Promise<void>;
  saveTransaction: (draft: TransactionDraft) => Promise<Transaction>;
  /** Correct a saved slip (amount, merchant, category and/or date). */
  updateTransaction: (id: number, edits: PendingEdits) => Promise<void>;
  /** Delete a saved slip. */
  deleteTransaction: (id: number) => Promise<void>;
  dismissNotice: () => void;
}

const TransactionsContext = createContext<ContextValue | null>(null);

export function TransactionsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const currentMonth = todayISO().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const isCurrentMonth = month === currentMonth;

  const changeMonth = useCallback(
    (delta: -1 | 1) => setMonth((m) => (delta === 1 && m >= currentMonth ? m : shiftMonth(m, delta))),
    [currentMonth],
  );

  const refresh = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    try {
      const [transactions, summary, pending, advice, budgets] = await Promise.all([
        // current month: the latest slips overall; a past month: that month's slips
        isCurrentMonth ? api.getTransactions(30) : api.getTransactions(200, month),
        api.getSummary(month),
        api.getPending(),
        api.getAdvice({ ai: false, month }).catch(() => null), // nice-to-have, never blocks the dashboard
        api.getBudgets(month).catch(() => null),
      ]);
      dispatch({ type: 'LOAD_SUCCESS', transactions, summary, pending, advice, budgets });
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: (err as Error).message });
    }
  }, [month, isCurrentMonth]);

  const refreshPending = useCallback(async () => {
    try {
      dispatch({ type: 'SET_PENDING', pending: await api.getPending() });
    } catch {
      // surfaced by the next full refresh
    }
  }, []);

  const confirmPending = useCallback(
    async (id: number, edits?: PendingEdits) => {
      const saved = await api.confirmTransaction(id, edits);
      dispatch({ type: 'SET_NOTICE', notice: saved.impact });
      await refresh();
    },
    [refresh],
  );

  const discardPending = useCallback(
    async (id: number) => {
      await api.discardTransaction(id);
      await refreshPending();
    },
    [refreshPending],
  );

  const saveTransaction = useCallback(
    async (draft: TransactionDraft) => {
      const saved: SavedTransaction = await api.createTransaction(draft);
      dispatch({ type: 'SET_NOTICE', notice: saved.impact });
      await refresh();
      return saved;
    },
    [refresh],
  );

  const updateTransaction = useCallback(
    async (id: number, edits: PendingEdits) => {
      const saved = await api.updateTransaction(id, edits);
      dispatch({ type: 'SET_NOTICE', notice: saved.impact });
      await refresh();
    },
    [refresh],
  );

  const deleteTransaction = useCallback(
    async (id: number) => {
      await api.deleteTransaction(id);
      await refresh();
    },
    [refresh],
  );

  const dismissNotice = useCallback(() => dispatch({ type: 'SET_NOTICE', notice: null }), []);

  // Feedback toast clears itself.
  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(dismissNotice, 4200);
    return () => clearTimeout(timer);
  }, [state.notice, dismissNotice]);

  const value = useMemo(
    () => ({
      ...state,
      month,
      isCurrentMonth,
      changeMonth,
      refresh,
      refreshPending,
      confirmPending,
      discardPending,
      saveTransaction,
      updateTransaction,
      deleteTransaction,
      dismissNotice,
    }),
    [state, month, isCurrentMonth, changeMonth, refresh, refreshPending, confirmPending, discardPending, saveTransaction, updateTransaction, deleteTransaction, dismissNotice],
  );

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions(): ContextValue {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions must be used inside <TransactionsProvider>');
  return ctx;
}
