import { fireEvent, render, screen } from '@testing-library/react-native';
import { SummaryCard } from '../../components/SummaryCard';
import { summary } from '../test-data';

jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const handlers = () => ({ onCurrencyPress: jest.fn(), onBudgetPress: jest.fn() });

describe('SummaryCard (3D hero card)', () => {
  it('shows the month, currency, total spent, income and slip count', async () => {
    await render(<SummaryCard summary={summary()} {...handlers()} />);

    expect(screen.getByText('October 2026')).toBeOnTheScreen();
    expect(screen.getByText('THB')).toBeOnTheScreen();
    expect(screen.getByText('Total spent')).toBeOnTheScreen();
    expect(screen.getByText(/฿5,434/)).toBeOnTheScreen(); // whole part; the cents are a smaller nested Text
    expect(screen.getByText('.50')).toBeOnTheScreen();
    expect(screen.getByText('+฿45,000.00')).toBeOnTheScreen();
    expect(screen.getByText('7')).toBeOnTheScreen();
  });

  it('shows the remaining budget and how much is used', async () => {
    await render(<SummaryCard summary={summary()} {...handlers()} />);
    expect(screen.getByText('฿14,565.50')).toBeOnTheScreen(); // 20,000 - 5,434.50
    expect(screen.getByText(/27% of monthly budget used/)).toBeOnTheScreen();
  });

  it('says how far over budget you are', async () => {
    await render(<SummaryCard summary={summary({ total_spent: 21000.25, total_budget_percent: 105, total_status: 'over' })} {...handlers()} />);
    expect(screen.getByText('฿1,000.25 over')).toBeOnTheScreen();
    expect(screen.getByText(/105% of monthly budget used/)).toBeOnTheScreen();
  });

  it('invites you to set a budget when there is none, and opens the editor on press', async () => {
    const h = handlers();
    await render(<SummaryCard summary={summary({ total_budget: null, total_budget_percent: null, total_status: null })} {...h} />);
    expect(screen.queryByText(/of monthly budget used/)).toBeNull();
    await fireEvent.press(screen.getByText('Set a monthly budget'));
    expect(h.onBudgetPress).toHaveBeenCalledTimes(1);
  });

  it('lets you edit an existing budget and change the currency', async () => {
    const h = handlers();
    await render(<SummaryCard summary={summary()} {...h} />);
    await fireEvent.press(screen.getByText('Edit'));
    expect(h.onBudgetPress).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('THB'));
    expect(h.onCurrencyPress).toHaveBeenCalledTimes(1);
  });

  it('renders a sensible empty state before data has loaded', async () => {
    await render(<SummaryCard summary={null} {...handlers()} />);
    expect(screen.getByText('This month')).toBeOnTheScreen();
    expect(screen.getAllByText(/฿0/).length).toBeGreaterThanOrEqual(2); // total spent and income, both zero
    expect(screen.getByText('Set a monthly budget')).toBeOnTheScreen();
  });

  describe('browsing months', () => {
    it('shows the month being viewed, even before its data has arrived', async () => {
      await render(<SummaryCard summary={summary({ month: '2026-10' })} month="2026-08" {...handlers()} />);
      expect(screen.getByText('August 2026')).toBeOnTheScreen();
      expect(screen.queryByText('October 2026')).toBeNull();
    });

    it('goes back a month', async () => {
      const onPrevMonth = jest.fn();
      await render(<SummaryCard summary={summary()} month="2026-10" onPrevMonth={onPrevMonth} onNextMonth={jest.fn()} canGoNext={false} {...handlers()} />);
      await fireEvent.press(screen.getByLabelText('Previous month'));
      expect(onPrevMonth).toHaveBeenCalledTimes(1);
    });

    it('can go forward from a past month', async () => {
      const onNextMonth = jest.fn();
      await render(<SummaryCard summary={summary()} month="2026-08" onPrevMonth={jest.fn()} onNextMonth={onNextMonth} canGoNext {...handlers()} />);
      await fireEvent.press(screen.getByLabelText('Next month'));
      expect(onNextMonth).toHaveBeenCalledTimes(1);
    });

    it('cannot go past the current month', async () => {
      const onNextMonth = jest.fn();
      await render(<SummaryCard summary={summary()} month="2026-10" onPrevMonth={jest.fn()} onNextMonth={onNextMonth} canGoNext={false} {...handlers()} />);
      await fireEvent.press(screen.getByLabelText('Next month'));
      expect(onNextMonth).not.toHaveBeenCalled();
    });
  });
});
