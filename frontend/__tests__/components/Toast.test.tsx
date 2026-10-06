import { fireEvent, render, screen } from '@testing-library/react-native';
import { Toast } from '../../components/Toast';
import { useTransactions } from '../../store/TransactionsContext';
import type { Impact } from '../../types';

jest.mock('../../store/TransactionsContext');
const useTransactionsMock = useTransactions as jest.MockedFunction<typeof useTransactions>;

const impact = (overrides: Partial<Impact> = {}): Impact => ({
  message: 'Games: ฿299.00 of ฿350.00 (85%). Getting close to your limit.',
  category: 'Entertainment', category_spent: 299, category_budget: 350, category_percent: 85,
  total_spent: 5434.5, total_budget: 20000, total_percent: 27, status: 'warning', ...overrides,
});

function setup(notice: Impact | null) {
  const dismissNotice = jest.fn();
  useTransactionsMock.mockReturnValue({ notice, dismissNotice } as unknown as ReturnType<typeof useTransactions>);
  return { dismissNotice };
}

describe('Toast', () => {
  it('tells you what the saved slip did to your budget', async () => {
    setup(impact());
    await render(<Toast />);
    expect(screen.getByText(/Saved\./)).toBeOnTheScreen();
    expect(screen.getByText(/Games: ฿299.00 of ฿350.00/)).toBeOnTheScreen();
  });

  it('dismisses on tap', async () => {
    const { dismissNotice } = setup(impact({ status: 'over', message: 'Over budget.' }));
    await render(<Toast />);
    await fireEvent.press(screen.getByText(/Over budget/));
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there is no notice', async () => {
    setup(null);
    await render(<Toast />);
    expect(screen.queryByText(/Saved\./)).toBeNull();
  });
});
