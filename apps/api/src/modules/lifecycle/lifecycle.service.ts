import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DisposeVehicleInput, ReplacementPlanInput, replacementLimitsFor } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { localDate } from '../../common/time';
import { changeVehicleStatus } from '../../common/vehicle-status';
import { addMonths, AssetInput, bookValue, monthOf, r2, toDay } from '../costs/calc';
import { CostsService } from '../costs/costs.service';
import { minutesInStatus } from '../maintenance/due';
import { advise, economicLife, median, YearCost } from './replacement';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + (Number(to.slice(8, 10)) >= Number(from.slice(8, 10)) ? 0 : -1);

type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;
const vehicleSelect = {
  id: true, plateNumber: true, make: true, model: true, year: true, vehicleClass: true, status: true, ownership: true, odometerKm: true, branchId: true,
  acquiredAt: true, inServiceAt: true, disposedAt: true, purchasePrice: true, residualValue: true, usefulLifeMonths: true, monthlyLeaseCost: true,
  replacementPlannedFor: true, replacementNote: true,
} satisfies Prisma.VehicleSelect;

function asset(v: VehicleRow): AssetInput {
  const start = v.inServiceAt ?? v.acquiredAt;
  return {
    ownership: v.ownership,
    purchasePrice: n(v.purchasePrice),
    residualValue: n(v.residualValue),
    usefulLifeMonths: v.usefulLifeMonths,
    monthlyLeaseCost: n(v.monthlyLeaseCost),
    inServiceAt: start ? toDay(start) : null,
    disposedAt: v.disposedAt ? toDay(v.disposedAt) : null,
  };
}

