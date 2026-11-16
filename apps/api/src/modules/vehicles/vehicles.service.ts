import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AssignVehicleInput,
  ChangeVehicleStatusInput,
  CreateVehicleDocumentInput,
  CreateVehicleInput,
  Paginated,
  PaginationInput,
  UpdateVehicleDocumentInput,
  UpdateVehicleInput,
  VEHICLE_STATUS_TRANSITIONS,
  VehicleStatus,
} from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { FilesService } from '../files/files.service';

export interface VehicleListQuery extends PaginationInput {
  status?: VehicleStatus;
  branchId?: string;
}

export function canTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  return from === to || VEHICLE_STATUS_TRANSITIONS[from].includes(to);
}

@Injectable()
export class VehiclesService {
  constructor(private readonly db: PrismaService) {}

  list(user: AuthUser, q: VehicleListQuery): Promise<Paginated<unknown>> {
    const where: Prisma.VehicleWhereInput = {
      deletedAt: null,
      ...(q.status && { status: q.status }),
      ...(q.branchId && { branchId: q.branchId }),
      ...(q.search && {
        OR: [
          { plateNumber: { contains: q.search, mode: 'insensitive' } },
          { make: { contains: q.search, mode: 'insensitive' } },
          { model: { contains: q.search, mode: 'insensitive' } },
          { vin: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.vehicle.findMany({
          where,
          include: { branch: { select: { id: true, code: true, name: true } } },
          orderBy: { plateNumber: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.vehicle.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id, deletedAt: null },
        include: {
          branch: true,
          department: true,
          documents: {
            orderBy: { expiresAt: 'asc' },
            include: { file: { select: { id: true, filename: true, contentType: true, sizeBytes: true } } },
          },
          assignments: {
            where: { endAt: null },
            include: { driver: { select: { id: true, fullName: true, employeeNo: true } } },
          },
          statusHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      return vehicle;
    });
  }

  create(user: AuthUser, input: CreateVehicleInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { ...input, plateNumber: input.plateNumber.toUpperCase(), companyId: user.companyId },
      });
      await tx.vehicleStatusEvent.create({
        data: {
          companyId: user.companyId,
          vehicleId: vehicle.id,
          toStatus: vehicle.status,
          reason: 'Registered',
          userId: user.userId,
        },
      });
      return vehicle;
    });
  }

  update(user: AuthUser, id: string, input: UpdateVehicleInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      return tx.vehicle.update({
        where: { id },
        data: { ...input, ...(input.plateNumber && { plateNumber: input.plateNumber.toUpperCase() }) },
      });
    });
  }

