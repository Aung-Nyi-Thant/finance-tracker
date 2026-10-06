import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Palette } from './colors';
import type { BudgetStatus, Tip } from '../types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const AMBER = '#FBBF24';

export function severityStyle(severity: Tip['severity'], t: Palette): { color: string; icon: IconName } {
  switch (severity) {
    case 'warning':
      return { color: AMBER, icon: 'warning' };
    case 'positive':
      return { color: t.positive, icon: 'checkmark-circle' };
    default:
      return { color: t.accent, icon: 'information-circle' };
  }
}

export function budgetColor(status: BudgetStatus | null | undefined, fallback: string, t: Palette): string {
  if (status === 'over') return t.danger;
  if (status === 'warning') return AMBER;
  return fallback;
}
