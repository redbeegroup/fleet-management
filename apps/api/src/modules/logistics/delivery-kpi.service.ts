import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { limitsOf, loadTotals } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { dayBounds, localDate } from '../../common/time';
import { avg, fillRate, minutesBetween, orderKpis, OrderOutcome, sequenceAdherence, tripCost } from './kpis';

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Delivery KPIs over delivery trips planned for local days [from, to]. */
@Injectable()
export class DeliveryKpiService {
  constructor(private readonly db: PrismaService) {}

  overview(user: AuthUser, q: { from: string; to: string; branchId?: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, settings: true, currency: true } });
      const tz = company.timezone;
      const settings = parseCompanySettings(company.settings).logistics;
      const trips = await tx.trip.findMany({
        where: { kind: 'DELIVERY', status: { not: 'CANCELLED' }, plannedDate: { gte: new Date(q.from), lte: new Date(q.to) }, ...(q.branchId && { branchId: q.branchId }) },
        include: {
          vehicle: { select: { id: true, plateNumber: true, capacityKg: true, capacityM3: true, capacityCases: true, capacityPallets: true, maxStops: true } },
          driver: { select: { id: true, fullName: true } },
          stops: { select: { seq: true, status: true, arrivedAt: true, completedAt: true, plannedArrival: true } },
          orders: {
            select: {
              status: true,
              customerId: true,
              windowStart: true,
              windowEnd: true,
              deliveryDate: true,
              failureReason: true,
              totalWeightKg: true,
              totalVolumeM3: true,
              totalCases: true,
              totalPallets: true,
              stop: { select: { completedAt: true } },
            },
          },
        },
        orderBy: { plannedStart: 'asc' },
      });
      const tripIds = trips.map((t) => t.id);
      const vehicleIds = [...new Set(trips.map((t) => t.vehicleId).filter((x): x is string => !!x))];
      const start = dayBounds(q.from, tz).start;
      const end = dayBounds(q.to, tz).end;
      const [expenses, fuel, km] = await Promise.all([
        tx.vehicleExpense.groupBy({ by: ['tripId'], where: { tripId: { in: tripIds }, approvalStatus: 'APPROVED' }, _sum: { amount: true } }),
        tx.fuelRecord.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: vehicleIds }, filledAt: { gte: start, lt: end }, approvalStatus: 'APPROVED' }, _sum: { totalCost: true } }),
        tx.vehicleDailyStat.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: vehicleIds }, day: { gte: new Date(q.from), lte: new Date(q.to) } }, _sum: { distanceKm: true } }),
      ]);
      // Fuel cost per km per vehicle over the period; fleet average as the fallback.
      const fuelPerKm = new Map<string, number>();
      let fuelSum = 0;
      let kmSum = 0;
      for (const f of fuel) {
        const d = n(km.find((k) => k.vehicleId === f.vehicleId)?._sum.distanceKm) ?? 0;
        const c = n(f._sum.totalCost) ?? 0;
        fuelSum += c;
        kmSum += d;
        if (d > 0) fuelPerKm.set(f.vehicleId, c / d);
      }
      const fleetPerKm = kmSum > 0 ? fuelSum / kmSum : null;

      const allOrders: (OrderOutcome & { tripId: string })[] = [];
      const tripRows = trips.map((t) => {
        const orders: OrderOutcome[] = t.orders.map((o) => ({
          status: o.status,
          completedAt: o.stop?.completedAt ?? null,
          completedLocalDay: o.stop?.completedAt ? localDate(o.stop.completedAt, tz) : null,
          deliveryDate: o.deliveryDate?.toISOString().slice(0, 10) ?? null,
          windowStart: o.windowStart,
          windowEnd: o.windowEnd,
          failureReason: o.failureReason,
        }));
        allOrders.push(...orders.map((o) => ({ ...o, tripId: t.id })));
        const k = orderKpis(orders);
        const totals = loadTotals(t.orders.map((o) => ({ customerId: o.customerId, weightKg: n(o.totalWeightKg), volumeM3: n(o.totalVolumeM3), cases: n(o.totalCases), pallets: n(o.totalPallets) })));
        const caps = t.vehicle
          ? limitsOf({ id: t.vehicle.id, plateNumber: t.vehicle.plateNumber, capacityKg: n(t.vehicle.capacityKg), capacityM3: n(t.vehicle.capacityM3), capacityCases: t.vehicle.capacityCases, capacityPallets: t.vehicle.capacityPallets, maxStops: t.vehicle.maxStops }, null)
          : { kg: null, m3: null, cases: null, pallets: null, stops: null };
        const fill = fillRate({ kg: totals.kg, m3: totals.m3, cases: totals.cases, pallets: totals.pallets }, { kg: caps.kg, m3: caps.m3, cases: caps.cases, pallets: caps.pallets });
        const gpsKm = n(t.gpsDistanceKm);
        const plannedKm = n(t.plannedKm);
        const costKm = gpsKm ?? plannedKm;
        const cost = tripCost({
          expenses: n(expenses.find((e) => e.tripId === t.id)?._sum.amount) ?? 0,
          km: costKm,
          fuelCostPerKm: (t.vehicleId ? fuelPerKm.get(t.vehicleId) : undefined) ?? fleetPerKm,
          driverCostPerDay: settings.driverCostPerDay,
        });
        const done = t.stops.filter((s) => s.completedAt).sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
        const drops = t.stops.filter((s) => s.status === 'DELIVERED' || s.status === 'PARTIAL').length;
        return {
          tripId: t.id,
          tripNo: t.tripNo,
          date: t.plannedDate?.toISOString().slice(0, 10) ?? null,
          status: t.status,
          vehicle: t.vehicle?.plateNumber ?? null,
          vehicleId: t.vehicleId,
          driver: t.driver?.fullName ?? null,
          driverId: t.driverId,
          orders: t.orders.length,
          stops: t.stops.length,
          drops,
          ...k,
          kg: totals.kg,
          fillPct: fill.pct,
          fillByLimit: fill.byLimit,
          plannedKm,
          actualKm: gpsKm,
          kmDeviationPct: plannedKm && gpsKm ? Math.round(((gpsKm - plannedKm) / plannedKm) * 1000) / 10 : null,
          sequencePct: sequenceAdherence(done.map((s) => s.seq)),
          avgDwellMin: avg(t.stops.map((s) => minutesBetween(s.arrivedAt, s.completedAt))),
          avgEtaErrorMin: avg(t.stops.map((s) => (s.plannedArrival && s.arrivedAt ? Math.abs(minutesBetween(s.plannedArrival, s.arrivedAt)!) : null))),
          cost,
          costPerDrop: drops ? Math.round(cost / drops) : null,
          costPerOrder: t.orders.length ? Math.round(cost / t.orders.length) : null,
          costPerKg: totals.kg ? Math.round((cost / totals.kg) * 100) / 100 : null,
        };
      });

      const overall = orderKpis(allOrders);
      const sum = (f: (r: (typeof tripRows)[number]) => number) => tripRows.reduce((s, r) => s + f(r), 0);
      const totalCost = Math.round(sum((r) => r.cost) * 100) / 100;
      const drops = sum((r) => r.drops);
      const kg = sum((r) => r.kg);
      const group = <K extends 'driverId' | 'vehicleId'>(key: K, label: 'driver' | 'vehicle') => {
        const m = new Map<string, typeof tripRows>();
        for (const r of tripRows) if (r[key]) m.set(r[key]!, [...(m.get(r[key]!) ?? []), r]);
        return [...m.entries()].map(([id, rows]) => {
          const k = orderKpis(allOrders.filter((o) => rows.some((r) => r.tripId === o.tripId)));
          const c = rows.reduce((s, r) => s + r.cost, 0);
          const d = rows.reduce((s, r) => s + r.drops, 0);
          return {
            id,
            name: rows[0][label],
            trips: rows.length,
            ...k,
            fillPct: avg(rows.map((r) => r.fillPct)),
            sequencePct: avg(rows.map((r) => r.sequencePct)),
            avgEtaErrorMin: avg(rows.map((r) => r.avgEtaErrorMin)),
            cost: Math.round(c),
            costPerDrop: d ? Math.round(c / d) : null,
          };
        });
      };
      const days = new Map<string, typeof allOrders>();
      for (const o of allOrders) {
        const d = trips.find((t) => t.id === o.tripId)!.plannedDate!.toISOString().slice(0, 10);
        days.set(d, [...(days.get(d) ?? []), o]);
      }
      return {
        range: { ...q, timezone: tz, currency: company.currency },
        method: {
          cost: 'Trip-linked approved expenses + GPS km (or planned km) × the vehicle’s fuel cost per km in the period (fleet average if unknown)' + (settings.driverCostPerDay ? ' + driver cost per day' : ''),
          otif: 'Delivered in full and completed inside the delivery window (or on the delivery date when there is no window)',
        },
        totals: {
          trips: tripRows.length,
          ...overall,
          drops,
          cost: totalCost,
          costPerDrop: drops ? Math.round(totalCost / drops) : null,
          costPerOrder: overall.attempted ? Math.round(totalCost / overall.attempted) : null,
          costPerKg: kg ? Math.round((totalCost / kg) * 100) / 100 : null,
          fillPct: avg(tripRows.map((r) => r.fillPct)),
          sequencePct: avg(tripRows.map((r) => r.sequencePct)),
          avgDwellMin: avg(tripRows.map((r) => r.avgDwellMin)),
          avgEtaErrorMin: avg(tripRows.map((r) => r.avgEtaErrorMin)),
          plannedKm: Math.round(sum((r) => r.plannedKm ?? 0) * 10) / 10,
          actualKm: Math.round(sum((r) => r.actualKm ?? 0) * 10) / 10,
        },
        series: [...days.entries()].sort().map(([day, os]) => ({ day, ...orderKpis(os) })),
        drivers: group('driverId', 'driver'),
        vehicles: group('vehicleId', 'vehicle'),
        trips: tripRows,
      };
    });
  }

  async csv(user: AuthUser, q: { from: string; to: string; branchId?: string }) {
    const o = await this.overview(user, q);
    const cols = ['date', 'tripNo', 'vehicle', 'driver', 'orders', 'stops', 'delivered', 'partial', 'failed', 'otifPct', 'successRatePct', 'fillPct', 'plannedKm', 'actualKm', 'sequencePct', 'avgEtaErrorMin', 'cost', 'costPerDrop'] as const;
    return [cols.join(','), ...o.trips.map((t) => cols.map((c) => csvCell(t[c])).join(','))].join('\n') + '\n';
  }
}
