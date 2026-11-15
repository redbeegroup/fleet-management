/** One order as the planner sees it (all quantities are order totals). */
export interface LoadItem {
  id: string;
  externalRef: string;
  customerId: string;
  priority: string;
  township: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  weightKg: number | null;
  volumeM3: number | null;
  cases: number | null;
  pallets: number | null;
}

export interface VehicleCapacity {
  id: string;
  plateNumber: string;
  capacityKg: number | null;
  capacityM3: number | null;
  capacityCases: number | null;
  capacityPallets: number | null;
  maxStops: number | null;
}

export type Limit = 'kg' | 'm3' | 'cases' | 'pallets' | 'stops';

export interface LoadTotals {
  kg: number;
  m3: number;
  cases: number;
  pallets: number;
  stops: number;
  orders: number;
  missingWeight: number;
  missingVolume: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Totals of a set of orders; stops = distinct customers. */
export function loadTotals(items: Pick<LoadItem, 'customerId' | 'weightKg' | 'volumeM3' | 'cases' | 'pallets'>[]): LoadTotals {
  return {
    kg: r3(items.reduce((s, i) => s + (i.weightKg ?? 0), 0)),
    m3: r3(items.reduce((s, i) => s + (i.volumeM3 ?? 0), 0)),
    cases: r3(items.reduce((s, i) => s + (i.cases ?? 0), 0)),
    pallets: r3(items.reduce((s, i) => s + (i.pallets ?? 0), 0)),
    stops: new Set(items.map((i) => i.customerId)).size,
    orders: items.length,
    missingWeight: items.filter((i) => i.weightKg == null).length,
    missingVolume: items.filter((i) => i.volumeM3 == null).length,
  };
}

/** Limits a vehicle actually has (stops fall back to the company default). */
export function limitsOf(v: VehicleCapacity, defaultMaxStops: number | null): Record<Limit, number | null> {
  return { kg: v.capacityKg, m3: v.capacityM3, cases: v.capacityCases, pallets: v.capacityPallets, stops: v.maxStops ?? defaultMaxStops };
}

export interface LoadCheck {
  ok: boolean;
  violations: { limit: Limit; used: number; capacity: number }[];
  warnings: string[];
}

/** Checks totals against every limit the vehicle has; missing order data only warns. */
export function checkLoad(v: VehicleCapacity, t: LoadTotals, defaultMaxStops: number | null): LoadCheck {
  const limits = limitsOf(v, defaultMaxStops);
  const used: Record<Limit, number> = { kg: t.kg, m3: t.m3, cases: t.cases, pallets: t.pallets, stops: t.stops };
  const violations = (Object.keys(limits) as Limit[])
    .filter((k) => limits[k] != null && used[k] > limits[k]!)
    .map((k) => ({ limit: k, used: used[k], capacity: limits[k]! }));
  const warnings: string[] = [];
  if (limits.kg != null && t.missingWeight) warnings.push(`${t.missingWeight} order(s) have no weight; the weight check is incomplete`);
  if (limits.m3 != null && t.missingVolume) warnings.push(`${t.missingVolume} order(s) have no volume; the volume check is incomplete`);
  return { ok: violations.length === 0, violations, warnings };
}

export const LIMIT_LABEL: Record<Limit, string> = { kg: 'weight (kg)', m3: 'volume (m³)', cases: 'cases', pallets: 'pallets', stops: 'stops' };

export function describeViolations(c: LoadCheck): string {
  return c.violations.map((v) => `${LIMIT_LABEL[v.limit]} ${v.used} > ${v.capacity}`).join(', ');
}
