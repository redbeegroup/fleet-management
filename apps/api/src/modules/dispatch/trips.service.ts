import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TripStatus } from '@prisma/client';
import {
  AssignTripInput,
  AvailabilityQuery,
  CancelTripInput,
  CompleteTripInput,
  CreateTripInput,
  StartTripInput,
  TRIP_STATUS_TRANSITIONS,
  UpdateTripInput,
} from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { NotificationsService } from '../notifications/notifications.service';
import { trackDistanceKm } from '../telematics/rules/geo';
import { blocks, BLOCKING_VEHICLE_STATUSES, checkLicence } from './eligibility';

export interface TripListQuery {
  from?: Date;
  to?: Date;
  status?: TripStatus;
  vehicleId?: string;
  driverId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

const ACTIVE: TripStatus[] = ['PLANNED', 'ASSIGNED', 'ONGOING'];

export const tripInclude = {
  vehicle: { select: { id: true, plateNumber: true, vehicleClass: true, make: true, model: true } },
  driver: { select: { id: true, fullName: true, employeeNo: true, phone: true } },
} satisfies Prisma.TripInclude;

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  list(user: AuthUser, q: TripListQuery) {
    const where: Prisma.TripWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.driverId && { driverId: q.driverId }),
      // Window filter: anything overlapping [from, to)
      ...(q.from && { plannedEnd: { gt: q.from } }),
      ...(q.to && { plannedStart: { lt: q.to } }),
      ...(q.search && {
        OR: [
          { tripNo: { contains: q.search, mode: 'insensitive' } },
          { originName: { contains: q.search, mode: 'insensitive' } },
          { destinationName: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.trip.findMany({ where, include: tripInclude, orderBy: { plannedStart: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.trip.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id },
        include: { ...tripInclude, statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
      if (!trip) throw new NotFoundException('Trip not found');
      return trip;
    });
  }

  create(user: AuthUser, input: CreateTripInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const tripNo = await this.nextTripNo(tx, user.companyId, input.plannedStart);
      const { vehicleId, driverId, ...rest } = input;
      const trip = await tx.trip.create({ data: { ...rest, tripNo, companyId: user.companyId, createdBy: user.userId } });
      await this.event(tx, user, trip.id, null, 'PLANNED', 'Created');
      if (vehicleId && driverId) return this.doAssign(tx, user, trip.id, { vehicleId, driverId });
      if (vehicleId || driverId) {
        throw new BadRequestException('Assign both vehicleId and driverId, or neither');
      }
      return tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripInclude });
    }).then((t) => this.afterAssign(t));
  }

