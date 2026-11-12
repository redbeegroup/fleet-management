import type { MaintenanceSettings } from '@fms/shared';

/** Preventive-maintenance due calculation and downtime. Pure. */

export type DueStatus = 'OK' | 'DUE_SOON' | 'OVERDUE';

export interface PlanLike {
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneAt: Date | null;
  lastDoneOdometerKm: number | null;
}

export interface DueInfo {
  status: DueStatus;
  nextDueKm: number | null;
  nextDueAt: Date | null;
  remainingKm: number | null;
  remainingDays: number | null;
}

const DAY = 86_400_000;
const rank: Record<DueStatus, number> = { OK: 0, DUE_SOON: 1, OVERDUE: 2 };

/** Whichever limit (distance or time) comes first decides the status. */
export function planDue(p: PlanLike, odometerKm: number, now: Date, s: Pick<MaintenanceSettings, 'dueSoonKm' | 'dueSoonDays'>): DueInfo {
  let status: DueStatus = 'OK';
  const bump = (x: DueStatus) => {
    if (rank[x] > rank[status]) status = x;
  };
  let nextDueKm: number | null = null;
  let remainingKm: number | null = null;
  if (p.intervalKm && p.lastDoneOdometerKm != null) {
    nextDueKm = p.lastDoneOdometerKm + p.intervalKm;
    remainingKm = Math.round((nextDueKm - odometerKm) * 10) / 10;
    bump(remainingKm <= 0 ? 'OVERDUE' : remainingKm <= s.dueSoonKm ? 'DUE_SOON' : 'OK');
  }
  let nextDueAt: Date | null = null;
  let remainingDays: number | null = null;
  if (p.intervalDays && p.lastDoneAt) {
    nextDueAt = new Date(p.lastDoneAt.getTime() + p.intervalDays * DAY);
    remainingDays = Math.ceil((nextDueAt.getTime() - now.getTime()) / DAY);
    bump(remainingDays <= 0 ? 'OVERDUE' : remainingDays <= s.dueSoonDays ? 'DUE_SOON' : 'OK');
  }
  return { status, nextDueKm, nextDueAt, remainingKm, remainingDays };
}

export interface StatusEventLike {
  createdAt: Date;
  fromStatus: string | null;
  toStatus: string;
}

/**
 * Minutes spent in `status` within [from, to), reconstructed from the status
 * history (events must be for one vehicle).
 */
export function minutesInStatus(events: StatusEventLike[], status: string, from: Date, to: Date, now = new Date()): number {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const end = Math.min(to.getTime(), now.getTime());
  let total = 0;
  let since: number | null = null;
  // State before the window = last event before `from`.
  for (const e of sorted) {
    const t = e.createdAt.getTime();
    if (e.toStatus === status && since === null) since = t;
    else if (e.toStatus !== status && since !== null) {
      total += Math.max(0, Math.min(t, end) - Math.max(since, from.getTime()));
      since = null;
    }
  }
  if (since !== null) total += Math.max(0, end - Math.max(since, from.getTime()));
  return Math.round(total / 60_000);
}
