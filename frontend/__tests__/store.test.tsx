/** TransactionsContext: loading, the confirm flow, the "saved" notice, and failure handling. */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as api from '../services/api';
import { TransactionsProvider, shiftMonth, useTransactions } from '../store/TransactionsContext';
import { todayISO } from '../utils/format';
import { advice, budget, summary, tx } from './test-data';

const thisMonth = todayISO().slice(0, 7);

jest.mock('../services/api');

const mocked = api as jest.Mocked<typeof api>;
const wrapper = ({ children }: { children: ReactNode }) => <TransactionsProvider>{children}</TransactionsProvider>;

function stubBackend() {
  mocked.getTransactions.mockResolvedValue([tx({ id: 1, merchant_name: 'Cafe' })]);
  mocked.getSummary.mockResolvedValue(summary());
  mocked.getPending.mockResolvedValue([tx({ id: 2, status: 'pending' })]);
  mocked.getAdvice.mockResolvedValue(advice());
  mocked.getBudgets.mockResolvedValue([budget()]);
}

beforeEach(() => {
  jest.resetAllMocks();
  stubBackend();
});

describe('TransactionsContext', () => {
  it('must be used inside its provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useTransactions())).rejects.toThrow('useTransactions must be used inside <TransactionsProvider>');
  });

  it('starts empty and loads everything on refresh', async () => {
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    expect(result.current.transactions).toEqual([]);

    await act(async () => { await result.current.refresh(); });

    expect(result.current.transactions.map((t) => t.merchant_name)).toEqual(['Cafe']);
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.summary?.total_spent).toBe(5434.5);
    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.advice?.headline).toContain('spent');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mocked.getAdvice).toHaveBeenCalledWith({ ai: false, month: thisMonth }); // the dashboard never triggers a Gemini call
  });

  it('keeps working when the optional advice and budget requests fail', async () => {
    mocked.getAdvice.mockRejectedValue(new Error('no AI'));
    mocked.getBudgets.mockRejectedValue(new Error('no budgets'));
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.advice).toBeNull();
  });

  it('reports a failed refresh and keeps the previous data', async () => {
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await act(async () => { await result.current.refresh(); });

    mocked.getTransactions.mockRejectedValue(new Error('Cannot reach the server'));
    await act(async () => { await result.current.refresh(); });

    expect(result.current.error).toBe('Cannot reach the server');
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('confirming a slip saves it, shows the budget impact and reloads', async () => {
    mocked.confirmTransaction.mockResolvedValue({
      ...tx({ id: 2 }),
      impact: { message: 'Games: ฿299.00 of ฿350.00 (85%). Getting close to your limit.', category: 'Entertainment', category_spent: 299, category_budget: 350, category_percent: 85, total_spent: 5434.5, total_budget: 20000, total_percent: 27, status: 'warning' },
    });
    const { result } = await renderHook(() => useTransactions(), { wrapper });

    await act(async () => { await result.current.confirmPending(2, { amount: 299 }); });

    expect(mocked.confirmTransaction).toHaveBeenCalledWith(2, { amount: 299 });
    expect(result.current.notice?.message).toContain('Getting close');
    expect(mocked.getTransactions).toHaveBeenCalled(); // refreshed afterwards
    expect(result.current.notice?.status).toBe('warning'); // the refresh did not wipe the notice
  });

  it('the "saved" notice clears itself after a few seconds, or on dismiss', async () => {
    jest.useFakeTimers();
    try {
      mocked.createTransaction.mockResolvedValue({ ...tx(), impact: { message: 'ok', category: 'Food', category_spent: 1, category_budget: null, category_percent: null, total_spent: 1, total_budget: null, total_percent: null, status: 'ok' } });
      const { result } = await renderHook(() => useTransactions(), { wrapper });

      await act(async () => { await result.current.saveTransaction({ amount: 1, merchant_name: 'x', category: 'Food', transaction_date: '2026-10-06' }); });
      expect(result.current.notice).not.toBeNull();
      await act(async () => { await jest.advanceTimersByTimeAsync(4300); });
      expect(result.current.notice).toBeNull();

      await act(async () => { await result.current.saveTransaction({ amount: 1, merchant_name: 'x', category: 'Food', transaction_date: '2026-10-06' }); });
      await act(async () => { result.current.dismissNotice(); });
      expect(result.current.notice).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed save is reported to the caller and leaves state untouched', async () => {
    mocked.confirmTransaction.mockRejectedValue(new Error('Invalid amount'));
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await expect(act(async () => { await result.current.confirmPending(2); })).rejects.toThrow('Invalid amount');
    expect(result.current.notice).toBeNull();
  });

  it('discarding a slip removes it from the pending list', async () => {
    mocked.discardTransaction.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await act(async () => { await result.current.refresh(); });

    mocked.getPending.mockResolvedValue([]);
    await act(async () => { await result.current.discardPending(2); });

    expect(mocked.discardTransaction).toHaveBeenCalledWith(2);
    await waitFor(() => expect(result.current.pending).toEqual([]));
  });

  it('starts on the current month and cannot move into the future', async () => {
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    expect(result.current.month).toBe(thisMonth);
    expect(result.current.isCurrentMonth).toBe(true);
    await act(async () => { result.current.changeMonth(1); });
    expect(result.current.month).toBe(thisMonth);
  });

  it('moving to a past month loads that month\'s summary, slips, budgets and advice', async () => {
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    const previous = shiftMonth(thisMonth, -1);

    await act(async () => { result.current.changeMonth(-1); });
    expect(result.current.month).toBe(previous);
    expect(result.current.isCurrentMonth).toBe(false);

    await act(async () => { await result.current.refresh(); });
    expect(mocked.getSummary).toHaveBeenLastCalledWith(previous);
    expect(mocked.getTransactions).toHaveBeenLastCalledWith(200, previous); // every slip of that month, not just the latest 30
    expect(mocked.getBudgets).toHaveBeenLastCalledWith(previous);
    expect(mocked.getAdvice).toHaveBeenLastCalledWith({ ai: false, month: previous });

    await act(async () => { result.current.changeMonth(1); });
    expect(result.current.month).toBe(thisMonth);
    await act(async () => { await result.current.refresh(); });
    expect(mocked.getTransactions).toHaveBeenLastCalledWith(30); // current month: the latest slips overall
  });

  it('editing a saved slip sends the changes, shows the budget impact and reloads', async () => {
    mocked.updateTransaction.mockResolvedValue({
      ...tx({ id: 1 }),
      impact: { message: 'Food: ฿900.00 of ฿3,000.00 (30%).', category: 'Food', category_spent: 900, category_budget: 3000, category_percent: 30, total_spent: 900, total_budget: null, total_percent: null, status: 'ok' },
    });
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await act(async () => { await result.current.updateTransaction(1, { amount: 900 }); });
    expect(mocked.updateTransaction).toHaveBeenCalledWith(1, { amount: 900 });
    expect(result.current.notice?.message).toContain('฿900.00');
    expect(mocked.getTransactions).toHaveBeenCalled();
  });

  it('deleting a saved slip removes it and reloads', async () => {
    mocked.deleteTransaction.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await act(async () => { await result.current.deleteTransaction(1); });
    expect(mocked.deleteTransaction).toHaveBeenCalledWith(1);
    expect(mocked.getSummary).toHaveBeenCalled();
  });

  it('failed edits and deletes reach the caller', async () => {
    mocked.updateTransaction.mockRejectedValue(new Error('Nothing to update'));
    mocked.deleteTransaction.mockRejectedValue(new Error('Transaction not found'));
    const { result } = await renderHook(() => useTransactions(), { wrapper });
    await expect(act(async () => { await result.current.updateTransaction(1, {}); })).rejects.toThrow('Nothing to update');
    await expect(act(async () => { await result.current.deleteTransaction(1); })).rejects.toThrow('Transaction not found');
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', -10)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});
