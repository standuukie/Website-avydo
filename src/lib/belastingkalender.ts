import { taxDeadlines, type TaxDeadline } from '@/data/belastingkalender';

const MONTH_NAMES = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatFullDate(iso: string): string {
  const date = parseIsoDate(iso);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthLabel(year: number, month1to12: number): string {
  const name = MONTH_NAMES[month1to12 - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Aantal dagen tussen `now` en de deadline. Positief = in de toekomst, 0 = vandaag, negatief = verstreken. */
export function daysUntil(iso: string, now: Date): number {
  const target = startOfDay(parseIsoDate(iso));
  const today = startOfDay(now);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function deadlineStatusLabel(daysRemaining: number): string {
  if (daysRemaining === 0) return 'Vandaag';
  if (daysRemaining < 0) return 'Verstreken';
  if (daysRemaining === 1) return 'Nog 1 dag';
  return `Nog ${daysRemaining} dagen`;
}

export function isUpcoming(deadline: TaxDeadline, now: Date): boolean {
  return Boolean(deadline.deadline) && daysUntil(deadline.deadline as string, now) >= 0;
}

export function getNextDeadline(now: Date, list: TaxDeadline[] = taxDeadlines): TaxDeadline | null {
  const upcoming = list
    .filter((d) => isUpcoming(d, now))
    .sort((a, b) => (a.deadline as string).localeCompare(b.deadline as string));
  return upcoming[0] ?? null;
}

export function getDeadlinesForMonth(year: number, month1to12: number, list: TaxDeadline[] = taxDeadlines): TaxDeadline[] {
  const prefix = `${year}-${String(month1to12).padStart(2, '0')}`;
  return list.filter((d) => d.deadline?.startsWith(prefix));
}

/** Alle (jaar, maand)-combinaties die minstens 1 deadline met vaste datum hebben, oplopend gesorteerd. */
export function getAvailableMonths(list: TaxDeadline[] = taxDeadlines): Array<{ year: number; month: number }> {
  const keys = new Set<string>();
  for (const d of list) {
    if (d.deadline) keys.add(d.deadline.slice(0, 7));
  }
  return [...keys]
    .sort()
    .map((key) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }));
}

export function getAvailableYears(list: TaxDeadline[] = taxDeadlines): number[] {
  return [...new Set(getAvailableMonths(list).map((m) => m.year))].sort((a, b) => a - b);
}
