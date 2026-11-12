import type { SafetySettings } from '@fms/shared';

/**
 * Driver safety scoring (pure).
 *
 * points = Σ weight × events (+ weight per 10 idle minutes)
 * score  = clamp(100 − points per 100 km, 0, 100), or null below minDistanceKm.
 */

export interface DriverSafetyAgg {
  distanceKm: number;
  overspeed: number;
  harshBrake: number;
  harshAccel: number;
  harshCorner: number;
  idleMinutes: number;
}

export type Band = 'GOOD' | 'FAIR' | 'POOR' | 'INSUFFICIENT_DATA';

export function safetyScore(a: DriverSafetyAgg, s: SafetySettings): { score: number | null; pointsPer100Km: number | null; band: Band } {
  if (a.distanceKm < Math.max(s.minDistanceKm, 0.001)) return { score: null, pointsPer100Km: null, band: 'INSUFFICIENT_DATA' };
  const w = s.weights;
  const points =
    a.overspeed * w.overspeed +
    a.harshBrake * w.harshBrake +
    a.harshAccel * w.harshAccel +
    a.harshCorner * w.harshCorner +
    (a.idleMinutes / 10) * w.idlePer10Min;
  const per100 = (points / a.distanceKm) * 100;
  const score = Math.max(0, Math.min(100, Math.round(100 - per100)));
  return { score, pointsPer100Km: Math.round(per100 * 10) / 10, band: score >= 85 ? 'GOOD' : score >= s.alertBelow ? 'FAIR' : 'POOR' };
}

export interface VehicleDay {
  vehicleId: string;
  day: string; // company-local YYYY-MM-DD
  distanceKm: number;
}
export interface TripSpan {
  vehicleId: string;
  driverId: string;
  day: string; // local day the trip started
  gpsDistanceKm: number | null;
}
export interface AssignmentSpan {
  vehicleId: string;
  driverId: string;
  from: Date;
  to: Date | null;
}

/**
 * Splits each vehicle-day's distance between drivers: drivers who had trips on
 * that vehicle that day share it (by trip GPS distance, else equally);
 * otherwise the standing assignment at local noon gets it. Unattributed distance
 * (no trip, no assignment) is dropped from driver scores.
 */
export function attributeDistance(days: VehicleDay[], trips: TripSpan[], assignments: AssignmentSpan[], noon: (day: string) => Date): Map<string, number> {
  const out = new Map<string, number>();
  const add = (driverId: string, km: number) => out.set(driverId, (out.get(driverId) ?? 0) + km);
  for (const d of days) {
    if (d.distanceKm <= 0) continue;
    const ts = trips.filter((t) => t.vehicleId === d.vehicleId && t.day === d.day);
    if (ts.length) {
      const known = ts.reduce((s, t) => s + (t.gpsDistanceKm ?? 0), 0);
      for (const t of ts) add(t.driverId, known > 0 ? d.distanceKm * ((t.gpsDistanceKm ?? 0) / known) : d.distanceKm / ts.length);
      continue;
    }
    const n = noon(d.day);
    const a = assignments.find((x) => x.vehicleId === d.vehicleId && x.from <= n && (!x.to || x.to > n));
    if (a) add(a.driverId, d.distanceKm);
  }
  return out;
}
