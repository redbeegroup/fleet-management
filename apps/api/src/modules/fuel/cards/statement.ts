import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FuelCardMapping } from '@fms/shared';
import { cardLast4, parseAmount, parseStatementDate } from '../reconcile';
import type { RawCardTxn } from './providers';

export interface ParsedStatement {
  headers: string[];
  rows: (RawCardTxn & { row: number; nonFuel: boolean })[];
  errors: { row: number; message: string }[];
}

/** Reads the first sheet of an .xlsx or a .csv (comma/semicolon/tab) into header + row objects. */
export async function readTable(buffer: Buffer, filename: string): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const headers = ((ws.getRow(1).values as unknown[]) ?? []).slice(1).map((v) => String(v ?? '').trim());
    const rows: Record<string, unknown>[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const vals = (row.values as unknown[]).slice(1);
      const cell = (v: unknown) => (v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v && typeof v === 'object' && 'text' in (v as object) ? (v as { text: unknown }).text : v);
      rows.push(Object.fromEntries(headers.map((h, k) => [h, cell(vals[k])])));
    });
    return { headers, rows };
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = parse(text, { columns: (h: string[]) => h.map((x) => x.trim()), delimiter, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, unknown>[];
  return { headers: rows[0] ? Object.keys(rows[0]) : (parse(first, { delimiter })[0] as string[] | undefined)?.map((x) => x.trim()) ?? [], rows };
}

/** Applies a column mapping. Rows without a usable date, card or amount are reported, not imported. */
export function mapStatement(table: { headers: string[]; rows: Record<string, unknown>[] }, m: FuelCardMapping, tzOffsetMin: number): ParsedStatement {
  const c = m.columns;
  const missing = (['occurredAt', 'card', 'amount'] as const).filter((k) => !table.headers.includes(c[k]));
  if (missing.length) return { headers: table.headers, rows: [], errors: [{ row: 0, message: `Columns not found: ${missing.map((k) => c[k]).join(', ')}` }] };
  const out: ParsedStatement = { headers: table.headers, rows: [], errors: [] };
  table.rows.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const at = parseStatementDate(r[c.occurredAt], m.dateFormat, tzOffsetMin);
    const last4 = r[c.card] == null ? null : cardLast4(String(r[c.card]));
    const amount = parseAmount(r[c.amount]);
    if (!at || !last4 || amount == null) {
      out.errors.push({ row, message: !at ? `Unreadable date "${String(r[c.occurredAt] ?? '')}"` : !last4 ? 'Card number missing' : 'Amount missing' });
      return;
    }
    const litres = c.litres ? parseAmount(r[c.litres]) : null;
    const product = c.product && r[c.product] != null ? String(r[c.product]) : null;
    const ext = c.externalId && r[c.externalId] != null && String(r[c.externalId]).trim() ? String(r[c.externalId]).trim() : null;
    out.rows.push({
      row,
      // Without a transaction id the row content identifies it, so a re-imported statement is not doubled.
      externalId: ext ?? `h:${createHash('sha256').update([at.toISOString(), last4, amount, litres, product].join('|')).digest('hex').slice(0, 32)}`,
      card: last4,
      occurredAt: at,
      amount,
      litres,
      station: c.station && r[c.station] != null ? String(r[c.station]) : null,
      product,
      plate: c.plate && r[c.plate] != null ? String(r[c.plate]).trim().toUpperCase() : null,
      nonFuel: !!product && m.nonFuelWords.some((w) => product.toLowerCase().includes(w.toLowerCase())),
    });
  });
  return out;
}
