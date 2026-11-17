import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MeterReadingInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { checkLoad, describeViolations, loadTotals } from '../logistics/capacity';
import { payloadLimit } from '../compliance/rules';

const ACTIVE = ['PLANNED', 'ASSIGNED', 'ONGOING'] as const;
const n = (v: unknown) => (v == null ? null : Number(v));

/** Trailers and equipment: meter readings, trip trailers and couplings. */
@Injectable()
export class AssetsService {
  constructor(private readonly db: PrismaService) {}

  private async vehicle(tx: Tx, id: string) {
    const v = await tx.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  /** Odometer or hour meter reading; never lower than the current value. */
  addReading(user: AuthUser, vehicleId: string, body: MeterReadingInput, source: 'WEB' | 'APP' = 'WEB') {
    return this.db.tenant(user.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
      const v = await this.vehicle(tx, vehicleId);
      const current = body.kind === 'KM' ? Number(v.odometerKm) : n(v.hourMeter);
      if (current != null && body.value < current) throw new BadRequestException(`The reading is below the current ${body.kind === 'KM' ? 'odometer' : 'hour meter'} (${current})`);
      const r = await tx.meterReading.create({ data: { companyId: user.companyId, vehicleId, kind: body.kind, value: body.value, readAt: body.readAt ?? new Date(), source, note: body.note ?? null, createdBy: user.userId } });
      await tx.vehicle.update({ where: { id: vehicleId }, data: body.kind === 'KM' ? { odometerKm: body.value } : { hourMeter: body.value } });
      return r;
    });
  }

