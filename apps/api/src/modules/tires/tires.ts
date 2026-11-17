/** Tires per vehicle position: current fitment, wear, pressure, life and cost per km (pure). */
import type { TireSettings } from '@fms/shared';

export interface ChangeRow {
  id: string;
  position: string;
  fromPosition?: string | null;
  changedAt: Date;
  odometerKm: number;
  reason: string;
  brand?: string | null;
  model?: string | null;
  size?: string | null;
  condition?: string | null;
  cost: number;
  removedTreadMm?: number | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
}
export interface CheckRow {
  position: string;
  checkedAt: Date;
  odometerKm?: number | null;
  treadMm?: number | null;
  pressure?: number | null;
}

export interface Fitted {
  changeId: string;
  position: string;
  fittedAt: Date;
  fitOdometerKm: number;
  /** Last time it was put on this position (fit or rotation). */
  sinceAt: Date;
  brand: string | null;
  model: string | null;
  size: string | null;
  condition: string | null;
  cost: number;
  warrantyMonths: number | null;
  warrantyKm: number | null;
}
export interface Removed {
  position: string;
  brand: string | null;
  size: string | null;
  condition: string | null;
  fittedAt: Date;
  removedAt: Date;
  kmRun: number;
  cost: number;
  costPerKm: number | null;
  reason: string;
  removedTreadMm: number | null;
}

/** Replays the change history: what is on each position now, and what came off. */
export function replay(changes: ChangeRow[]): { current: Map<string, Fitted>; removed: Removed[] } {
  const rows = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const current = new Map<string, Fitted>();
  const removed: Removed[] = [];
  for (let i = 0; i < rows.length; ) {
    const r = rows[i];
    if (r.reason === 'ROTATION') {
      // Rotations recorded together (same time) move tires simultaneously.
      let end = i;
      while (end < rows.length && rows[end].reason === 'ROTATION' && rows[end].changedAt.getTime() === r.changedAt.getTime()) end++;
      const group = rows.slice(i, end);
      const before = new Map(current);
      for (const g of group) {
        const t = g.fromPosition ? before.get(g.fromPosition) : undefined;
        if (t) current.set(g.position, { ...t, position: g.position, sinceAt: g.changedAt });
        else current.delete(g.position);
      }
      i += group.length;
      continue;
    }
    const prev = current.get(r.position);
    if (prev) {
      const kmRun = Math.max(0, r.odometerKm - prev.fitOdometerKm);
      removed.push({
        position: r.position,
        brand: prev.brand,
        size: prev.size,
        condition: prev.condition,
        fittedAt: prev.fittedAt,
        removedAt: r.changedAt,
        kmRun,
        cost: prev.cost,
        costPerKm: kmRun > 0 ? Math.round((prev.cost / kmRun) * 100) / 100 : null,
        reason: r.reason,
        removedTreadMm: r.removedTreadMm ?? null,
      });
    }
    current.set(r.position, {
      changeId: r.id,
      position: r.position,
      fittedAt: r.changedAt,
      fitOdometerKm: r.odometerKm,
      sinceAt: r.changedAt,
      brand: r.brand ?? null,
      model: r.model ?? null,
      size: r.size ?? null,
      condition: r.condition ?? null,
      cost: r.cost,
      warrantyMonths: r.warrantyMonths ?? null,
      warrantyKm: r.warrantyKm ?? null,
    });
    i++;
  }
  return { current, removed };
}

export type TreadStatus = 'OK' | 'WARN' | 'REPLACE' | 'UNKNOWN';
export type PressureStatus = 'OK' | 'LOW' | 'HIGH' | 'UNKNOWN';

export interface PositionStatus {
  position: string;
  tire: Fitted | null;
  kmSinceFit: number | null;
  treadMm: number | null;
  treadStatus: TreadStatus;
  /** km left until the minimum tread at the measured wear rate. */
  kmToMinTread: number | null;
  pressure: number | null;
  pressureStatus: PressureStatus;
  lastCheckAt: Date | null;
  overLife: boolean;
  warrantyActive: boolean;
  /** Worst of tread / pressure / life: for colouring. */
  level: 'ok' | 'warn' | 'critical' | 'unknown';
}

