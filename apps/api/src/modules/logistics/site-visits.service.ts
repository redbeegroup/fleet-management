import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SiteVisitQuery } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { dayBounds } from '../../common/time';

const r1 = (n: number) => Math.round(n * 10) / 10;
/** p-th percentile (nearest rank). */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
const LOADING = new Set(['BRANCH', 'WAREHOUSE']);

/** Loading/unloading time from GPS site visits (S14). */
@Injectable()
export class SiteVisitsService {
  constructor(private readonly db: PrismaService) {}

  report(user: AuthUser, q: SiteVisitQuery) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const where: Prisma.SiteVisitWhereInput = {
        enteredAt: { gte: dayBounds(q.from, company.timezone).start, lt: dayBounds(q.to, company.timezone).end },
        exitedAt: { not: null },
        ...(q.category && { category: q.category }),
        ...(q.vehicleId && { vehicleId: q.vehicleId }),
      };
      const visits = await tx.siteVisit.findMany({ where, orderBy: { enteredAt: 'desc' }, take: 20_000 });
      const [vehicles, drivers] = await Promise.all([
        tx.vehicle.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.vehicleId))] } }, select: { id: true, plateNumber: true } }),
        tx.driver.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.driverId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } }),
      ]);
      const plate = new Map(vehicles.map((v) => [v.id, v.plateNumber]));
      const name = new Map(drivers.map((d) => [d.id, d.fullName]));
      const stats = (xs: number[]) => ({ visits: xs.length, avgMin: xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null, p90Min: percentile(xs, 90), totalMin: r1(xs.reduce((a, b) => a + b, 0)) });
      const group = <K extends string>(key: (v: (typeof visits)[number]) => K | null) => {
        const m = new Map<K, number[]>();
        for (const v of visits) {
          const k = key(v);
          if (k != null) m.set(k, [...(m.get(k) ?? []), v.durationMin ?? 0]);
        }
        return m;
      };
      const sites = [...group((v) => `${v.kind}|${v.geofenceId ?? v.customerId ?? v.siteName}`)].map(([k, xs]) => {
        const sample = visits.find((v) => `${v.kind}|${v.geofenceId ?? v.customerId ?? v.siteName}` === k)!;
        return { key: k, name: sample.siteName, category: sample.category, kind: sample.kind, ...stats(xs) };
      });
      const per = (by: 'vehicleId' | 'driverId') =>
        [...group((v) => v[by])].map(([id, _]) => {
          const mine = visits.filter((v) => v[by] === id);
          const loading = mine.filter((v) => LOADING.has(v.category)).map((v) => v.durationMin ?? 0);
          const unloading = mine.filter((v) => v.category === 'CUSTOMER').map((v) => v.durationMin ?? 0);
          return { id, name: by === 'vehicleId' ? (plate.get(id) ?? '') : (name.get(id) ?? ''), loading: stats(loading), unloading: stats(unloading) };
        });
      const loading = visits.filter((v) => LOADING.has(v.category)).map((v) => v.durationMin ?? 0);
      const unloading = visits.filter((v) => v.category === 'CUSTOMER').map((v) => v.durationMin ?? 0);
      return {
        range: { from: q.from, to: q.to },
        totals: { loading: stats(loading), unloading: stats(unloading), all: stats(visits.map((v) => v.durationMin ?? 0)) },
        sites: sites.sort((a, b) => b.totalMin - a.totalMin),
        vehicles: per('vehicleId').sort((a, b) => (b.unloading.avgMin ?? 0) - (a.unloading.avgMin ?? 0)),
        drivers: per('driverId').sort((a, b) => (b.unloading.avgMin ?? 0) - (a.unloading.avgMin ?? 0)),
        recent: visits.slice(0, 100).map((v) => ({ ...v, plateNumber: plate.get(v.vehicleId) ?? null, driver: v.driverId ? (name.get(v.driverId) ?? null) : null })),
        method: 'Time between entering and leaving a geofence (depots and warehouses = loading) or the radius around a delivery stop (customers = unloading), from GPS positions. Open visits are not counted.',
      };
    });
  }
}
