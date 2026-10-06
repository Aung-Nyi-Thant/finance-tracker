import { resolveCategory, categoryStyle, categoryLabel } from '../theme/categories';
import { makeFormatter, CURRENCIES } from '../utils/currency';
import { dateToISO, isValidISODate, relativeDay, formatMonth, formatDay, greeting, isoToDate } from '../utils/format';
import { hasMyanmar, lineHeightFor } from '../utils/text';
import { mix, rgba } from '../theme/fx';

describe('category icons and labels', () => {
  it.each([
    ['food', 'Food'], ['FOOD', 'Food'], ['dining', 'Food'],
    ['games', 'Entertainment'], ['gaming', 'Entertainment'],
    ['utilities', 'Bills'], ['bill', 'Bills'],
    ['others', 'Other'], ['  transport ', 'Transport'], ['salary', 'Income'],
  ])('maps %p to %p', (raw, expected) => {
    expect(resolveCategory(raw)).toBe(expected);
  });

  it('falls back to Other for unknown, empty and missing values', () => {
    expect(resolveCategory('spaceships')).toBe('Other');
    expect(resolveCategory('')).toBe('Other');
    expect(resolveCategory(null)).toBe('Other');
    expect(resolveCategory(undefined)).toBe('Other');
  });

  it('gives each category its own icon and colour', () => {
    expect(categoryStyle('Food').icon).toBe('restaurant'); // fork and knife
    expect(categoryStyle('games').icon).toBe('game-controller');
    expect(categoryStyle('Transport').icon).toBe('car');
    expect(categoryStyle('Shopping').icon).toBe('bag-handle');
    expect(categoryLabel('Entertainment')).toBe('Games');
    expect(categoryLabel('Bills')).toBe('Utilities');
    const colours = ['Food', 'Groceries', 'Transport', 'Shopping', 'Entertainment', 'Bills', 'Health', 'Income', 'Other'].map((c) => categoryStyle(c).color);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe('money formatting', () => {
  it('formats baht with the ฿ symbol and two decimals', () => {
    const baht = makeFormatter('THB');
    expect(baht.format(1234.5)).toBe('฿1,234.50');
    expect(baht.symbol).toBe('฿');
    expect(baht.split(1234.5)).toEqual(['฿1,234', '.50']);
  });

  it('uses zero decimals for yen and kyat, and handles negatives', () => {
    expect(makeFormatter('JPY').format(1234.6)).toBe('¥1,235');
    expect(makeFormatter('JPY').split(1000)).toEqual(['¥1,000', '']);
    expect(makeFormatter('MMK').format(50000)).toBe('K50,000');
    expect(makeFormatter('THB').format(-5)).toBe('-฿5.00');
  });

  it('formats other supported currencies and tolerates unknown codes', () => {
    expect(makeFormatter('EUR').format(9.99)).toBe('€9.99');
    expect(makeFormatter('CHF').format(10)).toBe('CHF 10.00');
    expect(makeFormatter('XYZ').format(3)).toBe('XYZ 3.00');
  });

  it('lists baht first', () => {
    expect(CURRENCIES[0].code).toBe('THB');
  });
});

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2026-10-06')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('06/10/2026')).toBe(false);
  });

  it('round-trips without timezone drift', () => {
    expect(dateToISO(isoToDate('2026-03-01'))).toBe('2026-03-01');
  });

  it('describes days relative to today', () => {
    expect(relativeDay('2026-10-06', '2026-10-06')).toBe('Today');
    expect(relativeDay('2026-10-05', '2026-10-06')).toBe('Yesterday');
    expect(relativeDay('2026-10-04', '2026-10-06')).toBe('Sun, Oct 4');
  });

  it('formats months and days', () => {
    expect(formatMonth('2026-10')).toBe('October 2026');
    expect(formatDay('2026-10-06')).toBe('Oct 6');
  });

  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 9, 6, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 6, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 9, 6, 20))).toBe('Good evening');
    expect(greeting(new Date(2026, 9, 6, 2))).toBe('Good night');
  });
});

describe('Burmese text support', () => {
  it('detects Myanmar script', () => {
    expect(hasMyanmar('ဒီလ အစားအသောက်')).toBe(true);
    expect(hasMyanmar('Starbucks')).toBe(false);
  });

  it('gives Myanmar text a taller line box so stacked marks are not clipped', () => {
    expect(lineHeightFor('ဒီလ', 15)).toBeGreaterThan(lineHeightFor('this month', 15));
  });
});

describe('colour helpers', () => {
  it('mixes and converts hex colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    expect(rgba('#FF0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });
});
