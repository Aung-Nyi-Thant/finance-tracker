import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Category } from '../types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface CategoryStyle {
  /** Canonical category the raw value resolved to. */
  category: Category;
  icon: IconName;
  color: string;
  /** Short display name. */
  label: string;
}

const STYLES: Record<Category, Omit<CategoryStyle, 'category'>> = {
  Food: { icon: 'restaurant', color: '#7C9CFF', label: 'Food' },
  Groceries: { icon: 'cart', color: '#2DD4BF', label: 'Groceries' },
  Transport: { icon: 'car', color: '#38BDF8', label: 'Transport' },
  Shopping: { icon: 'bag-handle', color: '#F472B6', label: 'Shopping' },
  Entertainment: { icon: 'game-controller', color: '#B28DFF', label: 'Games' },
  Bills: { icon: 'flash', color: '#FBBF24', label: 'Utilities' },
  Health: { icon: 'heart', color: '#FB7185', label: 'Health' },
  Income: { icon: 'trending-up', color: '#34D399', label: 'Income' },
  Other: { icon: 'ellipsis-horizontal-circle', color: '#94A3B8', label: 'Other' },
};

/** Friendly spellings (and the names used in design briefs) that map onto the canonical categories. */
const ALIASES: Record<string, Category> = {
  food: 'Food',
  dining: 'Food',
  restaurant: 'Food',
  restaurants: 'Food',
  cafe: 'Food',
  coffee: 'Food',
  groceries: 'Groceries',
  grocery: 'Groceries',
  transport: 'Transport',
  transportation: 'Transport',
  travel: 'Transport',
  taxi: 'Transport',
  bus: 'Transport',
  car: 'Transport',
  fuel: 'Transport',
  shopping: 'Shopping',
  shop: 'Shopping',
  retail: 'Shopping',
  clothes: 'Shopping',
  entertainment: 'Entertainment',
  games: 'Entertainment',
  game: 'Entertainment',
  gaming: 'Entertainment',
  movies: 'Entertainment',
  bills: 'Bills',
  bill: 'Bills',
  utilities: 'Bills',
  utility: 'Bills',
  health: 'Health',
  medical: 'Health',
  pharmacy: 'Health',
  income: 'Income',
  salary: 'Income',
  other: 'Other',
  others: 'Other',
};

/** Resolve any backend/AI/user-supplied category string to one of the canonical categories. */
export function resolveCategory(raw: string | null | undefined): Category {
  const key = (raw ?? '').trim().toLowerCase();
  return ALIASES[key] ?? 'Other';
}

/** Icon, accent colour and label for a category. Unknown values fall back to "Other". */
export function categoryStyle(raw: string | null | undefined): CategoryStyle {
  const category = resolveCategory(raw);
  return { category, ...STYLES[category] };
}

export function categoryLabel(raw: string | null | undefined): string {
  return categoryStyle(raw).label;
}
