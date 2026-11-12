import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import {
  BulkMaintenancePlanInput,
  CompleteWorkOrderInput,
  CreateRepairRequestInput,
  CreateWorkOrderInput,
  MaintenancePlanInput,
  Role,
  WorkOrderLineInput,
} from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { changeVehicleStatus, nextNumber, restingStatus } from '../../common/vehicle-status';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { minutesInStatus, planDue } from './due';

const woInclude = {
  vehicle: { select: { id: true, plateNumber: true, status: true } },
  plan: { select: { id: true, name: true } },
} satisfies Prisma.WorkOrderInclude;

const MANAGERS = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER];

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- plans

  async plans(user: AuthUser, vehicleId?: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [plans, company] = await Promise.all([
        tx.maintenancePlan.findMany({
          where: { ...(vehicleId && { vehicleId }), vehicle: { deletedAt: null } },
          include: {
            vehicle: { select: { id: true, plateNumber: true, odometerKm: true, status: true } },
            workOrders: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true, woNo: true, status: true } },
          },
          orderBy: [{ vehicle: { plateNumber: 'asc' } }, { name: 'asc' }],
        }),
        tx.company.findFirstOrThrow({ select: { settings: true } }),
      ]);
      const s = parseCompanySettings(company.settings).maintenance;
      const now = new Date();
      return plans.map(({ workOrders, ...p }) => ({
        ...p,
        openWorkOrder: workOrders[0] ?? null,
        due: p.active
          ? planDue({ ...p, lastDoneOdometerKm: p.lastDoneOdometerKm ? Number(p.lastDoneOdometerKm) : null }, Number(p.vehicle.odometerKm), now, s)
          : null,
      }));
    });
  }

  createPlan(user: AuthUser, input: MaintenancePlanInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
      if (!v) throw new BadRequestException('Vehicle not found');
      // Baseline defaults to "done now, at the current odometer".
      return tx.maintenancePlan.create({
        data: {
          ...input,
          companyId: user.companyId,
          lastDoneAt: input.lastDoneAt ?? new Date(),
          lastDoneOdometerKm: input.lastDoneOdometerKm ?? v.odometerKm,
        },
      });
    });
  }

  createPlansBulk(user: AuthUser, input: BulkMaintenancePlanInput) {
    if (!input.intervalKm && !input.intervalDays) throw new BadRequestException('Set intervalKm and/or intervalDays');
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicles = await tx.vehicle.findMany({ where: { id: { in: input.vehicleIds }, deletedAt: null } });
      if (vehicles.length !== new Set(input.vehicleIds).size) throw new BadRequestException('Unknown vehicle in vehicleIds');
      const now = new Date();
      const { count } = await tx.maintenancePlan.createMany({
        data: vehicles.map((v) => ({
          companyId: user.companyId,
          vehicleId: v.id,
          name: input.name,
          intervalKm: input.intervalKm,
          intervalDays: input.intervalDays,
          lastDoneAt: now,
          lastDoneOdometerKm: v.odometerKm,
        })),
      });
      return { created: count };
    });
  }

  updatePlan(user: AuthUser, id: string, input: Partial<MaintenancePlanInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.maintenancePlan.findFirst({ where: { id } }))) throw new NotFoundException('Plan not found');
      const { vehicleId: _ignored, ...data } = input;
      return tx.maintenancePlan.update({ where: { id }, data });
    });
  }

  removePlan(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { count } = await tx.maintenancePlan.deleteMany({ where: { id, workOrders: { none: {} } } });
      if (count) return;
      if (await tx.maintenancePlan.findFirst({ where: { id } })) {
        // Keep history: plans with work orders are deactivated, not deleted.
        await tx.maintenancePlan.update({ where: { id }, data: { active: false } });
        return;
      }
      throw new NotFoundException('Plan not found');
    });
  }

  // ------------------------------------------------------- repair requests

  async createRepairRequest(user: AuthUser, input: CreateRepairRequestInput, allowedVehicleIds?: string[]) {
    if (allowedVehicleIds && !allowedVehicleIds.includes(input.vehicleId)) {
      throw new BadRequestException('You can only report problems for a vehicle assigned to you');
    }
    const req = await this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null }, select: { id: true, plateNumber: true } });
      if (!v) throw new BadRequestException('Vehicle not found');
      await FilesService.assertOwned(tx, input.photoFileId);
      const r = await tx.repairRequest.create({ data: { ...input, companyId: user.companyId, reportedBy: user.userId } });
      return { ...r, plateNumber: v.plateNumber };
    });
    await this.notifications
      .notify({
        companyId: user.companyId,
        roles: MANAGERS,
        topic: 'maintenance.repair_request',
        severity: req.severity === 'HIGH' || req.severity === 'CRITICAL' ? 'warning' : 'info',
        title: `Repair request: ${req.plateNumber} (${req.severity.toLowerCase()})`,
        body: req.description.slice(0, 300),
        data: { repairRequestId: req.id, vehicleId: req.vehicleId, link: '/maintenance?tab=requests' },
        dedupeKey: `rr:${req.id}`,
      })
      .catch((e: Error) => this.logger.warn(e.message));
    return req;
  }

  repairRequests(user: AuthUser, status?: string, reportedBy?: string) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.repairRequest.findMany({
        where: { ...(status && { status: status as never }), ...(reportedBy && { reportedBy }) },
        include: { vehicle: { select: { id: true, plateNumber: true } }, workOrder: { select: { id: true, woNo: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  rejectRepairRequest(user: AuthUser, id: string, resolution: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = await tx.repairRequest.findFirst({ where: { id } });
      if (!r) throw new NotFoundException('Repair request not found');
      if (r.status !== 'OPEN') throw new BadRequestException('Only open requests can be rejected');
      return tx.repairRequest.update({ where: { id }, data: { status: 'REJECTED', resolution } });
    });
  }

  // ------------------------------------------------------------ work orders

  workOrders(user: AuthUser, q: { status?: WorkOrderStatus; vehicleId?: string; page: number; pageSize: number }) {
    const where: Prisma.WorkOrderWhereInput = { ...(q.status && { status: q.status }), ...(q.vehicleId && { vehicleId: q.vehicleId }) };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.workOrder.findMany({ where, include: woInclude, orderBy: { openedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.workOrder.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  workOrder(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id },
        include: { ...woInclude, lines: { orderBy: { createdAt: 'asc' } }, repairRequests: true },
      });
      if (!wo) throw new NotFoundException('Work order not found');
      return wo;
    });
  }

  createWorkOrder(user: AuthUser, input: CreateWorkOrderInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null } });
      if (!v) throw new BadRequestException('Vehicle not found');
      if (input.planId) {
        const plan = await tx.maintenancePlan.findFirst({ where: { id: input.planId, vehicleId: v.id } });
        if (!plan) throw new BadRequestException('Plan not found for this vehicle');
      }
      const { repairRequestIds, ...data } = input;
      const year = new Date().getUTCFullYear();
      const woNo = `WO-${year}-${String(await nextNumber(tx, user.companyId, `wo:${year}`)).padStart(6, '0')}`;
      let wo;
      try {
        wo = await tx.workOrder.create({
          data: { ...data, woNo, companyId: user.companyId, createdBy: user.userId, odometerKm: input.odometerKm ?? v.odometerKm },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('This maintenance plan already has an open work order');
        }
        throw e;
      }
      if (repairRequestIds?.length) {
        const { count } = await tx.repairRequest.updateMany({
          where: { id: { in: repairRequestIds }, vehicleId: v.id, status: 'OPEN' },
          data: { status: 'CONVERTED', workOrderId: wo.id },
        });
        if (count !== repairRequestIds.length) throw new BadRequestException('Some repair requests are not open or belong to another vehicle');
      }
      return tx.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: woInclude });
    });
  }

  /** Begin work; an off-road work order takes the vehicle UNDER_REPAIR (downtime starts). */
  startWorkOrder(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await this.lock(tx, id);
      if (wo.status !== 'OPEN') throw new BadRequestException(`Cannot start a ${wo.status.toLowerCase()} work order`);
      if (wo.offRoad) {
        const onTrip = await tx.trip.findFirst({ where: { vehicleId: wo.vehicleId, status: 'ONGOING' }, select: { tripNo: true } });
        if (onTrip) throw new ConflictException(`Vehicle is on trip ${onTrip.tripNo}; complete it first`);
        await changeVehicleStatus(tx, user, wo.vehicleId, 'UNDER_REPAIR', `${wo.woNo}: ${wo.title}`);
      }
      return tx.workOrder.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() }, include: woInclude });
    });
  }

  addLine(user: AuthUser, id: string, input: WorkOrderLineInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await this.lock(tx, id);
      this.assertEditable(wo.status);
      await tx.workOrderLine.create({
        data: { ...input, companyId: user.companyId, workOrderId: id, total: Math.round(input.quantity * input.unitCost * 100) / 100 },
      });
      return this.retotal(tx, id);
    });
  }

  removeLine(user: AuthUser, id: string, lineId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await this.lock(tx, id);
      this.assertEditable(wo.status);
      const { count } = await tx.workOrderLine.deleteMany({ where: { id: lineId, workOrderId: id } });
      if (!count) throw new NotFoundException('Line not found');
      return this.retotal(tx, id);
    });
  }

  completeWorkOrder(user: AuthUser, id: string, input: CompleteWorkOrderInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await this.lock(tx, id);
      if (wo.status !== 'OPEN' && wo.status !== 'IN_PROGRESS') throw new BadRequestException(`Cannot complete a ${wo.status.toLowerCase()} work order`);
      const completedAt = input.completedAt ?? new Date();
      const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: wo.vehicleId } });
      const odo = input.odometerKm ?? Number(vehicle.odometerKm);
      if (odo > Number(vehicle.odometerKm)) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: odo } });
      if (wo.planId) {
        await tx.maintenancePlan.update({ where: { id: wo.planId }, data: { lastDoneAt: completedAt, lastDoneOdometerKm: odo } });
      }
      const updated = await tx.workOrder.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt, resolution: input.resolution, startedAt: wo.startedAt ?? wo.openedAt, odometerKm: odo },
        include: woInclude,
      });
      await this.releaseVehicle(tx, user, wo.vehicleId, id, `${wo.woNo} completed`);
      return updated;
    });
  }

  cancelWorkOrder(user: AuthUser, id: string, reason: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await this.lock(tx, id);
      if (wo.status !== 'OPEN' && wo.status !== 'IN_PROGRESS') throw new BadRequestException(`Cannot cancel a ${wo.status.toLowerCase()} work order`);
      await tx.repairRequest.updateMany({ where: { workOrderId: id }, data: { status: 'OPEN', workOrderId: null } });
      const updated = await tx.workOrder.update({ where: { id }, data: { status: 'CANCELLED', resolution: reason }, include: woInclude });
      await this.releaseVehicle(tx, user, wo.vehicleId, id, `${wo.woNo} cancelled`);
      return updated;
    });
  }

  // ---------------------------------------------------------------- reports

  /** Downtime (UNDER_REPAIR minutes) and maintenance cost per vehicle for [from, to). */
  report(user: AuthUser, from: Date, to: Date) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [vehicles, events, wos] = await Promise.all([
        tx.vehicle.findMany({ where: { deletedAt: null, status: { not: 'DISPOSED' } }, select: { id: true, plateNumber: true, vehicleClass: true, status: true } }),
        tx.vehicleStatusEvent.findMany({ where: { createdAt: { lt: to } }, select: { vehicleId: true, createdAt: true, fromStatus: true, toStatus: true } }),
        tx.workOrder.findMany({
          where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
          select: { vehicleId: true, totalCost: true, type: true, lines: { select: { kind: true, total: true } } },
        }),
      ]);
      const periodMin = (Math.min(to.getTime(), Date.now()) - from.getTime()) / 60_000;
      const rows = vehicles.map((v) => {
        const mine = wos.filter((w) => w.vehicleId === v.id);
        const byKind = (k: string) => mine.flatMap((w) => w.lines).filter((l) => l.kind === k).reduce((s, l) => s + Number(l.total), 0);
        const downtime = minutesInStatus(events.filter((e) => e.vehicleId === v.id), 'UNDER_REPAIR', from, to);
        return {
          ...v,
          downtimeMinutes: downtime,
          downtimePct: periodMin > 0 ? Math.round((downtime / periodMin) * 1000) / 10 : 0,
          workOrders: mine.length,
          cost: Math.round(mine.reduce((s, w) => s + Number(w.totalCost), 0) * 100) / 100,
          labour: byKind('LABOUR'),
          parts: byKind('PART'),
          external: byKind('EXTERNAL'),
        };
      });
      return {
        from,
        to,
        totals: {
          cost: Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100,
          workOrders: rows.reduce((s, r) => s + r.workOrders, 0),
          downtimeMinutes: rows.reduce((s, r) => s + r.downtimeMinutes, 0),
        },
        vehicles: rows.sort((a, b) => b.cost - a.cost || b.downtimeMinutes - a.downtimeMinutes),
      };
    });
  }

  /** Daily job: notify about plans that are due soon or overdue (once per due cycle and status). */
  async dueAlerts(now = new Date()): Promise<number> {
    const plans = await this.db.system((tx) =>
      tx.maintenancePlan.findMany({
        where: { active: true, vehicle: { deletedAt: null, status: { notIn: ['DISPOSED', 'INACTIVE'] } } },
        include: { vehicle: { select: { plateNumber: true, odometerKm: true } }, workOrders: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true } } },
      }),
    );
    const companies = await this.db.system((tx) =>
      tx.company.findMany({ where: { id: { in: [...new Set(plans.map((p) => p.companyId))] } }, select: { id: true, settings: true } }),
    );
    const settingsBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).maintenance]));
    let sent = 0;
    for (const p of plans) {
      if (p.workOrders.length) continue; // already being handled
      const due = planDue({ ...p, lastDoneOdometerKm: p.lastDoneOdometerKm ? Number(p.lastDoneOdometerKm) : null }, Number(p.vehicle.odometerKm), now, settingsBy.get(p.companyId)!);
      if (due.status === 'OK') continue;
      const parts = [
        due.remainingKm !== null ? (due.remainingKm <= 0 ? `${-due.remainingKm} km overdue` : `due in ${due.remainingKm} km`) : null,
        due.remainingDays !== null ? (due.remainingDays <= 0 ? `${-due.remainingDays} days overdue` : `due in ${due.remainingDays} days`) : null,
      ].filter(Boolean);
      sent += await this.notifications.notify({
        companyId: p.companyId,
        roles: MANAGERS,
        topic: 'maintenance.due',
        severity: due.status === 'OVERDUE' ? 'warning' : 'info',
        title: `${p.vehicle.plateNumber}: ${p.name} ${due.status === 'OVERDUE' ? 'overdue' : 'due soon'}`,
        body: `${p.name} for ${p.vehicle.plateNumber} is ${parts.join(' / ')}.`,
        data: { planId: p.id, vehicleId: p.vehicleId, link: '/maintenance' },
        dedupeKey: `pm:${p.id}:${p.lastDoneAt?.toISOString() ?? ''}:${due.status}`,
      });
    }
    return sent;
  }

  // ---------------------------------------------------------------------

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Work order not found');
    return tx.workOrder.findUniqueOrThrow({ where: { id } });
  }

  private assertEditable(status: WorkOrderStatus) {
    if (status === 'COMPLETED' || status === 'CANCELLED') throw new BadRequestException(`A ${status.toLowerCase()} work order cannot be changed`);
  }

  private async retotal(tx: Tx, id: string) {
    const lines = await tx.workOrderLine.findMany({ where: { workOrderId: id }, select: { total: true } });
    const totalCost = Math.round(lines.reduce((s, l) => s + Number(l.total), 0) * 100) / 100;
    await tx.workOrder.update({ where: { id }, data: { totalCost } });
    return tx.workOrder.findUniqueOrThrow({ where: { id }, include: { ...woInclude, lines: { orderBy: { createdAt: 'asc' } } } });
  }

  /** Returns the vehicle to service unless another off-road work order is still in progress. */
  private async releaseVehicle(tx: Tx, user: AuthUser, vehicleId: string, exceptWoId: string, reason: string) {
    const v = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { status: true } });
    if (v.status !== 'UNDER_REPAIR') return;
    const other = await tx.workOrder.count({ where: { vehicleId, id: { not: exceptWoId }, status: 'IN_PROGRESS', offRoad: true } });
    if (other) return;
    await changeVehicleStatus(tx, user, vehicleId, await restingStatus(tx, vehicleId), reason);
  }
}
