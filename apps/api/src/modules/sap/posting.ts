/** Cost posting to SAP FI/CO and purchase order matching (pure). */

export interface CostRow {
  vehicleId: string | null;
  category: string;
  amount: number;
}
export interface PostingLine {
  costCenter: string;
  glAccount: string;
  category: string;
  vehicles: number;
  amount: number;
}
export interface PostingSettings {
  glAccounts: Record<string, string>;
  defaultCostCenter: string;
  offsetAccount: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ledger rows → lines by cost centre and GL account. Depreciation of vehicles that are SAP fixed assets
 * is left out (SAP depreciates them itself). Missing mappings are reported, not guessed.
 */
export function aggregatePosting(rows: CostRow[], vehicles: Map<string, { costCenter: string | null; sapAssetNo: string | null; plate: string }>, s: PostingSettings) {
  const errors = new Set<string>();
  const lines = new Map<string, PostingLine & { ids: Set<string> }>();
  let skippedDepreciation = 0;
  for (const r of rows) {
    if (!r.amount) continue;
    const v = r.vehicleId ? vehicles.get(r.vehicleId) : undefined;
    if (r.category === 'DEPRECIATION' && v?.sapAssetNo) {
      skippedDepreciation += r.amount;
      continue;
    }
    const costCenter = v?.costCenter || s.defaultCostCenter;
    const glAccount = s.glAccounts[r.category] || s.glAccounts.default || '';
    if (!costCenter) errors.add(v ? `${v.plate}: no cost centre (set it on the department or a default cost centre)` : 'Unallocated cost: no default cost centre');
    if (!glAccount) errors.add(`No GL account for ${r.category}`);
    if (!costCenter || !glAccount) continue;
    const key = `${costCenter}|${glAccount}|${r.category}`;
    const l = lines.get(key) ?? { costCenter, glAccount, category: r.category, vehicles: 0, amount: 0, ids: new Set<string>() };
    l.amount += r.amount;
    if (r.vehicleId) l.ids.add(r.vehicleId);
    lines.set(key, l);
  }
  if (!s.offsetAccount) errors.add('No offset (credit) account');
  const out = [...lines.values()]
    .map(({ ids, ...l }) => ({ ...l, vehicles: ids.size, amount: r2(l.amount) }))
    .filter((l) => l.amount !== 0)
    .sort((a, b) => a.costCenter.localeCompare(b.costCenter) || a.glAccount.localeCompare(b.glAccount) || a.category.localeCompare(b.category));
  return { lines: out, total: r2(out.reduce((a, l) => a + l.amount, 0)), errors: [...errors], skippedDepreciation: r2(skippedDepreciation) };
}

export interface JournalItem {
  glAccount: string;
  costCenter: string | null;
  amount: number;
  /** S = debit, H = credit (SAP DebitCreditCode). */
  side: 'S' | 'H';
  text: string;
}

/** Debit each line (credit when negative), one balancing credit to the offset account. */
export function journalItems(lines: PostingLine[], offsetAccount: string, period: string): JournalItem[] {
  const items: JournalItem[] = lines.map((l) => ({ glAccount: l.glAccount, costCenter: l.costCenter, amount: Math.abs(l.amount), side: l.amount >= 0 ? 'S' : 'H', text: `FMS ${period} ${l.category}` }));
  const net = r2(lines.reduce((a, l) => a + l.amount, 0));
  if (net !== 0) items.push({ glAccount: offsetAccount, costCenter: null, amount: Math.abs(net), side: net >= 0 ? 'H' : 'S', text: `FMS ${period} fleet costs` });
  return items;
}

export function isBalanced(items: JournalItem[]) {
  return r2(items.reduce((a, i) => a + (i.side === 'S' ? i.amount : -i.amount), 0)) === 0;
}

export interface PoItem {
  item: string;
  material: string | null;
  quantity: number;
  netPrice: number;
}
export interface ReceiptLine {
  partNo: string;
  material: string | null;
  qty: number;
  unitCost: number;
}
export type ReceiptIssue = { partNo: string; issue: 'NOT_ON_PO'; detail: string } | { partNo: string; issue: 'QTY_OVER' | 'PRICE'; detail: string; po: number; actual: number };

/** Receipt lines against PO items: unknown material, more than ordered, price outside the tolerance. */
export function matchReceipt(po: PoItem[], lines: ReceiptLine[], tolerancePct: number): ReceiptIssue[] {
  const issues: ReceiptIssue[] = [];
  for (const l of lines) {
    const p = l.material ? po.find((x) => x.material === l.material) : undefined;
    if (!p) {
      issues.push({ partNo: l.partNo, issue: 'NOT_ON_PO', detail: l.material ? `Material ${l.material} is not on the PO` : 'The part has no SAP material number' });
      continue;
    }
    if (l.qty > p.quantity * (1 + tolerancePct / 100)) issues.push({ partNo: l.partNo, issue: 'QTY_OVER', detail: `Received ${l.qty}, ordered ${p.quantity}`, po: p.quantity, actual: l.qty });
    if (p.netPrice > 0 && Math.abs(l.unitCost - p.netPrice) > (p.netPrice * tolerancePct) / 100)
      issues.push({ partNo: l.partNo, issue: 'PRICE', detail: `Unit cost ${l.unitCost}, PO price ${p.netPrice}`, po: p.netPrice, actual: l.unitCost });
  }
  return issues;
}

/** Garage invoice against the PO value. */
export function matchInvoice(poValue: number, invoice: number, tolerancePct: number) {
  const diff = r2(invoice - poValue);
  const diffPct = poValue ? Math.round((diff / poValue) * 1000) / 10 : null;
  return { ok: Math.abs(diff) <= (poValue * tolerancePct) / 100, diff, diffPct };
}
