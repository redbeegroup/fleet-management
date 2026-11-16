/** Report model shared by the HTML, PDF and CSV renderers (pure). */
export type Cell = string | number | null;
export interface Table {
  columns: string[];
  rows: Cell[][];
  /** Columns holding numbers (right-aligned). */
  numeric?: number[];
}
export interface Kpi {
  label: string;
  value: string;
  /** e.g. "+12 % vs previous"; good = green, bad = red, null = neutral. */
  change?: { text: string; good: boolean | null };
}
export interface Section {
  title: string;
  bars?: { label: string; value: number; display: string }[];
  table?: Table;
  empty?: string;
}
export interface ReportModel {
  report: 'FLEET' | 'BUDGET' | 'DELIVERY' | 'SAFETY';
  title: string;
  company: string;
  scope: string;
  periodLabel: string;
  kpis: Kpi[];
  sections: Section[];
  notes: string[];
  csv: { name: string; table: Table }[];
}

export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtMoney = (v: number | null | undefined, currency: string) => (v == null ? '—' : `${fmtNum(v)} ${currency}`);
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${fmtNum(v, 1)} %`);

/** Change against the previous period; `higherIsBetter` decides the colour. */
export function change(cur: number | null | undefined, prev: number | null | undefined, higherIsBetter: boolean | null, unit: 'pct' | 'pts' = 'pct'): Kpi['change'] {
  if (cur == null || prev == null) return undefined;
  if (unit === 'pts') {
    const diff = Math.round((cur - prev) * 10) / 10;
    if (diff === 0) return { text: 'same as previous', good: null };
    return { text: `${diff > 0 ? '+' : ''}${fmtNum(diff, 1)} pts vs previous`, good: higherIsBetter == null ? null : diff > 0 === higherIsBetter };
  }
  if (prev === 0) return cur === 0 ? { text: 'same as previous', good: null } : undefined;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  if (p === 0) return { text: 'same as previous', good: null };
  return { text: `${p > 0 ? '+' : ''}${fmtNum(p, 1)} % vs previous`, good: higherIsBetter == null ? null : p > 0 === higherIsBetter };
}

export function csvText(t: Table): string {
  const cell = (v: Cell) => {
    if (v == null) return '';
    const s = String(v);
    // Quote when needed; neutralise spreadsheet formulas.
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [t.columns.map(cell).join(','), ...t.rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}
