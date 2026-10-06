export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  /** Decimal places shown for this currency. */
  decimals: number;
}

/**
 * Must match CURRENCIES in backend/models.py. Display only: amounts are never converted.
 * Symbols come from this table rather than Intl, because Hermes' Intl falls back to the ISO code
 * (e.g. "THB 120.00") for many currencies.
 */
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', decimals: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF ', decimals: 2 },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', decimals: 0 },
];

export const DEFAULT_CURRENCY = 'THB';

export interface MoneyFormatter {
  currency: string;
  symbol: string;
  /** "฿1,234.50" */
  format: (value: number) => string;
  /** Splits a formatted amount into a large part and a small fractional tail: ["฿1,234", ".50"]. */
  split: (value: number) => [string, string];
}

export function makeFormatter(currency: string): MoneyFormatter {
  const info = CURRENCIES.find((c) => c.code === currency) ?? { code: currency, name: currency, symbol: `${currency} `, decimals: 2 };
  const nf = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  });
  const format = (value: number) => `${value < 0 ? '-' : ''}${info.symbol}${nf.format(Math.abs(value))}`;
  const split = (value: number): [string, string] => {
    const text = format(value);
    const i = text.lastIndexOf('.');
    return i === -1 ? [text, ''] : [text.slice(0, i), text.slice(i)];
  };
  return { currency, symbol: info.symbol.trim(), format, split };
}
