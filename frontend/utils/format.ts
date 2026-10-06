const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-10-06" -> "Oct 6" (string math, avoids timezone shifts). */
export function formatDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** "2026-10" -> "October 2026" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_LONG[(m ?? 1) - 1]} ${y}`;
}

export function todayISO(): string {
  return dateToISO(new Date());
}

export function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return dateToISO(isoToDate(iso)) === iso;
}

/** "Today", "Yesterday" or "Mon, Oct 5" for a YYYY-MM-DD string. */
export function relativeDay(iso: string, today: string = todayISO()): string {
  if (iso === today) return 'Today';
  const yesterday = new Date(isoToDate(today).getTime() - 24 * 3600 * 1000);
  if (iso === dateToISO(yesterday)) return 'Yesterday';
  const d = isoToDate(iso);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${weekdays[d.getDay()]}, ${formatDay(iso)}`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