/** Vehicle lifecycle: replacement advice from limits and the cost curve, lifetime view, disposal. */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly db: PrismaService,
    private readonly costs: CostsService,
  ) {}

  /** Facts and advice for every vehicle in service (last 3 years of costs, 12 months of use). */
  private async analyse(tx: Tx, vehicleIds?: string[]) {
    const company = await tx.company.findFirstOrThrow({ select: { timezone: true, settings: true, currency: true } });
    const tz = company.timezone;
    const settings = parseCompanySettings(company.settings).lifecycle;
    const today = localDate(new Date(), tz);
    const from = addMonths(today, -36);
    const from12 = addMonths(today, -12);
    const [vehicles, ledger, stats, events] = await Promise.all([
      tx.vehicle.findMany({ where: { deletedAt: null, status: { not: 'DISPOSED' }, ...(vehicleIds && { id: { in: vehicleIds } }) }, select: vehicleSelect, orderBy: { plateNumber: 'asc' } }),
      this.costs.ledger(tx, tz, { from, to: today }),
      tx.vehicleDailyStat.findMany({ where: { day: { gte: new Date(from) } }, select: { vehicleId: true, day: true, distanceKm: true } }),
      tx.vehicleStatusEvent.findMany({ where: { createdAt: { lt: new Date() } }, select: { vehicleId: true, createdAt: true, fromStatus: true, toStatus: true } }),
    ]);
    // Running cost (everything but depreciation / lease) and km per vehicle per month.
    const running = new Map<string, Map<string, number>>();
    for (const r of ledger.rows) {
      if (r.source === 'asset') continue;
      const m = running.get(r.vehicleId) ?? new Map<string, number>();
      m.set(r.month, (m.get(r.month) ?? 0) + r.amount);
      running.set(r.vehicleId, m);
    }
    const kmMonth = new Map<string, Map<string, number>>();
    for (const s of stats) {
      const m = kmMonth.get(s.vehicleId) ?? new Map<string, number>();
      const k = monthOf(toDay(s.day));
      m.set(k, (m.get(k) ?? 0) + Number(s.distanceKm));
      kmMonth.set(s.vehicleId, m);
    }
    // Last 12 months: the 11 previous calendar months plus the current one.
    const since = monthOf(from12);
    const last12 = (m: Map<string, number> | undefined) => [...(m ?? new Map<string, number>()).entries()].filter(([k]) => k > since).reduce((a, [, v]) => a + v, 0);
    const periodMin = 365 * 1440;
    const base = vehicles.map((v) => {
      const a = asset(v);
      const start = a.inServiceAt;
      const ageMonths = start ? Math.max(0, monthsBetween(start, today)) : null;
      const km12m = last12(kmMonth.get(v.id));
      const run12 = last12(running.get(v.id));
      const downtime = minutesInStatus(events.filter((e) => e.vehicleId === v.id), 'UNDER_REPAIR', new Date(Date.now() - periodMin * 60_000), new Date());
      // Yearly cost curve by year of service.
      const years = new Map<number, YearCost>();
      if (start) {
        const months = new Set([...(running.get(v.id)?.keys() ?? []), ...(kmMonth.get(v.id)?.keys() ?? [])]);
        for (const m of months) {
          const age = monthsBetween(start.slice(0, 7) + '-01', m + '-01');
          if (age < 0) continue;
          const y = Math.floor(age / 12) + 1;
          const yc = years.get(y) ?? { year: y, running: 0, km: 0 };
          yc.running += running.get(v.id)?.get(m) ?? 0;
          yc.km += kmMonth.get(v.id)?.get(m) ?? 0;
          years.set(y, yc);
        }
      }
      // Only complete years of service count for the curve (the current one is partial).
      const complete = [...years.values()].filter((y) => ageMonths != null && y.year * 12 <= ageMonths);
      const terms = a.ownership === 'OWNED' && a.purchasePrice && a.usefulLifeMonths ? { price: a.purchasePrice, residual: a.residualValue ?? 0, lifeMonths: a.usefulLifeMonths } : null;
      const econ = economicLife(complete, terms);
      return {
        v,
        a,
        ageMonths,
        km12m: Math.round(km12m),
        running12m: r2(run12),
        runningPerKm12m: km12m >= 100 ? r2(run12 / km12m) : null,
        downtimePct12m: Math.round((downtime / periodMin) * 1000) / 10,
        econ,
        bookValue: bookValue(a, today),
      };
    });
    const byClass = new Map<string, number[]>();
    for (const b of base) if (b.runningPerKm12m != null && b.km12m >= 1000) byClass.set(b.v.vehicleClass, [...(byClass.get(b.v.vehicleClass) ?? []), b.runningPerKm12m]);
    return {
      currency: company.currency,
      today,
      settings,
      rows: base.map((b) => {
        const peers = byClass.get(b.v.vehicleClass) ?? [];
        const classMedian = median(peers);
        const limits = replacementLimitsFor(settings, b.v.vehicleClass);
        const r = advise(
          {
            ageMonths: b.ageMonths,
            odometerKm: Number(b.v.odometerKm),
            kmPerMonth: b.km12m / 12,
            downtimePct12m: b.downtimePct12m,
            runningPerKm12m: b.runningPerKm12m,
            km12m: b.km12m,
            classMedianRunningPerKm: classMedian,
            classPeers: peers.length,
            economicLifeYears: b.econ?.years ?? null,
          },
          { ...limits, costAboveClassPct: settings.costAboveClassPct, planWithinMonths: settings.planWithinMonths },
        );
        return {
          vehicle: { id: b.v.id, plateNumber: b.v.plateNumber, name: `${b.v.make} ${b.v.model}`, year: b.v.year, vehicleClass: b.v.vehicleClass, status: b.v.status, ownership: b.v.ownership, branchId: b.v.branchId },
          inServiceAt: b.a.inServiceAt,
          ageYears: b.ageMonths != null ? Math.round((b.ageMonths / 12) * 10) / 10 : null,
          odometerKm: Number(b.v.odometerKm),
          km12m: b.km12m,
          runningPerKm12m: b.runningPerKm12m,
          classMedianRunningPerKm: classMedian != null ? r2(classMedian) : null,
          downtimePct12m: b.downtimePct12m,
          economicLife: b.econ,
          bookValue: b.bookValue,
          limits,
          replacementPlannedFor: b.v.replacementPlannedFor ? toDay(b.v.replacementPlannedFor) : null,
          replacementNote: b.v.replacementNote,
          ...r,
          assetDataMissing: b.a.ownership === 'OWNED' && (b.a.purchasePrice == null || !b.a.usefulLifeMonths || !b.a.inServiceAt),
        };
      }),
    };
  }

  replacement(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = await this.analyse(tx);
      const order = { REPLACE_NOW: 0, PLAN: 1, OK: 2 };
      const rows = r.rows.sort((a, b) => order[a.advice] - order[b.advice] || (a.monthsToLimit ?? 999) - (b.monthsToLimit ?? 999));
      const disposals = await tx.vehicleDisposal.findMany({ orderBy: { disposedAt: 'desc' }, take: 50, include: { vehicle: { select: { plateNumber: true, make: true, model: true } } } });
      return {
        currency: r.currency,
        settings: r.settings,
        totals: {
          replaceNow: rows.filter((x) => x.advice === 'REPLACE_NOW').length,
          plan: rows.filter((x) => x.advice === 'PLAN').length,
          ok: rows.filter((x) => x.advice === 'OK').length,
          planned: rows.filter((x) => x.replacementPlannedFor).length,
          replaceNowBookValue: Math.round(rows.filter((x) => x.advice === 'REPLACE_NOW').reduce((a, x) => a + (x.bookValue ?? 0), 0)),
        },
        vehicles: rows,
        disposals: disposals.map((d) => ({ ...d, plateNumber: d.vehicle.plateNumber, name: `${d.vehicle.make} ${d.vehicle.model}` })),
      };
    });
  }

  /** One vehicle: lifetime costs and km (up to 3 years of history), advice, disposal. */
  vehicle(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id, deletedAt: null }, select: vehicleSelect });
      if (!v) throw new NotFoundException('Vehicle not found');
      const disposal = await tx.vehicleDisposal.findUnique({ where: { vehicleId: id } });
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const today = localDate(new Date(), company.timezone);
      const a = asset(v);
      const from = a.inServiceAt && a.inServiceAt > addMonths(today, -36) ? a.inServiceAt : addMonths(today, -36);
      const end = disposal ? toDay(disposal.disposedAt) : today;
      const ledger = await this.costs.ledger(tx, company.timezone, { from: from > end ? end : from, to: end });
      const mine = ledger.rows.filter((r) => r.vehicleId === id);
      const byCategory: Record<string, number> = {};
      for (const r of mine) byCategory[r.category] = r2((byCategory[r.category] ?? 0) + r.amount);
      const total = r2(mine.reduce((s, r) => s + r.amount, 0));
      const km = Math.round(ledger.km.get(id) ?? 0);
      const advice = v.status === 'DISPOSED' ? null : (await this.analyse(tx, [id])).rows[0] ?? null;
      return {
        currency: company.currency,
        vehicle: { id: v.id, plateNumber: v.plateNumber, status: v.status, ownership: v.ownership },
        timeline: [
          v.acquiredAt && { at: toDay(v.acquiredAt), event: 'Acquired' },
          a.inServiceAt && { at: a.inServiceAt, event: 'In service' },
          v.replacementPlannedFor && !disposal && { at: toDay(v.replacementPlannedFor), event: 'Replacement planned' },
          disposal && { at: toDay(disposal.disposedAt), event: `Disposed (${disposal.method.toLowerCase().replace('_', '-')})` },
        ].filter(Boolean),
        lifetime: { from: from > end ? end : from, to: end, total, km, perKm: km > 0 ? r2(total / km) : null, byCategory, partial: !!a.inServiceAt && a.inServiceAt < addMonths(today, -36) },
        bookValue: bookValue(a, end),
        advice,
        disposal,
      };
    });
  }

  setPlan(user: AuthUser, id: string, body: ReplacementPlanInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
      if (!v) throw new NotFoundException('Vehicle not found');
      if (v.status === 'DISPOSED') throw new BadRequestException('The vehicle is already disposed');
      return tx.vehicle.update({ where: { id }, data: { replacementPlannedFor: body.replacementPlannedFor, replacementNote: body.replacementNote ?? null }, select: { id: true, replacementPlannedFor: true, replacementNote: true } });
    });
  }

  /** Disposes of a vehicle: book value and gain / loss, status DISPOSED, assignments ended. */
  dispose(user: AuthUser, id: string, body: DisposeVehicleInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM vehicles WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Vehicle not found');
      const v = await tx.vehicle.findUniqueOrThrow({ where: { id }, select: vehicleSelect });
      if (v.status === 'DISPOSED') throw new ConflictException('The vehicle is already disposed');
      if (body.disposedAt.getTime() > Date.now() + 86_400_000) throw new BadRequestException('The disposal date is in the future');
      const trip = await tx.trip.findFirst({ where: { vehicleId: id, status: { in: ['PLANNED', 'ASSIGNED', 'ONGOING'] } }, select: { tripNo: true } });
      if (trip) throw new ConflictException(`Trip ${trip.tripNo} still uses this vehicle; complete or cancel it first`);
      const wo = await tx.workOrder.findFirst({ where: { vehicleId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL'] } }, select: { woNo: true } });
      if (wo) throw new ConflictException(`Work order ${wo.woNo} is still open; complete or cancel it first`);
      const day = toDay(body.disposedAt);
      const book = bookValue(asset(v), day);
      const disposal = await tx.vehicleDisposal.create({
        data: {
          companyId: user.companyId, vehicleId: id, disposedAt: body.disposedAt, method: body.method, buyer: body.buyer ?? null, saleValue: body.saleValue,
          odometerKm: body.odometerKm ?? v.odometerKm, bookValue: book, gainLoss: book != null ? r2(body.saleValue - book) : null, reason: body.reason ?? null, fileId: body.fileId ?? null, createdBy: user.userId,
        },
      });
      await tx.vehicleAssignment.updateMany({ where: { vehicleId: id, endAt: null }, data: { endAt: new Date() } });
      if (v.status !== 'INACTIVE') await changeVehicleStatus(tx, user, id, 'INACTIVE', `Disposal (${body.method.toLowerCase()})`);
      await changeVehicleStatus(tx, user, id, 'DISPOSED', `Disposed: ${body.method.toLowerCase()}${body.buyer ? ` to ${body.buyer}` : ''}`);
      await tx.vehicle.update({ where: { id }, data: { disposedAt: body.disposedAt, replacementPlannedFor: null } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'vehicle.dispose', entity: 'vehicle', entityId: id, payload: { method: body.method, saleValue: body.saleValue, bookValue: book } } });
      return disposal;
    });
  }
}
