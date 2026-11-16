/**
 * Pure fuel card reconciliation (S13). A card transaction is matched to the closest fuel record of the
 * same vehicle within the time window; amounts and litres outside tolerance make it a MISMATCH.
 */

export interface CardTxn {
  id: string;
  vehicleId: string | null;
  occurredAt: Date;
  litres: number | null;
  amount: number;
}
export interface FillRec {
  id: string;
  vehicleId: string;
  filledAt: Date;
  litres: number;
  totalCost: number;
}
export interface Tolerances {
  matchHours: number;
  matchLitresPct: number;
  matchAmountPct: number;
}
export type MatchStatus = 'MATCHED' | 'MISMATCH' | 'CARD_ONLY';
export interface MatchResult {
  txnId: string;
  status: MatchStatus;
  fuelRecordId: string | null;
  differences: { litres?: number; amount?: number; minutes?: number } | null;
}

const pctOff = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 100) : (Math.abs(a - b) / b) * 100);

/**
 * Greedy, one-to-one: transactions are taken in time order and each claims the closest unclaimed record
 * of its vehicle in ±matchHours. Records already linked to another transaction are excluded by the caller.
 */
export function reconcile(txns: CardTxn[], records: FillRec[], tol: Tolerances): MatchResult[] {
  const taken = new Set<string>();
  const out: MatchResult[] = [];
  for (const t of [...txns].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (!t.vehicleId) {
      out.push({ txnId: t.id, status: 'CARD_ONLY', fuelRecordId: null, differences: null });
      continue;
    }
    const windowMs = tol.matchHours * 3_600_000;
    const candidates = records
      .filter((r) => r.vehicleId === t.vehicleId && !taken.has(r.id) && Math.abs(r.filledAt.getTime() - t.occurredAt.getTime()) <= windowMs)
      .map((r) => ({ r, gap: Math.abs(r.filledAt.getTime() - t.occurredAt.getTime()), amountOff: pctOff(r.totalCost, t.amount) }))
      // closest amount first, then closest time
      .sort((a, b) => a.amountOff - b.amountOff || a.gap - b.gap);
    const best = candidates[0];
    if (!best) {
      out.push({ txnId: t.id, status: 'CARD_ONLY', fuelRecordId: null, differences: null });
      continue;
    }
    taken.add(best.r.id);
    const diff: MatchResult['differences'] = { minutes: Math.round(best.gap / 60_000) };
    let ok = true;
    if (best.amountOff > tol.matchAmountPct) {
      diff.amount = Math.round((best.r.totalCost - t.amount) * 100) / 100;
      ok = false;
    }
    if (t.litres != null && pctOff(best.r.litres, t.litres) > tol.matchLitresPct) {
      diff.litres = Math.round((best.r.litres - t.litres) * 100) / 100;
      ok = false;
    }
    out.push({ txnId: t.id, status: ok ? 'MATCHED' : 'MISMATCH', fuelRecordId: best.r.id, differences: diff });
  }
  return out;
}

// ---- statement parsing helpers ------------------------------------------------

/** Last 4 digits of a card number as printed on a statement ("**** **** 1234", "7083-xxxx-1234"). */
export function cardLast4(v: string): string | null {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Numbers like "1,250,000", "1.250,50" (EU), "125000 MMK", "(25.00)". */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot && s.length - lastComma <= 3) s = s.replace(/\./g, '').replace(',', '.'); // 1.250,50
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/**
 * Statement dates: Date objects (Excel), ISO strings, or d/m/y with the given order; optional time.
 * Local times are interpreted with the company UTC offset (minutes) so they become instants.
 */
export function parseStatementDate(v: unknown, order: 'YMD' | 'DMY' | 'MDY', offsetMin: number): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() - offsetMin * 60_000 + v.getTimezoneOffset() * 60_000);
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [y, mo, d] = m[1].length === 4 || order === 'YMD' ? [a, b, c] : order === 'DMY' ? [c, b, a] : [c, a, b];
  const year = y < 100 ? 2000 + y : y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utc = Date.UTC(year, mo - 1, d, Number(m[4] ?? 12), Number(m[5] ?? 0), Number(m[6] ?? 0));
  if (new Date(utc).getUTCDate() !== d || Number(m[4] ?? 0) > 23) return null; // 31/02, 25:00
  return new Date(utc - offsetMin * 60_000);
}
