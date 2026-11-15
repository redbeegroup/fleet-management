/**
 * Pure cost calculations (S12): ownership cost (straight-line depreciation or lease), document fees
 * spread over their validity, shared-cost allocation by km, and budget evaluation.
 * Dates are company-local calendar days as 'YYYY-MM-DD' strings; amounts are rounded to 2 decimals.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
export const monthOf = (day: string) => day.slice(0, 7);
export function addMonths(day: string, n: number): string {
  const d = new Date(toMs(day));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(d.getUTCDate(), dim));
  return toDay(target);
}
/** Inclusive number of days between two days (0 when to < from). */
export const dayCount = (from: string, to: string) => Math.max(0, Math.round((toMs(to) - toMs(from)) / DAY) + 1);
export const maxDay = (a: string, b: string) => (a > b ? a : b);
export const minDay = (a: string, b: string) => (a < b ? a : b);
export const prevDay = (d: string) => toDay(new Date(toMs(d) - DAY));
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  return { from: `${period}-01`, to: `${period}-${String(daysInMonth(y, m)).padStart(2, '0')}` };
}
/** Months (YYYY-MM) touched by a day range. */
export function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = monthOf(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
}

/**
 * Sum of a monthly amount over the days [from, to], where each day is worth monthly / days-in-its-month.
 * So a full calendar month costs exactly the monthly amount, and partial months are pro-rated by days.
 */
export function monthlyAmountOver(monthly: number, from: string, to: string): number {
  if (to < from || !monthly) return 0;
  let total = 0;
  for (const m of monthsIn(from, to)) {
    const mr = monthRange(m);
    const days = dayCount(maxDay(from, mr.from), minDay(to, mr.to));
    const [y, mm] = m.split('-').map(Number);
    total += (monthly * days) / daysInMonth(y, mm);
  }
  return total;
}

export interface AssetInput {
  ownership: string; // OWNED | LEASED | RENTED | CONTRACTOR
  purchasePrice: number | null;
  residualValue: number | null;
  usefulLifeMonths: number | null;
  monthlyLeaseCost: number | null;
  /** Start of depreciation/lease (falls back to acquiredAt in the caller). */
  inServiceAt: string | null;
  disposedAt: string | null;
}

/** Straight-line depreciation per month, or null when the asset data is incomplete. */
export function monthlyDepreciation(a: AssetInput): number | null {
  if (a.ownership !== 'OWNED' || a.purchasePrice == null || !a.usefulLifeMonths) return null;
  return Math.max(0, a.purchasePrice - (a.residualValue ?? 0)) / a.usefulLifeMonths;
}

/** Ownership cost in [from, to]: depreciation (owned, until fully depreciated or disposed) or lease/rent. */
export function assetCost(a: AssetInput, from: string, to: string): { category: 'DEPRECIATION' | 'LEASE'; amount: number } | null {
  const end = a.disposedAt ? prevDay(a.disposedAt) : null; // no cost from the disposal day on
  if (a.ownership === 'OWNED') {
    const monthly = monthlyDepreciation(a);
    if (monthly == null || !a.inServiceAt) return null;
    let stop = prevDay(addMonths(a.inServiceAt, a.usefulLifeMonths!));
    if (end) stop = minDay(stop, end);
    const amount = monthlyAmountOver(monthly, maxDay(from, a.inServiceAt), minDay(to, stop));
    return { category: 'DEPRECIATION', amount: r2(amount) };
  }
  if (!a.monthlyLeaseCost) return null;
  const start = a.inServiceAt ? maxDay(from, a.inServiceAt) : from;
  const amount = monthlyAmountOver(a.monthlyLeaseCost, start, end ? minDay(to, end) : to);
  return { category: 'LEASE', amount: r2(amount) };
}

