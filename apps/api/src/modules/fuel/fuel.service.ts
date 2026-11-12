import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateFuelRecordInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { FilesService } from '../files/files.service';
import { computeFuelChain } from './efficiency';

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
export class FuelService {
  constructor(private readonly db: PrismaService) {}

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

  create(user: AuthUser, input: CreateFuelRecordInput, source = 'web') {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
      if (!vehicle) throw new BadRequestException('Vehicle not found');
      if (input.driverId && !(await tx.driver.findFirst({ where: { id: input.driverId }, select: { id: true } }))) {
        throw new BadRequestException('Driver not found');
      }
      await FilesService.assertOwned(tx, input.receiptFileId);
      const unitPrice = input.unitPrice ?? round(input.totalCost! / input.litres, 2);
      const totalCost = input.totalCost ?? round(input.unitPrice! * input.litres, 2);
      const rec = await tx.fuelRecord.create({
        data: {
          ...input,
          unitPrice,
          totalCost,
          fuelType: input.fuelType ?? vehicle.fuelType,
          companyId: user.companyId,
          source,
          createdBy: user.userId,
        },
      });
      if (input.odometerKm > Number(vehicle.odometerKm)) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: input.odometerKm } });
      }
      await this.recompute(tx, user.companyId, vehicle.id);
      return tx.fuelRecord.findUniqueOrThrow({ where: { id: rec.id }, include: { vehicle: { select: { id: true, plateNumber: true } } } });
    });
  }

  remove(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rec = await tx.fuelRecord.findFirst({ where: { id } });
      if (!rec) throw new NotFoundException('Fuel record not found');
      await tx.fuelRecord.delete({ where: { id } });
      await this.recompute(tx, user.companyId, rec.vehicleId);
    });
  }

  /** Re-derives efficiency and flags for a vehicle's whole chain (handles back-dated entries). */
  private async recompute(tx: Tx, companyId: string, vehicleId: string) {
    const [fills, vehicle, company] = await Promise.all([
      tx.fuelRecord.findMany({ where: { vehicleId }, select: { id: true, filledAt: true, odometerKm: true, litres: true, fullTank: true, distanceKm: true, kmPerLitre: true, flags: true } }),
      tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { tankCapacityL: true } }),
      tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }),
    ]);
    const results = computeFuelChain(
      fills.map((f) => ({ ...f, odometerKm: Number(f.odometerKm), litres: Number(f.litres) })),
      { tankCapacityL: vehicle.tankCapacityL ? Number(vehicle.tankCapacityL) : null, lowEfficiencyRatio: parseCompanySettings(company.settings).maintenance.lowEfficiencyRatio },
    );
    for (const f of fills) {
      const r = results.get(f.id)!;
      const changed =
        n(f.distanceKm) !== n(r.distanceKm) || n(f.kmPerLitre) !== n(r.kmPerLitre) || f.flags.join() !== r.flags.join();
      if (changed) {
        await tx.fuelRecord.update({ where: { id: f.id }, data: { distanceKm: r.distanceKm, kmPerLitre: r.kmPerLitre, flags: r.flags } });
      }
    }
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
