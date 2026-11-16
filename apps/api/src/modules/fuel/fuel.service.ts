import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { Prisma } from '@prisma/client';
import { CreateFuelRecordInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { FilesService } from '../files/files.service';
import { trackDistanceKm } from '../telematics/rules/geo';
import { consumptionVariance, kmCheck, locationCheck } from './checks';
import { computeFuelChain, median } from './efficiency';

export interface FuelListQuery {
  vehicleId?: string;
  from?: Date;
  to?: Date;
  flagged?: boolean;
  page: number;
  pageSize: number;
}

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

@Injectable()
export class FuelService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.register('FUEL', async (tx, id, outcome) => {
      if (outcome === 'CANCELLED') return;
      await tx.fuelRecord.updateMany({ where: { id, approvalStatus: 'PENDING' }, data: { approvalStatus: outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED' } });
    });
  }

  list(user: AuthUser, q: FuelListQuery) {
    const where: Prisma.FuelRecordWhereInput = {
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...((q.from || q.to) && { filledAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
      ...(q.flagged && { NOT: { flags: { isEmpty: true } } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.fuelRecord.findMany({
          where,
          include: { vehicle: { select: { id: true, plateNumber: true } }, driver: { select: { id: true, fullName: true } } },
          orderBy: { filledAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.fuelRecord.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async create(user: AuthUser, input: CreateFuelRecordInput, source = 'web') {
    const { record, req } = await this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
      if (!vehicle) throw new BadRequestException('Vehicle not found');
      if (input.driverId && !(await tx.driver.findFirst({ where: { id: input.driverId }, select: { id: true } }))) {
        throw new BadRequestException('Driver not found');
      }
      await FilesService.assertOwned(tx, input.receiptFileId);
      const unitPrice = input.unitPrice ?? round(input.totalCost! / input.litres, 2);
      const totalCost = input.totalCost ?? round(input.unitPrice! * input.litres, 2);
      const needsApproval = (await this.approvals.need(tx, 'FUEL', totalCost)).needed;
      const where = await this.whereWasVehicle(tx, vehicle.id, input.filledAt, input.latitude != null && input.longitude != null ? { lat: input.latitude, lng: input.longitude } : null);
      const rec = await tx.fuelRecord.create({
        data: {
          ...input,
          ...where,
          unitPrice,
          totalCost,
          approvalStatus: needsApproval ? 'PENDING' : 'APPROVED',
          fuelType: input.fuelType ?? vehicle.fuelType,
          companyId: user.companyId,
          source,
          createdBy: user.userId,
        },
      });
      if (input.odometerKm > Number(vehicle.odometerKm)) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: input.odometerKm } });
      }
      await this.refreshGpsKm(tx, vehicle.id, rec.id);
      await this.recompute(tx, user.companyId, vehicle.id);
      const req = needsApproval
        ? await this.approvals.request(tx, user.companyId, user.userId, {
            kind: 'FUEL',
            entityId: rec.id,
            title: `Fuel ${round(input.litres, 1)} L — ${vehicle.plateNumber}`,
            amount: totalCost,
          })
        : null;
      const record = await tx.fuelRecord.findUniqueOrThrow({ where: { id: rec.id }, include: { vehicle: { select: { id: true, plateNumber: true } } } });
      return { record, req };
    });
    await this.approvals.announce(req);
    return record;
  }

  remove(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rec = await tx.fuelRecord.findFirst({ where: { id } });
      if (!rec) throw new NotFoundException('Fuel record not found');
      await this.approvals.cancelFor(tx, 'FUEL', id);
      await tx.fuelRecord.delete({ where: { id } });
      await this.recompute(tx, user.companyId, rec.vehicleId);
    });
  }

  /**
   * Where the vehicle was at fill time: the GPS fix closest to `filledAt` (±15 min) compared with the
   * fill location (phone GPS). Without a phone location the vehicle position becomes the fill location.
   */
  private async whereWasVehicle(tx: Tx, vehicleId: string, at: Date, fill: { lat: number; lng: number } | null) {
    const [fix] = await tx.$queryRaw<{ latitude: number; longitude: number; speed_kmh: number | null; recorded_at: Date }[]>`
      SELECT latitude, longitude, speed_kmh, recorded_at FROM vehicle_positions
       WHERE vehicle_id = ${vehicleId}::uuid AND recorded_at BETWEEN ${new Date(at.getTime() - 15 * 60_000)} AND ${new Date(at.getTime() + 15 * 60_000)}
       ORDER BY abs(extract(epoch from recorded_at - ${at}::timestamptz)) LIMIT 1`;
    const settings = parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).fuelControl;
    const vehicle = fix ? { lat: fix.latitude, lng: fix.longitude, speedKmh: fix.speed_kmh, minutesFromFill: Math.abs(fix.recorded_at.getTime() - at.getTime()) / 60_000 } : null;
    const c = locationCheck({ fill, vehicle, maxM: settings.locationMaxM });
    return {
      latitude: fill?.lat ?? vehicle?.lat ?? null,
      longitude: fill?.lng ?? vehicle?.lng ?? null,
      locationSource: fill ? 'phone' : vehicle ? 'gps' : null,
      vehicleDistanceM: c.distanceM,
      // Persisted, then merged into the recomputed flags.
      flags: c.flag ? [c.flag] : [],
    };
  }

  /** GPS km since the previous fill, for this fill and the one after it (back-dated entries). */
  private async refreshGpsKm(tx: Tx, vehicleId: string, id: string) {
    const fills = await tx.fuelRecord.findMany({ where: { vehicleId }, select: { id: true, filledAt: true }, orderBy: { filledAt: 'asc' } });
    const i = fills.findIndex((f) => f.id === id);
    for (const k of [i, i + 1]) {
      if (k <= 0 || k >= fills.length) continue;
      const rows = await tx.$queryRaw<{ recorded_at: Date; latitude: number; longitude: number }[]>`
        SELECT recorded_at, latitude, longitude FROM vehicle_positions
         WHERE vehicle_id = ${vehicleId}::uuid AND recorded_at BETWEEN ${fills[k - 1].filledAt} AND ${fills[k].filledAt}
         ORDER BY recorded_at`;
      const km = rows.length > 1 ? Math.round(trackDistanceKm(rows.map((r) => ({ ...r, recordedAt: r.recorded_at }))) * 10) / 10 : null;
      await tx.fuelRecord.update({ where: { id: fills[k].id }, data: { gpsKm: km } });
    }
  }

  /** Re-derives efficiency and flags for a vehicle's whole chain (handles back-dated entries). */
  private async recompute(tx: Tx, companyId: string, vehicleId: string) {
    const [fills, vehicle, company] = await Promise.all([
      tx.fuelRecord.findMany({ where: { vehicleId }, select: { id: true, filledAt: true, odometerKm: true, litres: true, fullTank: true, distanceKm: true, kmPerLitre: true, flags: true, gpsKm: true }, orderBy: { filledAt: 'asc' } }),
      tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { tankCapacityL: true } }),
      tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }),
    ]);
    const results = computeFuelChain(
      fills.map((f) => ({ ...f, odometerKm: Number(f.odometerKm), litres: Number(f.litres) })),
      { tankCapacityL: vehicle.tankCapacityL ? Number(vehicle.tankCapacityL) : null, lowEfficiencyRatio: parseCompanySettings(company.settings).maintenance.lowEfficiencyRatio },
    );
    const fc = parseCompanySettings(company.settings).fuelControl;
    // Flags that are not derived from the chain are kept (location, card, sensor checks).
    const KEEP = new Set(['VEHICLE_ELSEWHERE', 'CARD_MISMATCH', 'SENSOR_MISMATCH']);
    for (const [i, f] of fills.entries()) {
      const r = results.get(f.id)!;
      const prev = fills[i - 1];
      const km = prev ? kmCheck(Number(f.odometerKm) - Number(prev.odometerKm), f.gpsKm == null ? null : Number(f.gpsKm), fc.kmMismatchPct) : null;
      const flags = [...r.flags, ...(km ? [km] : []), ...f.flags.filter((x) => KEEP.has(x))];
      const changed = n(f.distanceKm) !== n(r.distanceKm) || n(f.kmPerLitre) !== n(r.kmPerLitre) || f.flags.join() !== flags.join();
      if (changed) {
        await tx.fuelRecord.update({ where: { id: f.id }, data: { distanceKm: r.distanceKm, kmPerLitre: r.kmPerLitre, flags } });
      }
    }
  }

  /** Public so card/sensor checks can re-run the chain after adding a flag. */
  recomputeIn(tx: Tx, companyId: string, vehicleId: string) {
    return this.recompute(tx, companyId, vehicleId);
  }

  /**
   * Consumption variance per vehicle for [from, to): actual km/L of the period's full-to-full segments vs
   * the vehicle's own median over the previous 90 days (else its class median), litres and cost above it.
   */
  variance(user: AuthUser, from: Date, to: Date) {
    return this.db.tenant(user.companyId, async (tx) => {
      const baselineFrom = new Date(from.getTime() - 90 * 86_400_000);
      const rows = await tx.fuelRecord.findMany({
        where: { filledAt: { gte: baselineFrom, lt: to }, approvalStatus: { not: 'REJECTED' } },
        select: { vehicleId: true, filledAt: true, litres: true, totalCost: true, distanceKm: true, kmPerLitre: true },
      });
      const vehicles = await tx.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true, vehicleClass: true, make: true, model: true } });
      const cls = new Map(vehicles.map((v) => [v.id, v.vehicleClass]));
      const base = (r: (typeof rows)[number]) => r.filledAt < from && r.kmPerLitre != null;
      const classBase = new Map<string, number[]>();
      for (const r of rows.filter(base)) classBase.set(cls.get(r.vehicleId)!, [...(classBase.get(cls.get(r.vehicleId)!) ?? []), n(r.kmPerLitre)]);
      const out = vehicles
        .map((v) => {
          const mine = rows.filter((r) => r.vehicleId === v.id);
          const period = mine.filter((r) => r.filledAt >= from);
          const segs = period.filter((r) => r.distanceKm && r.kmPerLitre).map((r) => ({ km: n(r.distanceKm), litres: n(r.distanceKm) / n(r.kmPerLitre) }));
          const litres = period.reduce((s, r) => s + n(r.litres), 0);
          const cost = period.reduce((s, r) => s + n(r.totalCost), 0);
          const cv = consumptionVariance({ segments: segs, baseline: mine.filter(base).map((r) => n(r.kmPerLitre)), classBaseline: classBase.get(v.vehicleClass) ?? [], unitPrice: litres ? cost / litres : null });
          return { id: v.id, plateNumber: v.plateNumber, name: `${v.make} ${v.model}`, vehicleClass: v.vehicleClass, fills: period.length, ...cv };
        })
        .filter((v) => v.fills > 0)
        .sort((a, b) => (a.variancePct ?? 0) - (b.variancePct ?? 0));
      return {
        from,
        to,
        vehicles: out,
        totals: { excessLitres: round(out.reduce((s, v) => s + (v.excessLitres ?? 0), 0), 1), excessCost: Math.round(out.reduce((s, v) => s + (v.excessCost ?? 0), 0)) },
        classMedians: Object.fromEntries([...classBase].map(([k, xs]) => [k, xs.length >= 3 ? round(median(xs)!, 2) : null])),
        method: 'Actual km/L = km ÷ litres of the full-to-full segments ending in the period. Expected = the vehicle’s median km/L over the previous 90 days (at least 3 segments), else the median of its class. Excess litres = litres above what the expected km/L needed for the same km.',
      };
    });
  }

  /** Per-vehicle and fleet totals for [from, to). */
  summary(user: AuthUser, from: Date, to: Date) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rows = await tx.fuelRecord.findMany({
        where: { filledAt: { gte: from, lt: to } },
        select: { vehicleId: true, litres: true, totalCost: true, distanceKm: true, kmPerLitre: true, flags: true },
      });
      const vehicles = await tx.vehicle.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.vehicleId))] } },
        select: { id: true, plateNumber: true, vehicleClass: true },
      });
      const byV = new Map<string, { litres: number; cost: number; fills: number; distance: number; segLitres: number; flagged: number }>();
      for (const r of rows) {
        const a = byV.get(r.vehicleId) ?? { litres: 0, cost: 0, fills: 0, distance: 0, segLitres: 0, flagged: 0 };
        a.litres += n(r.litres);
        a.cost += n(r.totalCost);
        a.fills += 1;
        if (r.flags.length) a.flagged += 1;
        if (r.distanceKm && r.kmPerLitre) {
          a.distance += n(r.distanceKm);
          a.segLitres += n(r.distanceKm) / n(r.kmPerLitre);
        }
        byV.set(r.vehicleId, a);
      }
      const shape = (a: { litres: number; cost: number; fills: number; distance: number; segLitres: number; flagged: number }) => ({
        fills: a.fills,
        litres: round(a.litres),
        cost: round(a.cost),
        distanceKm: round(a.distance, 1),
        kmPerLitre: a.segLitres ? round(a.distance / a.segLitres) : null,
        litresPer100Km: a.distance ? round((a.segLitres / a.distance) * 100) : null,
        costPerKm: a.distance && a.segLitres ? round((a.cost / a.litres) * (a.segLitres / a.distance)) : null,
        flagged: a.flagged,
      });
      const fleet = [...byV.values()].reduce(
        (t, a) => ({ litres: t.litres + a.litres, cost: t.cost + a.cost, fills: t.fills + a.fills, distance: t.distance + a.distance, segLitres: t.segLitres + a.segLitres, flagged: t.flagged + a.flagged }),
        { litres: 0, cost: 0, fills: 0, distance: 0, segLitres: 0, flagged: 0 },
      );
      return {
        from,
        to,
        fleet: shape(fleet),
        vehicles: vehicles
          .map((v) => ({ ...v, ...shape(byV.get(v.id)!) }))
          .sort((a, b) => b.cost - a.cost),
      };
    });
  }
}