  update(user: AuthUser, id: string, input: UpdateTripInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockTrip(tx, id);
      if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') {
        throw new BadRequestException(`A ${trip.status.toLowerCase()} trip cannot be edited`);
      }
      const start = input.plannedStart ?? trip.plannedStart;
      const end = input.plannedEnd ?? trip.plannedEnd;
      if (end <= start) throw new BadRequestException('plannedEnd must be after plannedStart');
      if (trip.status === 'ASSIGNED' && (input.plannedStart || input.plannedEnd)) {
        await this.assertAssignable(tx, user.companyId, trip.vehicleId!, trip.driverId!, start, end, id);
      }
      return tx.trip.update({ where: { id }, data: input, include: tripInclude });
    });
  }

  assign(user: AuthUser, id: string, input: AssignTripInput) {
    return this.db
      .tenant(user.companyId, async (tx) => {
        const trip = await this.lockTrip(tx, id);
        this.assertTransition(trip.status, 'ASSIGNED', trip.status === 'ASSIGNED');
        return this.doAssign(tx, user, id, input);
      })
      .then((t) => this.afterAssign(t));
  }

  unassign(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockTrip(tx, id);
      this.assertTransition(trip.status, 'PLANNED');
      await this.event(tx, user, id, trip.status, 'PLANNED', 'Unassigned');
      return tx.trip.update({ where: { id }, data: { status: 'PLANNED', vehicleId: null, driverId: null }, include: tripInclude });
    });
  }

  start(user: AuthUser, id: string, input: StartTripInput, driverId?: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockTrip(tx, id);
      if (driverId && trip.driverId !== driverId) throw new NotFoundException('Trip not found');
      this.assertTransition(trip.status, 'ONGOING');
      const busy = await tx.trip.findFirst({
        where: { id: { not: id }, status: 'ONGOING', OR: [{ vehicleId: trip.vehicleId }, { driverId: trip.driverId }] },
        select: { tripNo: true },
      });
      if (busy) throw new ConflictException(`Vehicle or driver is still on trip ${busy.tripNo}`);
      const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId! } });
      if ((BLOCKING_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
        throw new BadRequestException(`Vehicle is ${vehicle.status.toLowerCase().replace('_', ' ')}`);
      }
      const at = input.at ?? new Date();
      await this.event(tx, user, id, trip.status, 'ONGOING', 'Started');
      await this.setVehicleStatus(tx, user, vehicle.id, vehicle.status, 'OPERATING', `Trip ${trip.tripNo} started`);
      return tx.trip.update({
        where: { id },
        data: { status: 'ONGOING', actualStart: at, startOdometerKm: input.odometerKm ?? vehicle.odometerKm },
        include: tripInclude,
      });
    });
  }

  complete(user: AuthUser, id: string, input: CompleteTripInput, driverId?: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockTrip(tx, id);
      if (driverId && trip.driverId !== driverId) throw new NotFoundException('Trip not found');
      this.assertTransition(trip.status, 'COMPLETED');
      const at = input.at ?? new Date();
      if (trip.actualStart && at < trip.actualStart) throw new BadRequestException('End time is before the start time');

      const rows = await tx.$queryRaw<{ recorded_at: Date; latitude: number; longitude: number }[]>`
        SELECT recorded_at, latitude, longitude FROM vehicle_positions
         WHERE vehicle_id = ${trip.vehicleId}::uuid AND recorded_at BETWEEN ${trip.actualStart} AND ${at}
         ORDER BY recorded_at`;
      const gpsKm = rows.length > 1 ? trackDistanceKm(rows.map((r) => ({ ...r, recordedAt: r.recorded_at }))) : null;
      const startOdo = trip.startOdometerKm ? Number(trip.startOdometerKm) : null;
      const endOdo = input.odometerKm ?? (startOdo !== null && gpsKm !== null ? startOdo + gpsKm : startOdo);
      if (endOdo !== null && startOdo !== null && endOdo < startOdo) {
        throw new BadRequestException(`End odometer (${endOdo}) is below the start odometer (${startOdo})`);
      }

      const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId! } });
      if (endOdo !== null && endOdo > Number(vehicle.odometerKm)) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: endOdo } });
      }
      if (vehicle.status === 'OPERATING') {
        const held = await tx.vehicleAssignment.count({ where: { vehicleId: vehicle.id, endAt: null, driverId: { not: null } } });
        await this.setVehicleStatus(tx, user, vehicle.id, 'OPERATING', held ? 'ASSIGNED' : 'AVAILABLE', `Trip ${trip.tripNo} completed`);
      }
      await this.event(tx, user, id, trip.status, 'COMPLETED', input.notes ?? 'Completed');
      return tx.trip.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          actualEnd: at,
          endOdometerKm: endOdo,
          gpsDistanceKm: gpsKm !== null ? Math.round(gpsKm * 10) / 10 : null,
          ...(input.notes && { notes: trip.notes ? `${trip.notes}\n${input.notes}` : input.notes }),
        },
        include: tripInclude,
      });
    });
  }

  cancel(user: AuthUser, id: string, input: CancelTripInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockTrip(tx, id);
      this.assertTransition(trip.status, 'CANCELLED');
      await this.event(tx, user, id, trip.status, 'CANCELLED', input.reason);
      return tx.trip.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: input.reason }, include: tripInclude });
    });
  }

  /** Which vehicles and drivers are free for a window (with reasons when not). */
  availability(user: AuthUser, q: AvailabilityQuery & { vehicleId?: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [company, vehicles, drivers, trips] = await Promise.all([
        tx.company.findFirst({ select: { settings: true } }),
        tx.vehicle.findMany({
          where: { deletedAt: null, status: { not: 'DISPOSED' } },
          select: { id: true, plateNumber: true, vehicleClass: true, status: true, make: true, model: true, capacityKg: true },
          orderBy: { plateNumber: 'asc' },
        }),
        tx.driver.findMany({
          where: { active: true },
          select: {
            id: true,
            fullName: true,
            employeeNo: true,
            licenses: { select: { licenseClass: true, expiresAt: true } },
            duty: { where: { endedAt: null }, select: { id: true } },
          },
          orderBy: { fullName: 'asc' },
        }),
        tx.trip.findMany({
          where: { status: { in: ACTIVE }, plannedStart: { lt: q.to }, ...(q.excludeTripId && { id: { not: q.excludeTripId } }) },
          select: { id: true, tripNo: true, status: true, plannedStart: true, plannedEnd: true, vehicleId: true, driverId: true },
        }),
      ]);
      const settings = parseCompanySettings(company?.settings).dispatch;
      const clashing = trips.filter((t) => blocks(t, q.from, q.to));
      const forVehicle = q.vehicleId ? vehicles.find((v) => v.id === q.vehicleId) : undefined;
      return {
        vehicles: vehicles.map((v) => {
          const reasons: string[] = [];
          if ((BLOCKING_VEHICLE_STATUSES as readonly string[]).includes(v.status)) reasons.push(`Vehicle is ${v.status.toLowerCase().replace('_', ' ')}`);
          for (const t of clashing.filter((t) => t.vehicleId === v.id)) reasons.push(`Booked on ${t.tripNo}`);
          return { ...v, available: reasons.length === 0, reasons };
        }),
        drivers: drivers.map(({ licenses, duty, ...d }) => {
          const reasons: string[] = [];
          for (const t of clashing.filter((t) => t.driverId === d.id)) reasons.push(`Booked on ${t.tripNo}`);
          reasons.push(...checkLicence(forVehicle?.vehicleClass ?? null, licenses, q.to, settings).reasons);
          return {
            ...d,
            onDuty: duty.length > 0,
            licenceClasses: [...new Set(licenses.map((l) => l.licenseClass))],
            available: reasons.length === 0,
            reasons,
          };
        }),
      };
    });
  }

  // ---------------------------------------------------------------------------

  private async doAssign(tx: Tx, user: AuthUser, id: string, input: AssignTripInput) {
    const trip = await tx.trip.findUniqueOrThrow({ where: { id } });
    await this.assertAssignable(tx, user.companyId, input.vehicleId, input.driverId, trip.plannedStart, trip.plannedEnd, id);
    if (trip.status !== 'ASSIGNED') await this.event(tx, user, id, trip.status, 'ASSIGNED', 'Assigned');
    return tx.trip.update({ where: { id }, data: { ...input, status: 'ASSIGNED' }, include: tripInclude });
  }

  /** Serialises concurrent bookings by locking the vehicle and driver rows first. */
  private async assertAssignable(tx: Tx, companyId: string, vehicleId: string, driverId: string, from: Date, to: Date, excludeTripId: string) {
    await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId}::uuid FOR UPDATE`;
    const [vehicle, driver, company] = await Promise.all([
      tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } }),
      tx.driver.findFirst({ where: { id: driverId }, include: { licenses: true } }),
      tx.company.findUnique({ where: { id: companyId }, select: { settings: true } }),
    ]);
    if (!vehicle) throw new BadRequestException('Vehicle not found');
    if (!driver || !driver.active) throw new BadRequestException('Driver not found or inactive');
    const reasons: string[] = [];
    if ((BLOCKING_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
      reasons.push(`Vehicle is ${vehicle.status.toLowerCase().replace('_', ' ')}`);
    }
    reasons.push(...checkLicence(vehicle.vehicleClass, driver.licenses, to, parseCompanySettings(company?.settings).dispatch).reasons);
    const others = await tx.trip.findMany({
      where: { id: { not: excludeTripId }, status: { in: ACTIVE }, OR: [{ vehicleId }, { driverId }], plannedStart: { lt: to } },
      select: { id: true, tripNo: true, status: true, plannedStart: true, plannedEnd: true, vehicleId: true, driverId: true },
    });
    for (const t of others.filter((t) => blocks(t, from, to))) {
      reasons.push(`${t.vehicleId === vehicleId ? `${vehicle.plateNumber}` : driver.fullName} is booked on ${t.tripNo}`);
    }
    if (reasons.length) throw new ConflictException({ message: 'Cannot assign', reasons });
  }

  private async afterAssign<T extends { status: TripStatus; driverId: string | null; tripNo: string; id: string; companyId: string; originName: string; destinationName: string; plannedStart: Date }>(
    trip: T,
  ): Promise<T> {
    if (trip.status !== 'ASSIGNED' || !trip.driverId) return trip;
    const driver = await this.db.system((tx) => tx.driver.findUnique({ where: { id: trip.driverId! }, select: { userId: true } }));
    if (driver?.userId) {
      await this.notifications
        .notify({
          companyId: trip.companyId,
          userIds: [driver.userId],
          topic: 'trip.assigned',
          severity: 'info',
          title: `New trip ${trip.tripNo}`,
          body: `${trip.originName} → ${trip.destinationName}, starting ${trip.plannedStart.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          data: { tripId: trip.id, link: `/trips/${trip.id}` },
          dedupeKey: `trip-assigned:${trip.id}:${trip.driverId}`,
        })
        .catch((e: Error) => this.logger.warn(`Trip notification failed: ${e.message}`));
    }
    return trip;
  }

  private async lockTrip(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM trips WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Trip not found');
    return tx.trip.findUniqueOrThrow({ where: { id } });
  }

  private assertTransition(from: TripStatus, to: TripStatus, allowSame = false) {
    if (allowSame && from === to) return;
    if (!TRIP_STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot change trip from ${from} to ${to}`);
    }
  }

  private event(tx: Tx, user: AuthUser, tripId: string, fromStatus: TripStatus | null, toStatus: TripStatus, note?: string) {
    return tx.tripStatusEvent.create({ data: { companyId: user.companyId, tripId, fromStatus, toStatus, note, userId: user.userId } });
  }

  private async setVehicleStatus(tx: Tx, user: AuthUser, vehicleId: string, from: string, to: 'OPERATING' | 'ASSIGNED' | 'AVAILABLE', reason: string) {
    if (from === to) return;
    await tx.vehicleStatusEvent.create({
      data: { companyId: user.companyId, vehicleId, fromStatus: from as never, toStatus: to, reason, userId: user.userId },
    });
    await tx.vehicle.update({ where: { id: vehicleId }, data: { status: to } });
  }

  /** TRP-<year>-<000001>, sequential per company and year. */
  private async nextTripNo(tx: Tx, companyId: string, at: Date): Promise<string> {
    const year = at.getUTCFullYear();
    const [row] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO company_counters (company_id, key, value) VALUES (${companyId}::uuid, ${`trip:${year}`}, 1)
      ON CONFLICT (company_id, key) DO UPDATE SET value = company_counters.value + 1
      RETURNING value`;
    return `TRP-${year}-${String(row.value).padStart(6, '0')}`;
  }
}
