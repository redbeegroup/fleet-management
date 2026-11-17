/** Benchmarking within vehicle classes, productivity ranking and branch comparison (pure). */
import { median } from '../lifecycle/replacement';

export const METRICS = {
  utilizationPct: { label: 'Utilisation', higherIsBetter: true, score: true },
  kmPerDay: { label: 'km per day', higherIsBetter: true, score: true },
  tripsPerDay: { label: 'Trips per day', higherIsBetter: true, score: true },
  availabilityPct: { label: 'Availability', higherIsBetter: true, score: true },
  costPerKm: { label: 'Cost per km', higherIsBetter: false, score: true },
  fuelKmPerLitre: { label: 'km per litre', higherIsBetter: true, score: false },
  idlePct: { label: 'Idle', higherIsBetter: false, score: false },
  overspeedPer100Km: { label: 'Overspeed / 100 km', higherIsBetter: false, score: false },
} as const;
export type Metric = keyof typeof METRICS;

export interface BenchVehicle {
  id: string;
  plateNumber: string;
  vehicleClass: string;
  branchId: string | null;
  branchName: string | null;
  values: Record<Metric, number | null>;
}

/** Share of peers this value beats (ties count half), 0–100; null with fewer than 2 values. */
export function percentile(value: number | null, peers: number[], higherIsBetter: boolean): number | null {
  if (value == null || peers.length < 2) return null;
  let worse = 0;
  let equal = 0;
  for (const p of peers) {
    if (p === value) equal++;
    else if (higherIsBetter ? p < value : p > value) worse++;
  }
  // `equal` includes the vehicle itself.
  return Math.round(((worse + (equal - 1) / 2) / (peers.length - 1)) * 100);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Medians keep two decimals: small rates such as 0.03 trips per day must not round to 0. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function benchmark(vehicles: BenchVehicle[]) {
  const metrics = Object.keys(METRICS) as Metric[];
  const classes = new Map<string, BenchVehicle[]>();
  for (const v of vehicles) classes.set(v.vehicleClass, [...(classes.get(v.vehicleClass) ?? []), v]);

  const classStats = [...classes.entries()].map(([vehicleClass, vs]) => {
    const medians = {} as Record<Metric, number | null>;
    for (const m of metrics) {
      const md = median(vs.map((v) => v.values[m]).filter((x): x is number => x != null));
      medians[m] = md == null ? null : r2(md);
    }
    return { vehicleClass, vehicles: vs.length, medians };
  });
  const medianOf = new Map(classStats.map((c) => [c.vehicleClass, c.medians]));

  const rows = vehicles.map((v) => {
    const peers = classes.get(v.vehicleClass)!;
    const med = medianOf.get(v.vehicleClass)!;
    const detail = {} as Record<Metric, { value: number | null; vsMedianPct: number | null; percentile: number | null }>;
    for (const m of metrics) {
      const value = v.values[m];
      const md = med[m];
      detail[m] = {
        value,
        vsMedianPct: value != null && md ? r1(((value - md) / Math.abs(md)) * 100) : null,
        percentile: percentile(value, peers.map((p) => p.values[m]).filter((x): x is number => x != null), METRICS[m].higherIsBetter),
      };
    }
    const scored = metrics.filter((m) => METRICS[m].score).map((m) => detail[m].percentile).filter((x): x is number => x != null);
    return { id: v.id, plateNumber: v.plateNumber, vehicleClass: v.vehicleClass, branchId: v.branchId, branchName: v.branchName, metrics: detail, score: scored.length >= 2 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null };
  });

  // Rank inside the class by score (best first).
  for (const [, vs] of classes) {
    const ranked = rows.filter((r) => r.vehicleClass === vs[0].vehicleClass && r.score != null).sort((a, b) => b.score! - a.score!);
    ranked.forEach((r, i) => Object.assign(r, { rank: i + 1, of: ranked.length }));
  }

  // Branches: average score and medians per branch, compared with the fleet median.
  const branches = new Map<string, typeof rows>();
  for (const r of rows) branches.set(r.branchId ?? 'none', [...(branches.get(r.branchId ?? 'none') ?? []), r]);
  const branchRows = [...branches.entries()].map(([id, rs]) => {
    const scores = rs.map((r) => r.score).filter((x): x is number => x != null);
    const medians = {} as Record<Metric, number | null>;
    for (const m of metrics) {
      const md = median(rs.map((r) => r.metrics[m].value).filter((x): x is number => x != null));
      medians[m] = md == null ? null : r2(md);
    }
    // Class mix differs between branches: compare each vehicle with its own class first.
    const vsClass = {} as Record<Metric, number | null>;
    for (const m of metrics) {
      const d = rs.map((r) => r.metrics[m].vsMedianPct).filter((x): x is number => x != null);
      vsClass[m] = d.length ? r1(d.reduce((a, b) => a + b, 0) / d.length) : null;
    }
    return { branchId: id === 'none' ? null : id, branchName: rs[0].branchName ?? 'No branch', vehicles: rs.length, score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, medians, vsClassPct: vsClass };
  });

  return {
    metrics: metrics.map((m) => ({ key: m, ...METRICS[m] })),
    classes: classStats,
    vehicles: rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    branches: branchRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
  };
}