  remove(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      await tx.vehicle.update({ where: { id }, data: { deletedAt: new Date(), gpsDeviceId: null } });
    });
  }

  changeStatus(user: AuthUser, id: string, input: ChangeVehicleStatusInput) {
    return this.db.tenant(user.companyId, (tx) => this.applyStatus(tx, user, id, input.status, input.reason));
  }

  /** Closes the current open assignment and opens a new one (driver / branch / department). */
  assign(user: AuthUser, id: string, input: AssignVehicleInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await this.mustExist(tx, id);
      if (vehicle.status === 'DISPOSED' || vehicle.status === 'INACTIVE' || vehicle.status === 'UNDER_REPAIR') {
        throw new BadRequestException(`Vehicle in status ${vehicle.status} cannot be assigned`);
      }
      if (input.driverId) {
        const driver = await tx.driver.findFirst({ where: { id: input.driverId, active: true } });
        if (!driver) throw new BadRequestException('Driver not found or inactive');
        // A driver holds one vehicle at a time.
        await tx.vehicleAssignment.updateMany({
          where: { driverId: input.driverId, endAt: null, vehicleId: { not: id } },
          data: { endAt: new Date() },
        });
      }
      const now = new Date();
      await tx.vehicleAssignment.updateMany({ where: { vehicleId: id, endAt: null }, data: { endAt: now } });
      const assignment = await tx.vehicleAssignment.create({
        data: {
          companyId: user.companyId,
          vehicleId: id,
          driverId: input.driverId ?? null,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          note: input.note,
          startAt: now,
          createdBy: user.userId,
        },
      });
      await tx.vehicle.update({
        where: { id },
        data: {
          ...(input.branchId && { branchId: input.branchId }),
          ...(input.departmentId && { departmentId: input.departmentId }),
        },
      });
      if (input.driverId && vehicle.status === 'AVAILABLE') {
        await this.applyStatus(tx, user, id, 'ASSIGNED', 'Assigned to driver');
      }
      return assignment;
    });
  }

  unassign(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await this.mustExist(tx, id);
      await tx.vehicleAssignment.updateMany({ where: { vehicleId: id, endAt: null }, data: { endAt: new Date() } });
      if (vehicle.status === 'ASSIGNED') await this.applyStatus(tx, user, id, 'AVAILABLE', 'Unassigned');
    });
  }

  assignmentHistory(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      return tx.vehicleAssignment.findMany({
        where: { vehicleId: id },
        include: { driver: { select: { id: true, fullName: true, employeeNo: true } } },
        orderBy: { startAt: 'desc' },
      });
    });
  }

  addDocument(user: AuthUser, vehicleId: string, input: CreateVehicleDocumentInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, vehicleId);
      await FilesService.assertOwned(tx, input.fileId);
      return tx.vehicleDocument.create({ data: { ...input, vehicleId, companyId: user.companyId } });
    });
  }

  updateDocument(user: AuthUser, vehicleId: string, documentId: string, input: UpdateVehicleDocumentInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const doc = await tx.vehicleDocument.findFirst({ where: { id: documentId, vehicleId } });
      if (!doc) throw new NotFoundException('Document not found');
      await FilesService.assertOwned(tx, input.fileId);
      return tx.vehicleDocument.update({ where: { id: documentId }, data: input });
    });
  }

  /**
   * Consolidated vehicle history: status changes, assignments and documents,
   * newest first. Trips, fuel and maintenance join this timeline as they ship.
   */
  /**
   * Everything that happened to a vehicle, newest first: status, assignments, documents, trips, fuel,
   * maintenance, repair requests, expenses, incidents, inspections and alerts. `kinds` filters, and
   * `before` + `limit` page through older entries.
   */
  history(user: AuthUser, id: string, q: { kinds?: string[]; before?: Date; limit?: number } = {}) {
    const limit = Math.min(q.limit ?? 200, 500);
    const want = (k: string) => !q.kinds?.length || q.kinds.includes(k);
    const lt = q.before ? { lt: q.before } : undefined;
    const none = Promise.resolve([] as never[]);
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      const [statuses, assignments, documents, trips, fuel, workOrders, repairs, expenses, incidents, inspections, alerts] = await Promise.all([
        want('status') ? tx.vehicleStatusEvent.findMany({ where: { vehicleId: id, createdAt: lt }, orderBy: { createdAt: 'desc' }, take: limit }) : none,
        want('assignment') ? tx.vehicleAssignment.findMany({ where: { vehicleId: id, startAt: lt }, include: { driver: { select: { fullName: true } } }, orderBy: { startAt: 'desc' }, take: limit }) : none,
        want('document') ? tx.vehicleDocument.findMany({ where: { vehicleId: id, createdAt: lt }, orderBy: { createdAt: 'desc' }, take: limit }) : none,
        want('trip') ? tx.trip.findMany({ where: { vehicleId: id, status: 'COMPLETED', actualEnd: lt }, include: { driver: { select: { fullName: true } } }, orderBy: { actualEnd: 'desc' }, take: limit }) : none,
        want('fuel') ? tx.fuelRecord.findMany({ where: { vehicleId: id, filledAt: lt }, orderBy: { filledAt: 'desc' }, take: limit }) : none,
        want('maintenance') ? tx.workOrder.findMany({ where: { vehicleId: id, status: 'COMPLETED', completedAt: lt }, orderBy: { completedAt: 'desc' }, take: limit }) : none,
        want('repair') ? tx.repairRequest.findMany({ where: { vehicleId: id, createdAt: lt }, orderBy: { createdAt: 'desc' }, take: limit }) : none,
        want('expense') ? tx.vehicleExpense.findMany({ where: { vehicleId: id, incurredAt: lt }, orderBy: { incurredAt: 'desc' }, take: limit }) : none,
        want('incident') ? tx.incident.findMany({ where: { vehicleId: id, occurredAt: lt }, orderBy: { occurredAt: 'desc' }, take: limit }) : none,
        want('inspection') ? tx.inspection.findMany({ where: { vehicleId: id, performedAt: lt }, orderBy: { performedAt: 'desc' }, take: limit }) : none,
        want('alert')
          ? tx.telemetryEvent.findMany({
              where: { vehicleId: id, occurredAt: lt, type: { in: ['OVERSPEED', 'GPS_OFFLINE', 'OFF_ROUTE', 'UNAUTHORISED_MOVEMENT', 'AFTER_HOURS', 'NO_DRIVER', 'RESTRICTED_AREA', 'FUEL_DROP', 'FUEL_REFILL', 'ENGINE_FAULT', 'HARSH_BRAKE', 'HARSH_ACCEL', 'HARSH_CORNER'] } },
              orderBy: { occurredAt: 'desc' },
              take: limit,
            })
          : none,
      ]);
      const money = (v: unknown) => Number(v).toLocaleString('en-US');
      const events = [
        ...statuses.map((e) => ({
          at: e.createdAt,
          kind: 'status' as const,
          summary: `${e.fromStatus ? `${e.fromStatus} → ` : ''}${e.toStatus}${e.reason ? ` (${e.reason})` : ''}`,
          refId: e.id,
          link: null as string | null,
        })),
        ...assignments.flatMap((a) => {
          const target = a.driver?.fullName ?? (a.branchId ? 'branch' : 'department');
          const out = [{ at: a.startAt, kind: 'assignment' as const, summary: `Assigned to ${target}`, refId: a.id, link: null as string | null }];
          if (a.endAt) out.push({ at: a.endAt, kind: 'assignment' as const, summary: `Released from ${target}`, refId: a.id, link: null });
          return out;
        }),
        ...documents.map((d) => ({
          at: d.createdAt,
          kind: 'document' as const,
          summary: `${d.type} ${d.number ?? ''} added${d.expiresAt ? `, expires ${d.expiresAt.toISOString().slice(0, 10)}` : ''}`,
          refId: d.id,
          link: null,
        })),
        ...trips.map((t) => ({
          at: t.actualEnd ?? t.plannedEnd,
          kind: 'trip' as const,
          summary: `${t.tripNo} ${t.originName} → ${t.destinationName}${t.driver ? ` (${t.driver.fullName})` : ''}${t.gpsDistanceKm ? `, ${Number(t.gpsDistanceKm)} km` : ''}`,
          refId: t.id,
          link: `/trips/${t.id}`,
        })),
        ...fuel.map((f) => ({
          at: f.filledAt,
          kind: 'fuel' as const,
          summary: `${Number(f.litres)} L at ${Number(f.odometerKm).toLocaleString()} km${f.kmPerLitre ? ` (${Number(f.kmPerLitre)} km/L)` : ''}${f.flags.length ? ` ⚠ ${f.flags.join(', ')}` : ''}`,
          refId: f.id,
          link: '/fuel',
        })),
        ...workOrders.map((w) => ({
          at: w.completedAt!,
          kind: 'maintenance' as const,
          summary: `${w.woNo} ${w.title} — ${money(w.totalCost)} cost`,
          refId: w.id,
          link: `/maintenance/work-orders/${w.id}`,
        })),
        ...repairs.map((r) => ({ at: r.createdAt, kind: 'repair' as const, summary: `Repair request (${r.severity.toLowerCase()}): ${r.description.slice(0, 120)} — ${r.status.toLowerCase()}`, refId: r.id, link: '/maintenance' })),
        ...expenses.map((e) => ({ at: e.incurredAt, kind: 'expense' as const, summary: `${e.category} ${money(e.amount)}${e.description ? ` — ${e.description.slice(0, 80)}` : ''}${e.approvalStatus !== 'APPROVED' ? ` (${e.approvalStatus.toLowerCase()})` : ''}`, refId: e.id, link: null })),
        ...incidents.map((i) => ({ at: i.occurredAt, kind: 'incident' as const, summary: `${i.incidentNo} ${i.type.toLowerCase().replace(/_/g, ' ')} (${i.severity.toLowerCase()})`, refId: i.id, link: `/incidents/${i.id}` })),
        ...inspections.map((i) => ({ at: i.performedAt, kind: 'inspection' as const, summary: `${i.inspectionNo} ${i.kind.toLowerCase().replace(/_/g, ' ')} inspection: ${i.result.toLowerCase()}`, refId: i.id, link: `/inspections/${i.id}` })),
        ...alerts.map((e) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          const extra = e.type === 'ENGINE_FAULT' ? ` ${d.code ?? String(d.kind ?? '').toLowerCase()}` : e.type.startsWith('FUEL_') ? ` ${d.litres} L` : e.speedKmh ? ` ${Math.round(e.speedKmh)} km/h` : '';
          return { at: e.occurredAt, kind: 'alert' as const, summary: `${e.type.toLowerCase().replace(/_/g, ' ')}${extra}`, refId: e.id, link: `/vehicles/${id}/track` };
        }),
      ];
      return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
    });
  }

  /** Latest engine diagnostics and fuel level reported by the GPS device, with recent faults. */
  diagnostics(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      const [d, faults] = await Promise.all([
        tx.vehicleDiagnostics.findUnique({ where: { vehicleId: id } }),
        tx.telemetryEvent.findMany({ where: { vehicleId: id, type: { in: ['ENGINE_FAULT', 'FUEL_DROP', 'FUEL_REFILL'] } }, orderBy: { occurredAt: 'desc' }, take: 20 }),
      ]);
      return { latest: d, events: faults };
    });
  }

  removeDocument(user: AuthUser, vehicleId: string, documentId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { count } = await tx.vehicleDocument.deleteMany({ where: { id: documentId, vehicleId } });
      if (!count) throw new NotFoundException('Document not found');
    });
  }

  /** Documents expiring within `days` (including already expired). */
  expiringDocuments(user: AuthUser, days: number) {
    const until = new Date(Date.now() + days * 86_400_000);
    return this.db.tenant(user.companyId, (tx) =>
      tx.vehicleDocument.findMany({
        where: { expiresAt: { lte: until }, vehicle: { deletedAt: null } },
        include: { vehicle: { select: { id: true, plateNumber: true } } },
        orderBy: { expiresAt: 'asc' },
      }),
    );
  }

  private async applyStatus(tx: Tx, user: AuthUser, id: string, to: VehicleStatus, reason?: string) {
    const vehicle = await this.mustExist(tx, id);
    if (!canTransition(vehicle.status, to)) {
      throw new BadRequestException(`Cannot change status from ${vehicle.status} to ${to}`);
    }
    if (vehicle.status === to) return vehicle;
    await tx.vehicleStatusEvent.create({
      data: { companyId: user.companyId, vehicleId: id, fromStatus: vehicle.status, toStatus: to, reason, userId: user.userId },
    });
    return tx.vehicle.update({
      where: { id },
      data: { status: to, ...(to === 'DISPOSED' && { disposedAt: new Date() }) },
    });
  }

  private async mustExist(tx: Tx, id: string) {
    const vehicle = await tx.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }
}
