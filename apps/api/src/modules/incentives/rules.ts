import type { IncentiveSettings } from '@fms/shared';

/** Previous calendar month (YYYY-MM) and its first/last day for a local day YYYY-MM-DD. */
export function previousPeriod(today: string): { period: string; from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { period: first.toISOString().slice(0, 7), from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** Drivers who earn the automatic safety bonus for a period. */
export function safetyBonuses(
  drivers: { id: string; fullName: string; score: number | null; distanceKm: number }[],
  s: IncentiveSettings,
): { driverId: string; amount: number; reason: string }[] {
  if (!s.safetyBonusEnabled || s.safetyBonusAmount <= 0) return [];
  return drivers
    .filter((d) => d.score !== null && d.score >= s.safetyBonusMinScore)
    .map((d) => ({ driverId: d.id, amount: s.safetyBonusAmount, reason: `Safety score ${d.score} over ${Math.round(d.distanceKm)} km (bonus from ${s.safetyBonusMinScore})` }));
}

/** Approved totals per driver: incentives, penalties and net. */
export function summarize(rows: { driverId: string; kind: 'INCENTIVE' | 'PENALTY'; amount: number; status: string }[]) {
  const out = new Map<string, { incentives: number; penalties: number; net: number; pending: number }>();
  for (const r of rows) {
    const t = out.get(r.driverId) ?? { incentives: 0, penalties: 0, net: 0, pending: 0 };
    if (r.status === 'PROPOSED') t.pending += 1;
    if (r.status === 'APPROVED') {
      if (r.kind === 'INCENTIVE') t.incentives += r.amount;
      else t.penalties += r.amount;
      t.net = t.incentives - t.penalties;
    }
    out.set(r.driverId, t);
  }
  return out;
}
