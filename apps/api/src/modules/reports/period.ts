/** Report periods and due times, in company-local dates (pure). */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface Period {
  key: string;
  /** Inclusive local dates. */
  from: string;
  to: string;
  /** First local day after the period. */
  endExclusive: string;
  label: string;
  prev: { from: string; to: string };
}

const DAY = 86_400_000;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (t: Date) => t.toISOString().slice(0, 10);
const add = (s: string, days: number) => iso(new Date(d(s).getTime() + days * DAY));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

/** ISO-8601 week key of a date, e.g. 2026-W46. */
export function isoWeekKey(day: string): string {
  const t = d(day);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(t.getTime() + (3 - dow) * DAY);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The last complete period before local day `today`. */
export function lastPeriod(freq: Frequency, today: string): Period {
  if (freq === 'DAILY') {
    const day = add(today, -1);
    return { key: day, from: day, to: day, endExclusive: today, label: fmt(day), prev: { from: add(day, -1), to: add(day, -1) } };
  }
  if (freq === 'WEEKLY') {
    const dow = (d(today).getUTCDay() + 6) % 7;
    const thisMonday = add(today, -dow);
    const from = add(thisMonday, -7);
    const to = add(thisMonday, -1);
    return { key: isoWeekKey(from), from, to, endExclusive: thisMonday, label: `${isoWeekKey(from).slice(5)} · ${fmt(from)} – ${fmt(to)}`, prev: { from: add(from, -7), to: add(from, -1) } };
  }
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // current month, 1-based
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const [qy, qm] = pm === 1 ? [py - 1, 12] : [py, pm - 1];
  const from = first(py, pm);
  const endExclusive = first(y, m);
  return { key: from.slice(0, 7), from, to: add(endExclusive, -1), endExclusive, label: `${MONTHS[pm - 1]} ${py}`, prev: { from: first(qy, qm), to: add(from, -1) } };
}

/**
 * Whether a subscription should send its last period now: from `sendHour` local time, and only
 * for periods that ended after the subscription was created (no back-filled reports).
 */
export function dueNow(freq: Frequency, local: { date: string; hour: number }, createdLocalDate: string, sendHour = 7): Period | null {
  if (local.hour < sendHour) return null;
  const p = lastPeriod(freq, local.date);
  return createdLocalDate < p.endExclusive ? p : null;
}

/** Company-local date and hour of an instant. */
export function localClock(at: Date, tz: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