const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};

export function positionStatus(
  position: string,
  tire: Fitted | null,
  checks: CheckRow[],
  ctx: { odometerKm: number; now: Date; settings: TireSettings; pressureTarget: number | null },
): PositionStatus {
  const s = ctx.settings;
  const mine = checks
    .filter((c) => c.position === position && (!tire || c.checkedAt >= tire.sinceAt))
    .sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
  const treads = mine.filter((c) => c.treadMm != null);
  const pressures = mine.filter((c) => c.pressure != null);
  const tread = treads.length ? Number(treads[treads.length - 1].treadMm) : null;
  const pressure = pressures.length ? Number(pressures[pressures.length - 1].pressure) : null;
  const treadStatus: TreadStatus = tread == null ? 'UNKNOWN' : tread < s.minTreadMm ? 'REPLACE' : tread < s.minTreadMm + s.warnTreadMm ? 'WARN' : 'OK';

  // Wear rate from the first and last tread readings that carry an odometer.
  let kmToMinTread: number | null = null;
  const withKm = treads.filter((c) => c.odometerKm != null);
  if (withKm.length >= 2 && tread != null) {
    const a = withKm[0];
    const b = withKm[withKm.length - 1];
    const km = Number(b.odometerKm) - Number(a.odometerKm);
    const mm = Number(a.treadMm) - Number(b.treadMm);
    if (km > 0 && mm > 0) kmToMinTread = Math.max(0, Math.round(((tread - s.minTreadMm) / mm) * km));
  }

  let pressureStatus: PressureStatus = 'UNKNOWN';
  if (pressure != null && ctx.pressureTarget) {
    const dev = ((pressure - ctx.pressureTarget) / ctx.pressureTarget) * 100;
    pressureStatus = dev < -s.tolerancePct ? 'LOW' : dev > s.tolerancePct ? 'HIGH' : 'OK';
  }
  const kmSinceFit = tire ? Math.max(0, Math.round(ctx.odometerKm - tire.fitOdometerKm)) : null;
  const overLife = kmSinceFit != null && kmSinceFit > s.expectedLifeKm;
  // Under warranty while every limit that is set (months, km) has not been reached.
  const warrantyActive =
    !!tire &&
    (tire.warrantyMonths != null || tire.warrantyKm != null) &&
    (tire.warrantyMonths == null || addMonths(tire.fittedAt, tire.warrantyMonths) > ctx.now) &&
    (tire.warrantyKm == null || (kmSinceFit ?? 0) < tire.warrantyKm);
  const level =
    treadStatus === 'REPLACE' || pressureStatus === 'LOW'
      ? 'critical'
      : treadStatus === 'WARN' || pressureStatus === 'HIGH' || overLife
        ? 'warn'
        : treadStatus === 'UNKNOWN' && pressureStatus === 'UNKNOWN'
          ? 'unknown'
          : 'ok';
  return { position, tire, kmSinceFit, treadMm: tread, treadStatus, kmToMinTread, pressure, pressureStatus, lastCheckAt: mine.length ? mine[mine.length - 1].checkedAt : null, overLife, warrantyActive, level };
}

/** Average life and cost per km of removed tires, by brand and size. */
export function lifeByBrand(removed: Removed[]) {
  const groups = new Map<string, Removed[]>();
  for (const r of removed) {
    if (r.kmRun <= 0) continue;
    const k = `${r.brand ?? 'Unknown'}|${r.size ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, rs]) => {
      const km = rs.reduce((a, r) => a + r.kmRun, 0);
      const cost = rs.reduce((a, r) => a + r.cost, 0);
      const [brand, size] = k.split('|');
      return { brand, size: size || null, tires: rs.length, avgKm: Math.round(km / rs.length), costPerKm: km > 0 ? Math.round((cost / km) * 100) / 100 : null };
    })
    .sort((a, b) => (a.costPerKm ?? Infinity) - (b.costPerKm ?? Infinity));
}
