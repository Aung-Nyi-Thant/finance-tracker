/** The Dashboard screen with the store mocked: checks what the user sees for each state of the data. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '../../services/api';
import Dashboard from '../../app/(tabs)/index';
import { useTransactions } from '../../store/TransactionsContext';
import { advice, budget, categoryTotal, isoDaysAgo, summary, tx } from '../test-data';

jest.mock('../../services/api');
jest.mock('../../store/TransactionsContext');
jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const useTransactionsMock = useTransactions as jest.MockedFunction<typeof useTransactions>;
const router = () => require('expo-router').useRouter();

const refresh = jest.fn();
const changeMonth = jest.fn();
const updateTransaction = jest.fn().mockResolvedValue(undefined);
const deleteTransaction = jest.fn().mockResolvedValue(undefined);
function state(overrides: Partial<ReturnType<typeof useTransactions>> = {}) {
  useTransactionsMock.mockReturnValue({
    transactions: [
      tx({ merchant_name: 'Cafe Amazon', amount: 85, transaction_date: isoDaysAgo(0) }),
      tx({ merchant_name: 'Tops Market', amount: 1840.5, category: 'Groceries', transaction_date: isoDaysAgo(1) }),
    ],
    pending: [],
    advice: advice(),
    budgets: [budget(), budget({ category: 'Food', monthly_limit: 3000, spent: 605, percent: 20.2 })],
    notice: null,
    summary: summary(),
    loading: false,
    error: null,
    month: '2026-10',
    isCurrentMonth: true,
    changeMonth,
    updateTransaction,
    deleteTransaction,
    refresh,
    refreshPending: jest.fn(),
    confirmPending: jest.fn(),
    discardPending: jest.fn(),
    saveTransaction: jest.fn(),
    dismissNotice: jest.fn(),
    ...overrides,
  } as ReturnType<typeof useTransactions>);
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.searchTransactions as jest.Mock).mockResolvedValue({ results: [], interpretation: [] });
});

describe('Dashboard', () => {
  it('shows the overview: title, hero card, budgets, categories and recent slips', async () => {
    state();
    await render(<Dashboard />);

    expect(screen.getByText('Overview')).toBeOnTheScreen();
    expect(screen.getByText('฿5,434.50')).toBeOnTheScreen(); // hero card total (whole + cents)
    expect(screen.getByText('Budgets')).toBeOnTheScreen();
    expect(screen.getByText('Monthly budget')).toBeOnTheScreen();
    expect(screen.getByText('Categories')).toBeOnTheScreen();
    expect(screen.getByText('Recent slips')).toBeOnTheScreen();
    expect(screen.getByText('Cafe Amazon')).toBeOnTheScreen();
    expect(screen.getByText('Tops Market')).toBeOnTheScreen();
  });

  it('loads fresh data when the screen is focused', async () => {
    state();
    await render(<Dashboard />);
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the AI insight card', async () => {
    state();
    await render(<Dashboard />);
    expect(screen.getByText('฿5,434.50 spent, 1 thing to watch')).toBeOnTheScreen();
    expect(screen.getByText(/At this rate you will spend/)).toBeOnTheScreen();
  });

  it('shows budget alerts, capped at two with a count of the rest', async () => {
    const alerts = [
      { level: 'over' as const, category: 'Food' as const, message: 'Dining out budget is exceeded: ฿105 of ฿100 (105%)' },
      { level: 'warning' as const, category: null, message: 'Your monthly budget is almost used up: ฿464 of ฿500 (93%)' },
      { level: 'warning' as const, category: 'Entertainment' as const, message: 'Games budget is almost used up: ฿66 of ฿70 (96%)' },
    ];
    state({ summary: summary({ alerts }) });
    await render(<Dashboard />);
    expect(screen.getByText(alerts[0].message)).toBeOnTheScreen();
    expect(screen.getByText(alerts[1].message)).toBeOnTheScreen();
    expect(screen.queryByText(alerts[2].message)).toBeNull();
    expect(screen.getByText('+1 more budget alert')).toBeOnTheScreen();
  });

  it('points to the Inbox when slips are waiting for confirmation', async () => {
    state({ pending: [tx({ status: 'pending' }), tx({ status: 'pending' })] });
    await render(<Dashboard />);
    await fireEvent.press(screen.getByText('2 slips ready to confirm'));
    expect(router().navigate).toHaveBeenCalledWith('/add');
  });

  it('uses the singular for one waiting slip', async () => {
    state({ pending: [tx({ status: 'pending' })] });
    await render(<Dashboard />);
    expect(screen.getByText('1 slip ready to confirm')).toBeOnTheScreen();
  });

  it('shows a friendly empty state with a way to the Inbox', async () => {
    state({ transactions: [], summary: summary({ categories: [], total_spent: 0, total_income: 0, transaction_count: 0 }), budgets: [], advice: null });
    await render(<Dashboard />);
    expect(screen.getByText('No slips yet')).toBeOnTheScreen();
    expect(screen.getByText('Set a spending limit')).toBeOnTheScreen(); // budget call-to-action
    await fireEvent.press(screen.getByText('Open Inbox'));
    expect(router().navigate).toHaveBeenCalledWith('/add');
  });

  it('shows a connection error without hiding the screen', async () => {
    state({ error: 'Cannot reach the server at http://localhost:8000. Is the backend running?' });
    await render(<Dashboard />);
    expect(screen.getByText(/Cannot reach the server/)).toBeOnTheScreen();
    expect(screen.getByText('Overview')).toBeOnTheScreen();
  });

  it('filters the feed when a category chip is tapped, and clears it', async () => {
    state({ summary: summary({ categories: [categoryTotal({ category: 'Groceries', total: 1840.5 }), categoryTotal({ category: 'Food' })] }) });
    (api.searchTransactions as jest.Mock).mockResolvedValue({
      results: [tx({ merchant_name: 'Tops Market', category: 'Groceries' })],
      interpretation: ['Groceries'],
    });
    await render(<Dashboard />);

    await fireEvent.press(screen.getByText('฿1,840.50')); // the Groceries chip
    await waitFor(() => expect(api.searchTransactions).toHaveBeenCalledWith('', 'Groceries', 50, null));
    expect(await screen.findByText('1 slip · Groceries')).toBeOnTheScreen();
    expect(screen.queryByText('Cafe Amazon')).toBeNull();

    await fireEvent.press(screen.getByText('Clear filter'));
    expect(await screen.findByText('Cafe Amazon')).toBeOnTheScreen();
  });

  it('opens the budget editor from the hero card', async () => {
    state();
    (api.getBudgets as jest.Mock).mockResolvedValue([]);
    await render(<Dashboard />);
    await fireEvent.press(screen.getAllByText('Edit')[0]);
    expect(await screen.findByText('Monthly budgets')).toBeOnTheScreen();
  });

  it('moves between months with the arrows on the hero card', async () => {
    state({ month: '2026-08', isCurrentMonth: false, summary: summary({ month: '2026-08' }) });
    await render(<Dashboard />);
    expect(screen.getByText('August 2026')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Previous month'));
    expect(changeMonth).toHaveBeenLastCalledWith(-1);
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(changeMonth).toHaveBeenLastCalledWith(1);
  });

  it('on the current month the forward arrow does nothing', async () => {
    state();
    await render(<Dashboard />);
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(changeMonth).not.toHaveBeenCalled();
  });

  it('scopes search to a past month but not to the current one', async () => {
    (api.searchTransactions as jest.Mock).mockResolvedValue({ results: [], interpretation: [] });
    state({ month: '2026-08', isCurrentMonth: false });
    await render(<Dashboard />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'cafe');
    await waitFor(() => expect(api.searchTransactions).toHaveBeenCalledWith('cafe', null, 50, '2026-08'));
  });

  it('opens the editor when a slip is tapped, and saves a correction', async () => {
    state();
    await render(<Dashboard />);
    await fireEvent.press(screen.getByLabelText('Edit Cafe Amazon'));
    expect(await screen.findByText('Edit slip')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Amount'), '95');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith(expect.any(Number), { amount: 95 }));
  });
});

