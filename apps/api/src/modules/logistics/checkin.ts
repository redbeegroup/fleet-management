export interface ExpectedLine {
  key: string;
  kind: 'UNDELIVERED' | 'CUSTOMER_RETURN';
  ref: string;
  sku: string;
  description: string | null;
  uom: string;
  expectedQty: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What should come back to the depot: undelivered quantities and customer returns. */
export function expectedReturns(
  orders: { id: string; externalRef: string; status: string; lines: { lineNo: number; sku: string; description: string | null; uom: string; quantity: number; deliveredQty: number | null }[] }[],
  returns: { id: string; sku: string; description: string | null; uom: string; quantity: number; reason: string }[],
): ExpectedLine[] {
  const out: ExpectedLine[] = [];
  for (const o of orders) {
    if (o.status !== 'FAILED' && o.status !== 'PARTIAL') continue;
    for (const l of o.lines) {
      const back = r3(l.quantity - (l.deliveredQty ?? 0));
      if (back > 0) out.push({ key: `order:${o.id}:${l.lineNo}`, kind: 'UNDELIVERED', ref: o.externalRef, sku: l.sku, description: l.description, uom: l.uom, expectedQty: back });
    }
  }
  for (const r of returns) out.push({ key: `return:${r.id}`, kind: 'CUSTOMER_RETURN', ref: r.reason, sku: r.sku, description: r.description, uom: r.uom, expectedQty: r3(r.quantity) });
  return out;
}

export interface Reconciliation {
  lines: (ExpectedLine & { receivedQty: number; diff: number })[];
  shortages: number;
  overages: number;
  cashExpected: number;
  cashReceived: number | null;
  cashDiff: number | null;
  ok: boolean;
  unknownKeys: string[];
}

/** Compares what the warehouse counted with what was expected; lines not counted are treated as 0 received. */
export function reconcile(expected: ExpectedLine[], received: { key: string; receivedQty: number }[], cashExpected: number, cashReceived: number | null): Reconciliation {
  const got = new Map(received.map((r) => [r.key, r.receivedQty]));
  const known = new Set(expected.map((e) => e.key));
  const lines = expected.map((e) => {
    const receivedQty = r3(got.get(e.key) ?? 0);
    return { ...e, receivedQty, diff: r3(receivedQty - e.expectedQty) };
  });
  const cashDiff = cashReceived == null ? null : Math.round((cashReceived - cashExpected) * 100) / 100;
  const shortages = lines.filter((l) => l.diff < 0).length;
  const overages = lines.filter((l) => l.diff > 0).length;
  return {
    lines,
    shortages,
    overages,
    cashExpected: Math.round(cashExpected * 100) / 100,
    cashReceived,
    cashDiff,
    ok: shortages === 0 && overages === 0 && (cashDiff == null || Math.abs(cashDiff) < 0.5),
    unknownKeys: received.map((r) => r.key).filter((k) => !known.has(k)),
  };
}
