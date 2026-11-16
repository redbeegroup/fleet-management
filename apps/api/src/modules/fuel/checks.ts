import { median } from './efficiency';

/**
 * Pure fuel control checks (S13): where the fill happened vs where the vehicle was, odometer vs GPS km,
 * and consumption variance against the vehicle's own baseline.
 */

export interface LocationCheckInput {
  /** Fill location (driver phone), if known. */
  fill: { lat: number; lng: number } | null;
  /** Vehicle GPS fix nearest the fill time (within the search window), if any. */
  vehicle: { lat: number; lng: number; speedKmh: number | null; minutesFromFill: number } | null;
  maxM: number;
}

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * VEHICLE_ELSEWHERE when the vehicle was far from the fill location, or driving fast at fill time.
 * Without a GPS fix within 15 minutes nothing can be said (no flag).
 */
export function locationCheck(i: LocationCheckInput): { distanceM: number | null; flag: 'VEHICLE_ELSEWHERE' | null } {
  if (!i.vehicle || i.vehicle.minutesFromFill > 15) return { distanceM: null, flag: null };
  const d = i.fill ? Math.round(distanceM(i.fill, i.vehicle)) : null;
  const moving = (i.vehicle.speedKmh ?? 0) > 20 && i.vehicle.minutesFromFill <= 2;
  return { distanceM: d, flag: (d != null && d > i.maxM) || moving ? 'VEHICLE_ELSEWHERE' : null };
}

/** KM_MISMATCH when odometer and GPS distance since the previous fill differ by more than `pct` (both ≥ 20 km). */
export function kmCheck(odometerKm: number | null, gpsKm: number | null, pct: number): 'KM_MISMATCH' | null {
  if (odometerKm == null || gpsKm == null || odometerKm < 20 || gpsKm < 20) return null;
  return Math.abs(odometerKm - gpsKm) / gpsKm > pct / 100 ? 'KM_MISMATCH' : null;
}

export interface VarianceInput {
  /** Full-to-full segments of the period: km and litres. */
  segments: { km: number; litres: number }[];
  /** Baseline km/L values (the vehicle's own history; else its class). */
  baseline: number[];
  classBaseline: number[];
  unitPrice: number | null;
}

/**
 * Expected km/L = median of the vehicle's baseline (≥ 3 values), else of its class. Litres "lost" are the
 * litres used above what the expected km/L would have needed for the same distance (never negative).
 */
export function consumptionVariance(i: VarianceInput) {
  const km = i.segments.reduce((s, x) => s + x.km, 0);
  const litres = i.segments.reduce((s, x) => s + x.litres, 0);
  const own = i.baseline.length >= 3 ? median(i.baseline) : null;
  const expected = own ?? (i.classBaseline.length >= 3 ? median(i.classBaseline) : null);
  const actual = litres > 0 ? km / litres : null;
  if (!expected || actual == null) return { km: r1(km), litres: r1(litres), actualKmPerL: actual && r2(actual), expectedKmPerL: expected && r2(expected), basis: own ? 'vehicle' : expected ? 'class' : null, variancePct: null, excessLitres: null, excessCost: null };
  const needed = km / expected;
  const excess = Math.max(0, litres - needed);
  return {
    km: r1(km),
    litres: r1(litres),
    actualKmPerL: r2(actual),
    expectedKmPerL: r2(expected),
    basis: own ? ('vehicle' as const) : ('class' as const),
    /** Negative = worse than expected. */
    variancePct: Math.round(((actual - expected) / expected) * 1000) / 10,
    excessLitres: r1(excess),
    excessCost: i.unitPrice != null ? Math.round(excess * i.unitPrice) : null,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
