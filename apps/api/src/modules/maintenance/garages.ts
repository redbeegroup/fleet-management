/** Outside garage performance (pure). */

export interface GarageJob {
  supplierId: string;
  vehicleId: string;
  openedAt: Date;
  completedAt: Date | null;
  totalCost: number;
  quoteAmount: number | null;
  invoiceAmount: number | null;
}

const REPEAT_DAYS = 30;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Per garage: completed jobs, cost, turnaround, repeat repairs (the same vehicle opened again at
 * any garage within 30 days after this garage finished), and invoice vs quote.
 */
export function garagePerformance(jobs: GarageJob[], recovered: Map<string, number> = new Map(), period?: { from: Date; to: Date }) {
  // Rated: jobs finished in the period. Every job (also later ones) can make a repeat.
  const done = jobs.filter((j) => j.completedAt && (!period || (j.completedAt >= period.from && j.completedAt < period.to)));
  const bySupplier = new Map<string, GarageJob[]>();
  for (const j of done) bySupplier.set(j.supplierId, [...(bySupplier.get(j.supplierId) ?? []), j]);
  return [...bySupplier.entries()].map(([supplierId, js]) => {
    const cost = js.reduce((a, j) => a + j.totalCost, 0);
    const hours = js.map((j) => (j.completedAt!.getTime() - j.openedAt.getTime()) / 3_600_000);
    const repeats = js.filter((j) =>
      jobs.some((o) => o !== j && o.vehicleId === j.vehicleId && o.openedAt > j.completedAt! && o.openedAt.getTime() - j.completedAt!.getTime() <= REPEAT_DAYS * 86_400_000),
    ).length;
    const quoted = js.filter((j) => j.quoteAmount != null && j.quoteAmount > 0 && j.invoiceAmount != null);
    const overQuote = quoted.length ? quoted.reduce((a, j) => a + (j.invoiceAmount! - j.quoteAmount!) / j.quoteAmount!, 0) / quoted.length : null;
    return {
      supplierId,
      jobs: js.length,
      cost: Math.round(cost),
      avgCost: Math.round(cost / js.length),
      avgTurnaroundHours: r1(hours.reduce((a, h) => a + h, 0) / js.length),
      repeatRepairs: repeats,
      repeatPct: r1((repeats / js.length) * 100),
      invoiceVsQuotePct: overQuote == null ? null : r1(overQuote * 100),
      warrantyRecovered: Math.round(recovered.get(supplierId) ?? 0),
    };
  });
}
