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
  history(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      const [statuses, assignments, documents] = await Promise.all([
        tx.vehicleStatusEvent.findMany({ where: { vehicleId: id } }),
        tx.vehicleAssignment.findMany({
          where: { vehicleId: id },
          include: { driver: { select: { fullName: true } } },
        }),
        tx.vehicleDocument.findMany({ where: { vehicleId: id } }),
      ]);
      const events = [
        ...statuses.map((e) => ({
          at: e.createdAt,
          kind: 'status' as const,
          summary: `${e.fromStatus ? `${e.fromStatus} → ` : ''}${e.toStatus}${e.reason ? ` (${e.reason})` : ''}`,
          refId: e.id,
        })),
        ...assignments.flatMap((a) => {
          const target = a.driver?.fullName ?? (a.branchId ? 'branch' : 'department');
          const out = [{ at: a.startAt, kind: 'assignment' as const, summary: `Assigned to ${target}`, refId: a.id }];
          if (a.endAt) out.push({ at: a.endAt, kind: 'assignment' as const, summary: `Released from ${target}`, refId: a.id });
          return out;
        }),
        ...documents.map((d) => ({
          at: d.createdAt,
          kind: 'document' as const,
          summary: `${d.type} ${d.number ?? ''} added${d.expiresAt ? `, expires ${d.expiresAt.toISOString().slice(0, 10)}` : ''}`,
          refId: d.id,
        })),
      ];
      return events.sort((a, b) => b.at.getTime() - a.at.getTime());
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
