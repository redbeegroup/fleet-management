/**
 * Fleet KPI formulas (pure). Inputs are per-vehicle aggregates for a period.
 * See docs/DEVELOPMENT_PLAN.md §5 for definitions.
 */

export interface VehicleAgg {
  id: string;
  plateNumber: string;
  vehicleClass: string;
  branchId: string | null;
  branchName: string | null;
  distanceKm: number;
  daysUsed: number; // days with ≥ 1 km
  engineMinutes: number;
  idleMinutes: number;
  movingMinutes: number;
  maxSpeedKmh: number | null;
  fuelCost: number;
  fuelLitres: number;
  /** Distance and litres of full-to-full segments (for km/L). */
  fuelSegKm: number;
  fuelSegLitres: number;
  maintenanceCost: number;
  otherCost: number;
  downtimeMinutes: number;
  tripsCompleted: number;
  overspeedEvents: number;
}

const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (num: number, den: number) => (den > 0 ? r((num / den) * 100, 1) : null);
const per = (num: number, den: number, d = 2) => (den > 0 ? r(num / den, d) : null);

export function vehicleKpis(a: VehicleAgg, days: number) {
  const totalCost = a.fuelCost + a.maintenanceCost + a.otherCost;
  return {
    ...a,
    distanceKm: r(a.distanceKm, 1),
    totalCost: r(totalCost),
    costPerKm: per(totalCost, a.distanceKm),
    fuelKmPerLitre: per(a.fuelSegKm, a.fuelSegLitres),
    maintenanceCostPerKm: per(a.maintenanceCost, a.distanceKm),
    utilizationPct: pct(a.daysUsed, days),
    idlePct: pct(a.idleMinutes, a.engineMinutes),
    downtimePct: pct(a.downtimeMinutes, days * 1440),
    overspeedPer100Km: a.distanceKm > 0 ? r((a.overspeedEvents / a.distanceKm) * 100) : null,
  };
}

export function fleetKpis(rows: VehicleAgg[], days: number) {
  const sum = (k: keyof VehicleAgg) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const n = rows.length;
  const distance = sum('distanceKm');
  const fuel = sum('fuelCost');
  const maint = sum('maintenanceCost');
  const other = sum('otherCost');
  const total = fuel + maint + other;
  const downtime = sum('downtimeMinutes');
  return {
    vehicles: n,
    days,
    distanceKm: r(distance, 1),
    engineHours: r(sum('engineMinutes') / 60, 1),
    tripsCompleted: sum('tripsCompleted'),
    fuelCost: r(fuel),
    fuelLitres: r(sum('fuelLitres')),
    maintenanceCost: r(maint),
    otherCost: r(other),
    totalCost: r(total),
    costPerKm: per(total, distance),
    fuelCostPerKm: per(fuel, distance),
    maintenanceCostPerKm: per(maint, distance),
    fuelKmPerLitre: per(sum('fuelSegKm'), sum('fuelSegLitres')),
    utilizationPct: pct(sum('daysUsed'), n * days),
    availabilityPct: n ? r(100 - (downtime / (n * days * 1440)) * 100, 1) : null,
    downtimePct: pct(downtime, n * days * 1440),
    idlePct: pct(sum('idleMinutes'), sum('engineMinutes')),
    tripsPerVehiclePerDay: per(sum('tripsCompleted'), n * days),
    overspeedEvents: sum('overspeedEvents'),
    overspeedPer100Km: distance > 0 ? r((sum('overspeedEvents') / distance) * 100) : null,
  };
}
