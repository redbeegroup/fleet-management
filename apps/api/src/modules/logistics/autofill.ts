import { checkLoad, LoadItem, loadTotals, VehicleCapacity } from './capacity';
import { bearing, Point } from './sequence';

const PRIORITY: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const size = (v: VehicleCapacity) => [v.capacityKg ?? 0, v.capacityM3 ?? 0, v.capacityPallets ?? 0, v.capacityCases ?? 0];

export interface AutofillResult {
  loads: { vehicleId: string; orderIds: string[] }[];
  unplaced: { orderId: string; externalRef: string; reason: string }[];
}

/**
 * Proposes loads (no side effects, deterministic):
 * 1. orders by priority, then area (city/township), then bearing from the depot, heaviest first within an area;
 * 2. first-fit into vehicles ordered by capacity (largest first), so neighbouring orders share a vehicle;
 * 3. every vehicle limit (kg, m³, cases, pallets, stops) is respected.
 */
export function autofill(items: LoadItem[], vehicles: VehicleCapacity[], depot: Point | null, defaultMaxStops: number | null): AutofillResult {
  const area = (i: LoadItem) => `${(i.city ?? '').toLowerCase()}|${(i.township ?? '').toLowerCase()}`;
  const brg = (i: LoadItem) => (depot && i.lat != null && i.lng != null ? bearing(depot, { lat: i.lat, lng: i.lng }) : 999);
  const ordered = [...items].sort(
    (a, b) =>
      (PRIORITY[a.priority] ?? 2) - (PRIORITY[b.priority] ?? 2) ||
      area(a).localeCompare(area(b)) ||
      brg(a) - brg(b) ||
      (b.weightKg ?? 0) - (a.weightKg ?? 0) ||
      a.externalRef.localeCompare(b.externalRef),
  );
  const vs = [...vehicles].sort((a, b) => {
    const [x, y] = [size(a), size(b)];
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k];
    return a.plateNumber.localeCompare(b.plateNumber);
  });
  const bins = vs.map((v) => ({ v, items: [] as LoadItem[] }));
  const unplaced: AutofillResult['unplaced'] = [];
  for (const it of ordered) {
    const bin = bins.find((b) => checkLoad(b.v, loadTotals([...b.items, it]), defaultMaxStops).ok);
    if (bin) {
      bin.items.push(it);
      continue;
    }
    const empty = vs.map((v) => checkLoad(v, loadTotals([it]), defaultMaxStops));
    const fitsSomewhere = empty.some((c) => c.ok);
    unplaced.push({
      orderId: it.id,
      externalRef: it.externalRef,
      reason: !vs.length
        ? 'No vehicle available'
        : fitsSomewhere
          ? 'No capacity left on available vehicles'
          : `Too large for any available vehicle (${[...new Set(empty.flatMap((c) => c.violations.map((x) => x.limit)))].join(', ')})`,
    });
  }
  return { loads: bins.filter((b) => b.items.length).map((b) => ({ vehicleId: b.v.id, orderIds: b.items.map((i) => i.id) })), unplaced };
}