  readings(user: AuthUser, vehicleId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.vehicle(tx, vehicleId);
      return tx.meterReading.findMany({ where: { vehicleId }, orderBy: { readAt: 'desc' }, take: 100 });
    });
  }

  /** Trailers that can be pulled: active trailers, with the trip they are booked on (if any). */
  trailers(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trailers = await tx.vehicle.findMany({ where: { assetKind: 'TRAILER', deletedAt: null, status: { not: 'DISPOSED' } }, select: { id: true, plateNumber: true, status: true, capacityKg: true, vehicleClass: true }, orderBy: { plateNumber: 'asc' } });
      const [trips, couplings] = await Promise.all([
        tx.trip.findMany({ where: { trailerId: { in: trailers.map((t) => t.id) }, status: { in: [...ACTIVE] } }, select: { id: true, tripNo: true, trailerId: true, status: true, plannedStart: true } }),
        tx.trailerCoupling.findMany({ where: { trailerId: { in: trailers.map((t) => t.id) }, uncoupledAt: null } }),
      ]);
      const plates = new Map((await tx.vehicle.findMany({ where: { id: { in: couplings.map((c) => c.tractorId) } }, select: { id: true, plateNumber: true } })).map((v) => [v.id, v.plateNumber]));
      return trailers.map((t) => ({
        ...t,
        capacityKg: n(t.capacityKg),
        trips: trips.filter((x) => x.trailerId === t.id),
        coupledTo: (() => {
          const c = couplings.find((x) => x.trailerId === t.id);
          return c ? { tractorId: c.tractorId, plateNumber: plates.get(c.tractorId) ?? null, since: c.coupledAt } : null;
        })(),
      }));
    });
  }

  /** Sets (or removes) the trailer of a planned / assigned trip. Delivery loads are re-checked against the combined limit. */
  setTrailer(user: AuthUser, tripId: string, trailerId: string | null) {
    return this.db.tenant(user.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
      const trip = await tx.trip.findFirst({ where: { id: tripId } });
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') throw new BadRequestException(`The trailer of a ${trip.status.toLowerCase()} trip cannot be changed`);
      let trailer = null;
      if (trailerId) {
        await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${trailerId}::uuid FOR UPDATE`;
        trailer = await tx.vehicle.findFirst({ where: { id: trailerId, deletedAt: null } });
        if (!trailer || trailer.assetKind !== 'TRAILER') throw new BadRequestException('Choose a trailer');
        if (['UNDER_REPAIR', 'INACTIVE', 'DISPOSED'].includes(trailer.status)) throw new ConflictException(`Trailer ${trailer.plateNumber} is ${trailer.status.toLowerCase().replace('_', ' ')}`);
        const clash = await tx.trip.findFirst({
          where: { id: { not: tripId }, trailerId, status: { in: [...ACTIVE] }, plannedStart: { lt: trip.plannedEnd }, plannedEnd: { gt: trip.plannedStart } },
          select: { tripNo: true },
        });
        if (clash) throw new ConflictException(`Trailer ${trailer.plateNumber} is booked on ${clash.tripNo}`);
      }
      if (trip.kind === 'DELIVERY' && trip.vehicleId) {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId } });
        const company = await tx.company.findFirstOrThrow({ select: { settings: true } });
        const settings = parseCompanySettings(company.settings);
        const orders = await tx.deliveryOrder.findMany({ where: { tripId }, select: { customerId: true, totalWeightKg: true, totalVolumeM3: true, totalCases: true, totalPallets: true } });
        const limit = payloadLimit({ vehicleClass: vehicle.vehicleClass, capacityKg: n(vehicle.capacityKg) }, trailer ? { vehicleClass: trailer.vehicleClass, capacityKg: n(trailer.capacityKg) } : null, settings.compliance.maxPayloadKg);
        const add = (a: unknown, b: unknown) => (a == null && b == null ? null : (n(a) ?? 0) + (n(b) ?? 0));
        const c = checkLoad(
          { id: vehicle.id, plateNumber: trailer ? `${vehicle.plateNumber} + ${trailer.plateNumber}` : vehicle.plateNumber, capacityKg: limit.kg, capacityM3: trailer ? add(vehicle.capacityM3, trailer.capacityM3) : n(vehicle.capacityM3), capacityCases: trailer ? (add(vehicle.capacityCases, trailer.capacityCases) as number | null) : vehicle.capacityCases, capacityPallets: trailer ? (add(vehicle.capacityPallets, trailer.capacityPallets) as number | null) : vehicle.capacityPallets, maxStops: vehicle.maxStops },
          loadTotals(orders.map((o) => ({ customerId: o.customerId, weightKg: n(o.totalWeightKg), volumeM3: n(o.totalVolumeM3), cases: n(o.totalCases), pallets: n(o.totalPallets) }))),
          settings.logistics.defaultMaxStops,
        );
        if (!c.ok) throw new UnprocessableEntityException({ message: `The load would exceed the limit: ${describeViolations(c)}`, violations: c.violations });
      }
      return tx.trip.update({ where: { id: tripId }, data: { trailerId }, select: { id: true, tripNo: true, trailerId: true } });
    });
  }

  /** Manual coupling outside trips (yard moves, a trailer left with a customer, …). */
  couple(user: AuthUser, trailerId: string, tractorId: string | null) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trailer = await this.vehicle(tx, trailerId);
      if (trailer.assetKind !== 'TRAILER') throw new BadRequestException('Not a trailer');
      const now = new Date();
      await tx.trailerCoupling.updateMany({ where: { trailerId, uncoupledAt: null }, data: { uncoupledAt: now } });
      if (!tractorId) return { coupled: false };
      const tractor = await this.vehicle(tx, tractorId);
      if (tractor.assetKind !== 'VEHICLE') throw new BadRequestException('A trailer is pulled by a vehicle');
      return tx.trailerCoupling.create({ data: { companyId: user.companyId, trailerId, tractorId, coupledAt: now, createdBy: user.userId } });
    });
  }

  /** Coupling history of a trailer or a tractor. */
  couplings(user: AuthUser, vehicleId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.vehicle(tx, vehicleId);
      const rows = await tx.trailerCoupling.findMany({ where: { OR: [{ trailerId: vehicleId }, { tractorId: vehicleId }] }, orderBy: { coupledAt: 'desc' }, take: 100 });
      const ids = [...new Set(rows.flatMap((r) => [r.trailerId, r.tractorId]))];
      const plates = new Map((await tx.vehicle.findMany({ where: { id: { in: ids } }, select: { id: true, plateNumber: true } })).map((v) => [v.id, v.plateNumber]));
      const trips = new Map((await tx.trip.findMany({ where: { id: { in: rows.map((r) => r.tripId).filter((x): x is string => !!x) } }, select: { id: true, tripNo: true } })).map((t) => [t.id, t.tripNo]));
      return rows.map((r) => ({ ...r, trailer: plates.get(r.trailerId) ?? null, tractor: plates.get(r.tractorId) ?? null, tripNo: r.tripId ? (trips.get(r.tripId) ?? null) : null }));
    });
  }
}