/** Depreciated book value at a day (owned vehicles), or null. */
export function bookValue(a: AssetInput, at: string): number | null {
  const monthly = monthlyDepreciation(a);
  if (monthly == null || !a.inServiceAt) return null;
  const dep = assetCost(a, a.inServiceAt, at)?.amount ?? 0;
  return r2(Math.max(a.residualValue ?? 0, a.purchasePrice! - dep));
}

/**
 * Part of a document fee (insurance, road tax…) falling in [from, to]: the fee is spread evenly over
 * its validity (issued → expires, inclusive). Without an expiry it counts in full on the issue day.
 */
export function spreadFee(amount: number, issuedAt: string | null, expiresAt: string | null, from: string, to: string): number {
  if (!amount || !issuedAt) return 0;
  if (!expiresAt || expiresAt <= issuedAt) return issuedAt >= from && issuedAt <= to ? amount : 0;
  const total = dayCount(issuedAt, prevDay(expiresAt)); // valid until the day before expiry
  const overlap = dayCount(maxDay(from, issuedAt), minDay(to, prevDay(expiresAt)));
  return r2((amount * overlap) / total);
}

/**
 * Splits an amount over vehicles in proportion to km. Largest-remainder rounding on cents so the
 * parts add up exactly. Without any km the whole amount stays unallocated.
 */
export function allocateByKm(amount: number, kms: { vehicleId: string; km: number }[]): { parts: Map<string, number>; unallocated: number } {
  const used = kms.filter((k) => k.km > 0);
  const total = used.reduce((s, k) => s + k.km, 0);
  const parts = new Map<string, number>();
  if (!total || amount <= 0) return { parts, unallocated: r2(Math.max(0, amount)) };
  const cents = Math.round(amount * 100);
  const raw = used.map((k) => ({ id: k.vehicleId, exact: (cents * k.km) / total }));
  const floor = raw.map((x) => ({ ...x, c: Math.floor(x.exact) }));
  let rest = cents - floor.reduce((s, x) => s + x.c, 0);
  [...floor].sort((a, b) => b.exact - b.c - (a.exact - a.c) || a.id.localeCompare(b.id)).forEach((x) => {
    if (rest > 0) {
      x.c += 1;
      rest -= 1;
    }
  });
  for (const x of floor) parts.set(x.id, x.c / 100);
  return { parts, unallocated: 0 };
}

export type BudgetStatus = 'NO_BUDGET' | 'OK' | 'AT_RISK' | 'OVER';

/**
 * Budget vs actual for one month. The forecast extrapolates the month-to-date actual linearly while
 * the month is running; a past month's forecast is its actual.
 */
export function evaluateBudget(budget: number | null, actual: number, period: string, today: string) {
  const { from, to } = monthRange(period);
  const elapsed = today < from ? 0 : today > to ? dayCount(from, to) : dayCount(from, today);
  const total = dayCount(from, to);
  const forecast = r2(elapsed === 0 || today > to ? actual : (actual / elapsed) * total);
  if (!budget) return { budget: budget ?? null, actual: r2(actual), variance: null, usedPct: null, forecast: r2(forecast), status: 'NO_BUDGET' as BudgetStatus };
  const usedPct = Math.round((actual / budget) * 1000) / 10;
  const status: BudgetStatus = actual > budget ? 'OVER' : usedPct >= 90 || forecast > budget ? 'AT_RISK' : 'OK';
  return { budget, actual: r2(actual), variance: r2(budget - actual), usedPct, forecast: r2(forecast), status };
}

/** Alert level reached (90 or 100) for budget alerts, or null. */
export function alertLevel(budget: number, actual: number): 90 | 100 | null {
  if (!budget) return null;
  if (actual >= budget) return 100;
  if (actual >= budget * 0.9) return 90;
  return null;
}

/** Document type → cost category (insurance and road tax keep their own category). */
export function documentCategory(type: string): string {
  return type === 'INSURANCE' ? 'INSURANCE' : type === 'ROAD_TAX' ? 'ROAD_TAX' : 'DOCUMENTS';
}
