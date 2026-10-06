import { fireEvent, render, screen } from '@testing-library/react-native';
import { BudgetCards } from '../../components/BudgetCards';
import { budget } from '../test-data';

jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

describe('BudgetCards (3D progress cards)', () => {
  it('shows one card per budget with what is left', async () => {
    await render(
      <BudgetCards
        budgets={[budget(), budget({ category: 'Food', monthly_limit: 3000, spent: 605, percent: 20.2 })]}
        onEdit={jest.fn()}
      />,
    );
    expect(screen.getByText('Monthly budget')).toBeOnTheScreen();
    expect(screen.getByText('฿14,565.50 left')).toBeOnTheScreen();
    expect(screen.getByText('of ฿20,000.00')).toBeOnTheScreen();
    expect(screen.getByText('Food')).toBeOnTheScreen();
    expect(screen.getByText('฿2,395.00 left')).toBeOnTheScreen();
    expect(screen.getByText('27%')).toBeOnTheScreen();
    expect(screen.getByText('20%')).toBeOnTheScreen();
  });

  it('shows how far over an exceeded budget you are', async () => {
    await render(<BudgetCards budgets={[budget({ category: 'Entertainment', monthly_limit: 350, spent: 500, percent: 142.9, status: 'over' })]} onEdit={jest.fn()} />);
    expect(screen.getByText('Games')).toBeOnTheScreen();
    expect(screen.getByText('฿150.00 over')).toBeOnTheScreen();
    expect(screen.getByText('143%')).toBeOnTheScreen();
  });

  it('puts the overall budget first, then the most-used categories', async () => {
    await render(
      <BudgetCards
        budgets={[
          budget({ category: 'Food', percent: 10, monthly_limit: 100, spent: 10 }),
          budget({ category: 'Shopping', percent: 90, monthly_limit: 100, spent: 90, status: 'warning' }),
          budget({ category: 'Total', percent: 5, monthly_limit: 1000, spent: 50 }),
        ]}
        onEdit={jest.fn()}
      />,
    );
    const labels = screen.getAllByText(/^(Monthly budget|Shopping|Food)$/).map((n) => n.props.children);
    expect(labels).toEqual(['Monthly budget', 'Shopping', 'Food']);
  });

  it('opens the editor from the header', async () => {
    const onEdit = jest.fn();
    await render(<BudgetCards budgets={[budget()]} onEdit={onEdit} />);
    await fireEvent.press(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows a call to action when no budgets are set', async () => {
    const onEdit = jest.fn();
    await render(<BudgetCards budgets={[]} onEdit={onEdit} />);
    expect(screen.getByText('Set a spending limit')).toBeOnTheScreen();
    expect(screen.getByText('Set up')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Set a spending limit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
