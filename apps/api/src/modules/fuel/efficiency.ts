/**
 * Fuel efficiency by the full-to-full method, plus anomaly flags. Pure.
 *
 * Between two consecutive full-tank fills, the litres of every fill after the
 * first full one (partials included) were burned over the odometer distance.
 */

export interface FillLike {
  id: string;
  filledAt: Date;
  odometerKm: number;
  litres: number;
  fullTank: boolean;
}

export interface FillResult {
  distanceKm: number | null;
  kmPerLitre: number | null;
  /** Litres attributed to the segment ending at this full fill. */
  segmentLitres: number | null;
  flags: string[];
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeFuelChain(
  fills: FillLike[],
  opts: { tankCapacityL?: number | null; lowEfficiencyRatio: number },
): Map<string, FillResult> {
  const sorted = [...fills].sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime() || a.odometerKm - b.odometerKm);
  const out = new Map<string, FillResult>();
  let lastFull: FillLike | null = null;
  let litresSince = 0;
  let prev: FillLike | null = null;

  for (const f of sorted) {
    const r: FillResult = { distanceKm: null, kmPerLitre: null, segmentLitres: null, flags: [] };
    if (prev && f.odometerKm < prev.odometerKm) r.flags.push('ODOMETER_BACKWARDS');
    if (opts.tankCapacityL && f.litres > opts.tankCapacityL * 1.05) r.flags.push('OVER_TANK_CAPACITY');

    if (!r.flags.includes('ODOMETER_BACKWARDS')) {
      litresSince += f.litres;
      if (f.fullTank) {
        if (lastFull && f.odometerKm > lastFull.odometerKm && litresSince > 0) {
          r.distanceKm = round(f.odometerKm - lastFull.odometerKm, 1);
          r.segmentLitres = round(litresSince, 2);
          r.kmPerLitre = round((f.odometerKm - lastFull.odometerKm) / litresSince, 2);
        }
        lastFull = f;
        litresSince = 0;
      }
      prev = f;
    }
    out.set(f.id, r);
  }

  const values = [...out.values()].map((r) => r.kmPerLitre).filter((v): v is number => v !== null);
  const med = values.length >= 3 ? median(values) : null;
  if (med) {
    for (const r of out.values()) {
      if (r.kmPerLitre !== null && r.kmPerLitre < med * opts.lowEfficiencyRatio) r.flags.push('LOW_EFFICIENCY');
    }
  }
  return out;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
