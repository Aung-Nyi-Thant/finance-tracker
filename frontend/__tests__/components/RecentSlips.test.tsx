import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as api from '../../services/api';
import { RecentSlips } from '../../components/RecentSlips';
import { isoDaysAgo, tx } from '../test-data';

jest.mock('../../services/api');
jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const searchMock = api.searchTransactions as jest.MockedFunction<typeof api.searchTransactions>;

const flushSearch = () => act(async () => { await jest.advanceTimersByTimeAsync(300); });

beforeEach(() => {
  jest.useFakeTimers();
  searchMock.mockReset();
});
afterEach(() => jest.useRealTimers());

const base = [
  tx({ merchant_name: 'Cafe Amazon', amount: 85, transaction_date: isoDaysAgo(0) }),
  tx({ merchant_name: 'Som Tam Nua', amount: 520, transaction_date: isoDaysAgo(1) }),
  tx({ merchant_name: 'Uber', amount: 150, category: 'Transport', transaction_date: isoDaysAgo(1) }),
  tx({ merchant_name: 'Monthly Salary', amount: 45000, category: 'Income', transaction_date: isoDaysAgo(2) }),
];

describe('RecentSlips: the feed', () => {
  it('groups slips by day under Today and Yesterday headers', async () => {
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    expect(screen.getByText('TODAY')).toBeOnTheScreen();
    expect(screen.getByText('YESTERDAY')).toBeOnTheScreen();
    for (const name of ['Cafe Amazon', 'Som Tam Nua', 'Uber', 'Monthly Salary']) expect(screen.getByText(name)).toBeOnTheScreen();
  });

  it('shows spending as negative and income as positive', async () => {
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    expect(screen.getByText('−฿85.00')).toBeOnTheScreen();
    expect(screen.getByText('+฿45,000.00')).toBeOnTheScreen();
  });

  it('shows the 8 newest and expands on "See all"', async () => {
    const many = Array.from({ length: 11 }, (_, i) => tx({ merchant_name: `Shop ${i}`, transaction_date: isoDaysAgo(i) }));
    await render(<RecentSlips transactions={many} category={null} onClearCategory={jest.fn()} />);
    expect(screen.queryByText('Shop 8')).toBeNull();
    await fireEvent.press(screen.getByText('See all'));
    expect(screen.getByText('Shop 10')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Show less'));
    expect(screen.queryByText('Shop 10')).toBeNull();
  });

  it('does not offer "See all" for a short list', async () => {
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    expect(screen.queryByText('See all')).toBeNull();
  });
});

describe('RecentSlips: smart search', () => {
  it('searches the server (debounced) and replaces the feed with the results', async () => {
    searchMock.mockResolvedValue({ results: [tx({ merchant_name: 'Som Tam Nua', amount: 520 })], interpretation: ['Food', 'over 200'] });
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);

    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'food over 200');
    expect(searchMock).not.toHaveBeenCalled(); // still debouncing
    await flushSearch();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith('food over 200', null, 50, null);
    expect(screen.getByText('1 slip · Food · over 200')).toBeOnTheScreen(); // how the query was understood
    expect(screen.getByText('Som Tam Nua')).toBeOnTheScreen();
    expect(screen.queryByText('Uber')).toBeNull(); // the unfiltered feed is gone
  });

  it('only fires one request for fast typing', async () => {
    searchMock.mockResolvedValue({ results: [], interpretation: [] });
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    const input = screen.getByPlaceholderText(/Search/);
    await fireEvent.changeText(input, 'u');
    await fireEvent.changeText(input, 'ub');
    await fireEvent.changeText(input, 'uber');
    await flushSearch();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith('uber', null, 50, null);
  });

  it('goes back to the normal feed when the search is cleared', async () => {
    searchMock.mockResolvedValue({ results: [tx({ merchant_name: 'Uber' })], interpretation: ['“uber”'] });
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'uber');
    await flushSearch();
    expect(screen.queryByText('Cafe Amazon')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(screen.getByText('Cafe Amazon')).toBeOnTheScreen();
    expect(screen.queryByText(/slip ·/)).toBeNull();
  });

  it('says so when nothing matches', async () => {
    searchMock.mockResolvedValue({ results: [], interpretation: ['over 99999'] });
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'over 99999');
    await flushSearch();
    expect(screen.getByText('No slips match')).toBeOnTheScreen();
    expect(screen.getByText('0 slips · over 99999')).toBeOnTheScreen();
  });

  it('copes with a failing search', async () => {
    searchMock.mockRejectedValue(new Error('offline'));
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'uber');
    await flushSearch();
    expect(screen.getByText("Couldn't search right now.")).toBeOnTheScreen();
  });
});

describe('RecentSlips: category filter', () => {
  it('filters by the tapped category chip and can clear it', async () => {
    searchMock.mockResolvedValue({ results: [tx({ merchant_name: 'Uber', category: 'Transport' })], interpretation: ['Transport'] });
    const onClear = jest.fn();
    await render(<RecentSlips transactions={base} category="Transport" onClearCategory={onClear} />);
    await flushSearch();

    expect(searchMock).toHaveBeenCalledWith('', 'Transport', 50, null);
    expect(screen.getByText('1 slip · Transport')).toBeOnTheScreen();
    expect(screen.queryByText('Cafe Amazon')).toBeNull();

    await fireEvent.press(screen.getByText('Clear filter'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('re-runs the search when the underlying data changes (e.g. a slip was just saved)', async () => {
    searchMock.mockResolvedValue({ results: [], interpretation: [] });
    const { rerender } = await render(<RecentSlips transactions={base} category="Food" onClearCategory={jest.fn()} />);
    await flushSearch();
    expect(searchMock).toHaveBeenCalledTimes(1);

    await rerender(<RecentSlips transactions={[...base, tx({ merchant_name: 'New' })]} category="Food" onClearCategory={jest.fn()} />);
    await flushSearch();
    expect(searchMock).toHaveBeenCalledTimes(2);
  });
});

describe('RecentSlips: editing', () => {
  it('opens the editor for the slip you tap', async () => {
    const onEdit = jest.fn();
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} onEdit={onEdit} />);
    await fireEvent.press(screen.getByLabelText('Edit Som Tam Nua'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(base[1]);
  });

  it('also works on search results', async () => {
    const found = tx({ id: 99, merchant_name: 'Found Cafe' });
    searchMock.mockResolvedValue({ results: [found], interpretation: [] });
    const onEdit = jest.fn();
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} onEdit={onEdit} />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'found');
    await flushSearch();
    await fireEvent.press(screen.getByLabelText('Edit Found Cafe'));
    expect(onEdit).toHaveBeenCalledWith(found);
  });

  it('keeps searches inside the month being viewed', async () => {
    searchMock.mockResolvedValue({ results: [], interpretation: [] });
    await render(<RecentSlips transactions={base} category={null} onClearCategory={jest.fn()} month="2026-08" />);
    await fireEvent.changeText(screen.getByPlaceholderText(/Search/), 'cafe');
    await flushSearch();
    expect(searchMock).toHaveBeenCalledWith('cafe', null, 50, '2026-08');
  });
});

