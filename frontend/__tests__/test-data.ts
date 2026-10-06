/** Builders shared by the component and screen tests. */
import type { Advice, Budget, CategoryTotal, Summary, Transaction } from '../types';
import { dateToISO } from '../utils/format';

export const isoDaysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateToISO(d);
};

let nextId = 1;
export function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId++,
    amount: 100,
    merchant_name: 'Cafe Amazon',
    category: 'Food',
    transaction_date: isoDaysAgo(0),
    status: 'confirmed',
    created_at: '2026-10-06T10:00:00Z',
    ...overrides,
  };
}

export function categoryTotal(overrides: Partial<CategoryTotal> = {}): CategoryTotal {
  return { category: 'Food', total: 605, count: 2, percent: 50, budget: null, budget_percent: null, status: null, ...overrides };
}

export function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    month: '2026-10',
    total_spent: 5434.5,
    total_income: 45000,
    transaction_count: 7,
    categories: [categoryTotal({ category: 'Groceries', total: 1840.5, percent: 34 }), categoryTotal({ category: 'Food', total: 605, percent: 11 })],
    total_budget: 20000,
    total_budget_percent: 27.2,
    total_status: 'ok',
    alerts: [],
    ...overrides,
  };
}

export function budget(overrides: Partial<Budget> = {}): Budget {
  return { category: 'Total', monthly_limit: 20000, spent: 5434.5, percent: 27.2, status: 'ok', ...overrides };
}

export function advice(overrides: Partial<Advice> = {}): Advice {
  return {
    month: '2026-10',
    headline: '฿5,434.50 spent, 1 thing to watch',
    tips: [{ title: 'On pace to overspend', body: 'At this rate you will spend about ฿24,067.', severity: 'warning', category: null }],
    source: 'rules',
    generated_at: '2026-10-06T10:00:00Z',
    ai_error: null,
    ...overrides,
  };
}
