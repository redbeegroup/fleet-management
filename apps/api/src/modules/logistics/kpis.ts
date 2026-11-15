/** Pure delivery KPI helpers (aggregation happens in DeliveryKpiService). */

export interface OrderOutcome {
  status: string; // DELIVERED | PARTIAL | FAILED | …
  completedAt: Date | null;
  completedLocalDay: string | null;
  deliveryDate: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  failureReason: string | null;
}

/** On time = completed inside the delivery window, or on the planned delivery day when there is no window. */
export function onTime(o: OrderOutcome): boolean {
  if (!o.completedAt) return false;
  if (o.windowStart && o.windowEnd) return o.completedAt >= o.windowStart && o.completedAt <= o.windowEnd;
  return !!o.deliveryDate && o.completedLocalDay === o.deliveryDate;
}

export function orderKpis(orders: OrderOutcome[]) {
  const attempted = orders.filter((o) => ['DELIVERED', 'PARTIAL', 'FAILED'].includes(o.status));
  const delivered = attempted.filter((o) => o.status === 'DELIVERED').length;
  const partial = attempted.filter((o) => o.status === 'PARTIAL').length;
  const failed = attempted.filter((o) => o.status === 'FAILED').length;
  const otif = attempted.filter((o) => o.status === 'DELIVERED' && onTime(o)).length;
  const onTimeCount = attempted.filter((o) => o.status !== 'FAILED' && onTime(o)).length;
  const reasons: Record<string, number> = {};
  for (const o of attempted) if (o.status === 'FAILED') reasons[o.failureReason ?? 'Unknown'] = (reasons[o.failureReason ?? 'Unknown'] ?? 0) + 1;
  const pct = (n: number) => (attempted.length ? Math.round((n / attempted.length) * 1000) / 10 : null);
  return {
    attempted: attempted.length,
    delivered,
    partial,
    failed,
    successRatePct: pct(delivered + partial),
    inFullRatePct: pct(delivered),
    onTimeRatePct: pct(onTimeCount),
    otif,
    otifPct: pct(otif),
    failureReasons: reasons,
  };
}

/** Share of stops visited in the planned order: longest increasing subsequence of planned seq in completion order. */
export function sequenceAdherence(plannedSeqInCompletionOrder: number[]): number | null {
  const n = plannedSeqInCompletionOrder.length;
  if (!n) return null;
  const tails: number[] = [];
  for (const x of plannedSeqInCompletionOrder) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return Math.round((tails.length / n) * 1000) / 10;
}

/** Highest share of any capacity limit the vehicle has (the binding constraint), in %. */
export function fillRate(used: Record<string, number>, capacity: Record<string, number | null>): { pct: number | null; byLimit: Record<string, number> } {
  const byLimit: Record<string, number> = {};
  for (const [k, cap] of Object.entries(capacity)) if (cap != null && cap > 0) byLimit[k] = Math.round(((used[k] ?? 0) / cap) * 1000) / 10;
  const vals = Object.values(byLimit);
  return { pct: vals.length ? Math.max(...vals) : null, byLimit };
}

/** Estimated trip cost: linked expenses + fuel (km × cost/km) + driver day cost. */
export function tripCost(p: { expenses: number; km: number | null; fuelCostPerKm: number | null; driverCostPerDay: number | null }) {
  const fuel = p.km != null && p.fuelCostPerKm != null ? p.km * p.fuelCostPerKm : 0;
  return Math.round((p.expenses + fuel + (p.driverCostPerDay ?? 0)) * 100) / 100;
}

export function minutesBetween(a: Date | null, b: Date | null): number | null {
  return a && b ? Math.round((b.getTime() - a.getTime()) / 60_000) : null;
}

export const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
};
