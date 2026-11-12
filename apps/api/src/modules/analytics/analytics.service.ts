import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalyticsRange } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { dayBounds, localDate } from '../../common/time';
import { minutesInStatus } from '../maintenance/due';
import { fleetKpis, VehicleAgg, vehicleKpis } from './kpis';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const DAY = 86_400_000;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly db: PrismaService) {}

  /** Recomputes daily stats for local days around "now" (worker job, every 30 min). */
  async rollup(fromDay?: string, toDay?: string): Promise<number> {
    const now = new Date();
    const from = fromDay ?? new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10);
    const to = toDay ?? new Date(now.getTime() + DAY).toISOString().slice(0, 10);
    const [row] = await this.db.system((tx) => tx.$queryRaw<{ n: number }[]>`SELECT fms_rollup_daily_stats(${from}::date, ${to}::date) AS n`);
    this.logger.log(`Daily stats rolled up for ${from}..${to}: ${row.n} rows`);
    return row.n;
  }

  /** Fleet KPIs, per-vehicle and per-branch tables and daily series for local days [from, to]. */
  overview(user: AuthUser, q: AnalyticsRange) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const tz = company.timezone;
      const start = dayBounds(q.from, tz).start;
      const end = dayBounds(q.to, tz).end;
      const days = Math.round((Date.parse(q.to) - Date.parse(q.from)) / DAY) + 1;
      const vehicleWhere: Prisma.VehicleWhereInput = {
        deletedAt: null,
        status: { not: 'DISPOSED' },
        ...(q.branchId && { branchId: q.branchId }),
      };

      const vehicles = await tx.vehicle.findMany({
        where: vehicleWhere,
        select: { id: true, plateNumber: true, vehicleClass: true, branchId: true, branch: { select: { name: true } } },
      });
      const ids = vehicles.map((v) => v.id);
      const [stats, fuel, workOrders, expenses, trips, overspeed, statusEvents] = await Promise.all([
        tx.vehicleDailyStat.findMany({ where: { day: { gte: new Date(q.from), lte: new Date(q.to) }, vehicleId: { in: ids } } }),
        tx.fuelRecord.findMany({
          where: { filledAt: { gte: start, lt: end }, vehicle: vehicleWhere },
          select: { vehicleId: true, filledAt: true, litres: true, totalCost: true, distanceKm: true, kmPerLitre: true },
        }),
        tx.workOrder.findMany({
          where: { status: 'COMPLETED', completedAt: { gte: start, lt: end }, vehicle: vehicleWhere },
          select: { vehicleId: true, completedAt: true, totalCost: true },
        }),
        tx.vehicleExpense.findMany({
          where: { incurredAt: { gte: start, lt: end }, vehicle: vehicleWhere },
          select: { vehicleId: true, incurredAt: true, amount: true, category: true },
        }),
        tx.trip.groupBy({ by: ['vehicleId'], where: { status: 'COMPLETED', actualEnd: { gte: start, lt: end }, vehicleId: { in: ids } }, _count: { _all: true } }),
        tx.telemetryEvent.groupBy({ by: ['vehicleId'], where: { type: 'OVERSPEED', occurredAt: { gte: start, lt: end }, vehicleId: { in: ids } }, _count: { _all: true } }),
        tx.vehicleStatusEvent.findMany({ where: { createdAt: { lt: end }, vehicleId: { in: ids } }, select: { vehicleId: true, createdAt: true, fromStatus: true, toStatus: true } }),
      ]);

      const by = <T extends { vehicleId: string | null }>(items: T[]) => {
        const m = new Map<string, T[]>();
        for (const it of items) if (it.vehicleId) m.set(it.vehicleId, [...(m.get(it.vehicleId) ?? []), it]);
        return m;
      };
      const statsBy = by(stats);
      const fuelBy = by(fuel);
      const woBy = by(workOrders);
      const expBy = by(expenses);
      const statusBy = by(statusEvents);
      const tripsBy = new Map(trips.map((t) => [t.vehicleId, t._count._all]));
      const overBy = new Map(overspeed.map((t) => [t.vehicleId, t._count._all]));

      const aggs: VehicleAgg[] = vehicles.map((v) => {
        const st = statsBy.get(v.id) ?? [];
        const fu = fuelBy.get(v.id) ?? [];
        const seg = fu.filter((f) => f.distanceKm && f.kmPerLitre);
        return {
          id: v.id,
          plateNumber: v.plateNumber,
          vehicleClass: v.vehicleClass,
          branchId: v.branchId,
          branchName: v.branch?.name ?? null,
          distanceKm: st.reduce((s, x) => s + n(x.distanceKm), 0),
          daysUsed: st.filter((x) => n(x.distanceKm) >= 1).length,
          engineMinutes: st.reduce((s, x) => s + x.engineMinutes, 0),
          idleMinutes: st.reduce((s, x) => s + x.idleMinutes, 0),
          movingMinutes: st.reduce((s, x) => s + x.movingMinutes, 0),
          maxSpeedKmh: st.length ? Math.max(...st.map((x) => x.maxSpeedKmh ?? 0)) : null,
          fuelCost: fu.reduce((s, x) => s + n(x.totalCost), 0),
          fuelLitres: fu.reduce((s, x) => s + n(x.litres), 0),
          fuelSegKm: seg.reduce((s, x) => s + n(x.distanceKm), 0),
          fuelSegLitres: seg.reduce((s, x) => s + n(x.distanceKm) / n(x.kmPerLitre), 0),
          maintenanceCost: (woBy.get(v.id) ?? []).reduce((s, x) => s + n(x.totalCost), 0),
          otherCost: (expBy.get(v.id) ?? []).reduce((s, x) => s + n(x.amount), 0),
          downtimeMinutes: minutesInStatus(statusBy.get(v.id) ?? [], 'UNDER_REPAIR', start, end),
          tripsCompleted: tripsBy.get(v.id) ?? 0,
          overspeedEvents: overBy.get(v.id) ?? 0,
        };
      });

      // Daily series (company-local days)
      const series = new Map<string, { day: string; distanceKm: number; fuelCost: number; maintenanceCost: number; otherCost: number; activeVehicles: number }>();
      for (let i = 0; i < days; i++) {
        const day = new Date(Date.parse(q.from) + i * DAY).toISOString().slice(0, 10);
        series.set(day, { day, distanceKm: 0, fuelCost: 0, maintenanceCost: 0, otherCost: 0, activeVehicles: 0 });
      }
      for (const s of stats) {
        const d = series.get(s.day.toISOString().slice(0, 10));
        if (d) {
          d.distanceKm += n(s.distanceKm);
          if (n(s.distanceKm) >= 1) d.activeVehicles += 1;
        }
      }
      for (const f of fuel) {
        const d = series.get(localDate(f.filledAt, tz));
        if (d) d.fuelCost += n(f.totalCost);
      }
      for (const w of workOrders) {
        const d = series.get(localDate(w.completedAt!, tz));
        if (d) d.maintenanceCost += n(w.totalCost);
      }
      for (const e of expenses) {
        const d = series.get(localDate(e.incurredAt, tz));
        if (d) d.otherCost += n(e.amount);
      }

      const branches = new Map<string, VehicleAgg[]>();
      for (const a of aggs) {
        const k = a.branchId ?? 'none';
        branches.set(k, [...(branches.get(k) ?? []), a]);
      }
      const expenseByCategory: Record<string, number> = {};
      for (const e of expenses) expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + n(e.amount);

      return {
        range: { from: q.from, to: q.to, days, timezone: tz, currency: company.currency },
        fleet: fleetKpis(aggs, days),
        vehicles: aggs.map((a) => vehicleKpis(a, days)).sort((x, y) => y.totalCost - x.totalCost),
        branches: [...branches.entries()].map(([id, rows]) => ({
          branchId: id === 'none' ? null : id,
          branchName: rows[0].branchName ?? 'No branch',
          ...fleetKpis(rows, days),
        })),
        expenseByCategory,
        series: [...series.values()].map((d) => ({
          ...d,
          distanceKm: Math.round(d.distanceKm * 10) / 10,
          totalCost: Math.round((d.fuelCost + d.maintenanceCost + d.otherCost) * 100) / 100,
        })),
      };
    });
  }

  /** CSV of the per-vehicle table (for Excel / BI tools). */
  async vehiclesCsv(user: AuthUser, q: AnalyticsRange): Promise<string> {
    const o = await this.overview(user, q);
    const cols = [
      ['plateNumber', 'Vehicle'], ['vehicleClass', 'Class'], ['branchName', 'Branch'], ['distanceKm', 'Distance km'],
      ['daysUsed', 'Days used'], ['utilizationPct', 'Utilization %'], ['tripsCompleted', 'Trips'], ['fuelLitres', 'Fuel L'],
      ['fuelCost', 'Fuel cost'], ['fuelKmPerLitre', 'km/L'], ['maintenanceCost', 'Maintenance cost'], ['otherCost', 'Other cost'],
      ['totalCost', 'Total cost'], ['costPerKm', 'Cost/km'], ['downtimeMinutes', 'Downtime min'], ['idlePct', 'Idle %'],
      ['overspeedEvents', 'Overspeed events'],
    ] as const;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Prevent CSV formula injection in spreadsheet apps.
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [cols.map(([, h]) => h).join(',')];
    for (const v of o.vehicles) lines.push(cols.map(([k]) => esc((v as Record<string, unknown>)[k])).join(','));
    return `${lines.join('\n')}\n`;
  }
}
