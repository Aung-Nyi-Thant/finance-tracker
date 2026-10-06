export const CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Shopping',
  'Entertainment',
  'Bills',
  'Health',
  'Income',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Transaction {
  id: number;
  amount: number;
  merchant_name: string;
  category: Category;
  transaction_date: string; // YYYY-MM-DD
  status: 'pending' | 'confirmed';
  created_at: string;
}

export interface TransactionDraft {
  amount: number;
  merchant_name: string;
  category: Category;
  transaction_date: string;
}

export type BudgetStatus = 'ok' | 'warning' | 'over';

export interface CategoryTotal {
  category: Category;
  total: number;
  count: number;
  percent: number;
  budget: number | null;
  budget_percent: number | null;
  status: BudgetStatus | null;
}

export interface Alert {
  level: 'warning' | 'over';
  category: Category | null; // null = overall monthly budget
  message: string;
}

export interface Summary {
  month: string; // YYYY-MM
  total_spent: number;
  total_income: number;
  transaction_count: number;
  categories: CategoryTotal[];
  total_budget: number | null;
  total_budget_percent: number | null;
  total_status: BudgetStatus | null;
  alerts: Alert[];
}

export interface Impact {
  message: string;
  category: Category;
  category_spent: number;
  category_budget: number | null;
  category_percent: number | null;
  total_spent: number;
  total_budget: number | null;
  total_percent: number | null;
  status: BudgetStatus;
}

/** A just-saved transaction plus how it moved this month's budget picture. */
export interface SavedTransaction extends Transaction {
  impact: Impact | null;
}

export interface PendingEdits {
  amount?: number;
  merchant_name?: string;
  category?: Category;
  transaction_date?: string;
}

export type BudgetKey = 'Total' | Exclude<Category, 'Income'>;

export interface Budget {
  category: BudgetKey;
  monthly_limit: number;
  spent: number;
  percent: number;
  status: BudgetStatus;
}

export interface Tip {
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'positive';
  category: Category | null;
}

export interface Advice {
  month: string;
  headline: string;
  tips: Tip[];
  source: 'ai' | 'rules';
  generated_at: string;
  ai_error: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SearchResult {
  results: Transaction[];
  /** How the query was understood, e.g. ["Food", "over 200", "last month"]. */
  interpretation: string[];
}

export interface Settings {
  currency: string;
}
