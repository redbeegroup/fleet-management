import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateVehicleRequestInput, Permission } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { nextNumber } from '../../common/vehicle-status';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TripsService } from './trips.service';

/**
 * Vehicle booking requests from staff: PENDING → (approval) APPROVED / REJECTED → (dispatcher assigns
 * a vehicle and driver, creating a trip) SCHEDULED. The requester may cancel until it is scheduled.
 */
@Injectable()
export class VehicleRequestsService implements OnModuleInit {
  private readonly logger = new Logger(VehicleRequestsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly trips: TripsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.approvals.register('VEHICLE_REQUEST', async (tx, id, outcome, ctx) => {
      if (outcome === 'CANCELLED') return;
      await tx.vehicleRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: outcome === 'APPROVED' ? { status: 'APPROVED' } : { status: 'REJECTED', rejectionReason: ctx.note },
      });
    });
  }

  async create(user: AuthUser, input: CreateVehicleRequestInput) {
    if (input.plannedStart.getTime() < Date.now() - 3_600_000) throw new BadRequestException('plannedStart is in the past');
    const { vr, req } = await this.db.tenant(user.companyId, async (tx) => {
      const year = input.plannedStart.getUTCFullYear();
      const requestNo = `VR-${year}-${String(await nextNumber(tx, user.companyId, `vr:${year}`)).padStart(6, '0')}`;
      const vr = await tx.vehicleRequest.create({ data: { ...input, requestNo, companyId: user.companyId, requestedBy: user.userId } });
      const when = input.plannedStart.toISOString().slice(0, 16).replace('T', ' ');
      const req = await this.approvals.request(tx, user.companyId, user.userId, {
        kind: 'VEHICLE_REQUEST',
        entityId: vr.id,
        title: `${requestNo}: ${input.originName} → ${input.destinationName} (${when} UTC)`,
        amount: null,
      });
      return { vr, req };
    });
    await this.approvals.announce(req);
    return vr;
  }

  async list(user: AuthUser, q: { status?: string; mine?: boolean; page: number; pageSize: number }) {
    const all = user.permissions.includes(Permission.VEHICLE_REQUEST_READ) && !q.mine;
    const where: Prisma.VehicleRequestWhereInput = { ...(!all && { requestedBy: user.userId }), ...(q.status && { status: q.status as never }) };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.vehicleRequest.findMany({ where, orderBy: { plannedStart: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.vehicleRequest.count({ where }),
      ]);
      return { items: await this.decorate(tx, items), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vr = await tx.vehicleRequest.findFirst({ where: { id } });
      if (!vr || (vr.requestedBy !== user.userId && !user.permissions.includes(Permission.VEHICLE_REQUEST_READ))) throw new NotFoundException('Request not found');
      return (await this.decorate(tx, [vr]))[0];
    });
  }

  cancel(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vr = await this.lock(tx, id);
      if (vr.requestedBy !== user.userId) throw new NotFoundException('Request not found');
      if (vr.status !== 'PENDING' && vr.status !== 'APPROVED') throw new BadRequestException(`A ${vr.status.toLowerCase()} request cannot be cancelled`);
      await this.approvals.cancelFor(tx, 'VEHICLE_REQUEST', id);
      return tx.vehicleRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
  }

  /** Dispatcher turns an approved request into an assigned trip. */
  async schedule(user: AuthUser, id: string, input: { vehicleId: string; driverId: string }) {
    const vr = await this.db.tenant(user.companyId, (tx) => tx.vehicleRequest.findFirst({ where: { id } }));
    if (!vr) throw new NotFoundException('Request not found');
    if (vr.status !== 'APPROVED') throw new BadRequestException(`Only approved requests can be scheduled (this one is ${vr.status.toLowerCase()})`);
    const notes = [vr.passengers != null ? `Passengers: ${vr.passengers}` : null, vr.notes, `Booking ${vr.requestNo}`].filter(Boolean).join('\n');
    // Validates vehicle/driver availability and licences like any other trip.
    const trip = await this.trips.create(user, {
      originName: vr.originName,
      destinationName: vr.destinationName,
      plannedStart: vr.plannedStart,
      plannedEnd: vr.plannedEnd,
      purpose: vr.purpose.slice(0, 200),
      cargoDescription: vr.cargoDescription,
      notes,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
    } as Parameters<TripsService['create']>[1]);
    try {
      const updated = await this.db.tenant(user.companyId, async (tx) => {
        const cur = await this.lock(tx, id);
        if (cur.status !== 'APPROVED') throw new ConflictException(`The request changed to ${cur.status.toLowerCase()} meanwhile`);
        return tx.vehicleRequest.update({ where: { id }, data: { status: 'SCHEDULED', tripId: trip.id } });
      });
      await this.notifications
        .notify({
          companyId: user.companyId,
          userIds: [vr.requestedBy],
          topic: 'vehicle_request.scheduled',
          severity: 'info',
          title: `${vr.requestNo} scheduled: ${trip.vehicle?.plateNumber ?? ''} with ${trip.driver?.fullName ?? ''}`.trim(),
          body: `Trip ${trip.tripNo} on ${vr.plannedStart.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          data: { requestId: id, tripId: trip.id, link: '/vehicle-requests' },
          dedupeKey: `vr-scheduled:${id}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
      return { ...updated, trip: { id: trip.id, tripNo: trip.tripNo } };
    } catch (e) {
      await this.trips.cancel(user, trip.id, { reason: `Booking ${vr.requestNo} could not be scheduled` }).catch(() => undefined);
      throw e;
    }
  }

  private async decorate<T extends { requestedBy: string; tripId: string | null }>(tx: Tx, rows: T[]) {
    const [users, trips] = await Promise.all([
      tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedBy))] } }, select: { id: true, fullName: true } }),
      tx.trip.findMany({
        where: { id: { in: rows.map((r) => r.tripId).filter((x): x is string => !!x) } },
        select: { id: true, tripNo: true, status: true, vehicle: { select: { plateNumber: true } }, driver: { select: { fullName: true } } },
      }),
    ]);
    const u = new Map(users.map((x) => [x.id, x.fullName]));
    const t = new Map(trips.map((x) => [x.id, x]));
    return rows.map((r) => ({ ...r, requesterName: u.get(r.requestedBy) ?? null, trip: r.tripId ? (t.get(r.tripId) ?? null) : null }));
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM vehicle_requests WHERE id = ${id}::uuid FOR UPDATE`;
    const vr = await tx.vehicleRequest.findFirst({ where: { id } });
    if (!vr) throw new NotFoundException('Request not found');
    return vr;
  }
}
