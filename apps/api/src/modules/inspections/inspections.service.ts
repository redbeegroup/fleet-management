import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChecklistItem, CreateInspectionInput, CreateInspectionTemplateInput, Role, UpdateInspectionTemplateInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { nextNumber } from '../../common/vehicle-status';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_TEMPLATES, evaluateInspection, preTripBlock } from './evaluate';

const include = {
  vehicle: { select: { id: true, plateNumber: true } },
  driver: { select: { id: true, fullName: true } },
  template: { select: { id: true, name: true } },
} satisfies Prisma.InspectionInclude;

export interface InspectionQuery {
  vehicleId?: string;
  driverId?: string;
  kind?: string;
  result?: string;
  from?: Date;
  to?: Date;
  performedBy?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------- templates

  /** All templates; seeds the default checklists the first time a company asks. */
  templates(user: AuthUser, opts: { activeOnly?: boolean; vehicleClass?: string; kind?: string } = {}) {
    return this.db.tenant(user.companyId, async (tx) => {
      if ((await tx.inspectionTemplate.count()) === 0) {
        await tx.inspectionTemplate.createMany({
          data: DEFAULT_TEMPLATES.map((t) => ({ companyId: user.companyId, name: t.name, kind: t.kind, items: t.items })),
        });
      }
      const rows = await tx.inspectionTemplate.findMany({
        where: { ...(opts.activeOnly && { active: true }), ...(opts.kind && { kind: opts.kind as never }) },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      });
      return opts.vehicleClass ? rows.filter((t) => t.vehicleClasses.length === 0 || t.vehicleClasses.includes(opts.vehicleClass!)) : rows;
    });
  }

  createTemplate(user: AuthUser, input: CreateInspectionTemplateInput) {
    return this.db.tenant(user.companyId, (tx) => tx.inspectionTemplate.create({ data: { ...input, companyId: user.companyId } }));
  }

  updateTemplate(user: AuthUser, id: string, input: UpdateInspectionTemplateInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.inspectionTemplate.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Checklist not found');
      // Past inspections keep a copy of the items they were performed against, so editing is safe.
      return tx.inspectionTemplate.update({ where: { id }, data: input });
    });
  }

  // ------------------------------------------------------------ inspections

  list(user: AuthUser, q: InspectionQuery) {
    const where: Prisma.InspectionWhereInput = {
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.driverId && { driverId: q.driverId }),
      ...(q.kind && { kind: q.kind as never }),
      ...(q.result && { result: q.result as never }),
      ...(q.performedBy && { performedBy: q.performedBy }),
      ...((q.from || q.to) && { performedAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.inspection.findMany({ where, include, orderBy: { performedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.inspection.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const i = await tx.inspection.findFirst({ where: { id }, include });
      if (!i) throw new NotFoundException('Inspection not found');
      return i;
    });
  }

  async create(user: AuthUser, input: CreateInspectionInput, opts: { allowedVehicleIds?: string[]; forceDriverId?: string } = {}) {
    if (opts.allowedVehicleIds && !opts.allowedVehicleIds.includes(input.vehicleId)) {
      throw new BadRequestException('You can only inspect a vehicle assigned to you');
    }
    const performedAt = input.performedAt ?? new Date();
    if (performedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('performedAt is in the future');
    const res = await this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null }, select: { id: true, plateNumber: true, vehicleClass: true } });
      if (!vehicle) throw new BadRequestException('Vehicle not found');
      const template = await tx.inspectionTemplate.findFirst({ where: { id: input.templateId, active: true } });
      if (!template) throw new BadRequestException('Checklist not found');
      if (template.vehicleClasses.length && !template.vehicleClasses.includes(vehicle.vehicleClass)) {
        throw new BadRequestException(`Checklist "${template.name}" does not apply to ${vehicle.vehicleClass.toLowerCase()} vehicles`);
      }
      const ev = evaluateInspection(template.items as unknown as ChecklistItem[], input.answers);
      if ('errors' in ev) throw new BadRequestException({ message: 'Incomplete inspection', errors: ev.errors.map((m) => ({ path: 'answers', message: m })) });
      for (const a of input.answers) await FilesService.assertOwned(tx, a.photoFileId);
      if (input.tripId) {
        const trip = await tx.trip.findFirst({ where: { id: input.tripId }, select: { vehicleId: true } });
        if (!trip || trip.vehicleId !== vehicle.id) throw new BadRequestException('Trip not found for this vehicle');
      }
      let driverId = opts.forceDriverId ?? input.driverId ?? null;
      if (input.driverId && !opts.forceDriverId && !(await tx.driver.findFirst({ where: { id: input.driverId }, select: { id: true } }))) {
        throw new BadRequestException('Driver not found');
      }
      if (!driverId) driverId = (await tx.vehicleAssignment.findFirst({ where: { vehicleId: vehicle.id, endAt: null }, select: { driverId: true } }))?.driverId ?? null;

      const year = performedAt.getUTCFullYear();
      const inspectionNo = `INS-${year}-${String(await nextNumber(tx, user.companyId, `ins:${year}`)).padStart(6, '0')}`;
      let repairRequestId: string | null = null;
      if (ev.defects) {
        const lines = ev.items.filter((i) => !i.ok).map((i) => `• ${i.label}${i.critical ? ' [critical]' : ''}${i.note ? `: ${i.note}` : ''}`);
        const rr = await tx.repairRequest.create({
          data: {
            companyId: user.companyId,
            vehicleId: vehicle.id,
            reportedBy: user.userId,
            description: `${inspectionNo} (${template.name}) found ${ev.defects} defect(s):\n${lines.join('\n')}`,
            severity: ev.criticalDefects ? 'HIGH' : 'MEDIUM',
            odometerKm: input.odometerKm ?? undefined,
            photoFileId: ev.items.find((i) => !i.ok && i.photoFileId)?.photoFileId ?? null,
          },
        });
        repairRequestId = rr.id;
      }
      const created = await tx.inspection.create({
        data: {
          companyId: user.companyId,
          inspectionNo,
          vehicleId: vehicle.id,
          driverId,
          tripId: input.tripId ?? null,
          templateId: template.id,
          kind: template.kind,
          performedAt,
          odometerKm: input.odometerKm ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          items: ev.items as unknown as Prisma.InputJsonValue,
          defects: ev.defects,
          criticalDefects: ev.criticalDefects,
          result: ev.result,
          notes: input.notes ?? null,
          performedBy: user.userId,
          repairRequestId,
        },
        include,
      });
      return created;
    });
    if (res.defects) {
      await this.notifications
        .notify({
          companyId: user.companyId,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
          topic: res.result === 'FAIL' ? 'inspection.failed' : 'inspection.defects',
          severity: res.result === 'FAIL' ? 'critical' : 'info',
          title: `${res.vehicle.plateNumber}: ${res.kind === 'PRE_TRIP' ? 'pre-trip' : res.kind === 'POST_TRIP' ? 'post-trip' : 'periodic'} inspection ${res.result === 'FAIL' ? 'FAILED' : `found ${res.defects} defect(s)`}`,
          body: `${res.inspectionNo}: ${res.defects} defect(s), ${res.criticalDefects} critical. A repair request was raised.`,
          data: { inspectionId: res.id, vehicleId: res.vehicleId, link: `/inspections/${res.id}` },
          dedupeKey: `inspection:${res.id}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    }
    return res;
  }

  /** Throws when the company requires a pre-trip inspection and the vehicle has no valid one. */
  async assertPreTrip(tx: Tx, vehicleId: string, now = new Date()) {
    const company = await tx.company.findFirstOrThrow({ select: { settings: true } });
    const s = parseCompanySettings(company.settings).inspections;
    if (!s.requirePreTrip) return;
    const latest = await tx.inspection.findFirst({
      where: { vehicleId, kind: 'PRE_TRIP', performedAt: { lte: now } },
      orderBy: { performedAt: 'desc' },
      select: { performedAt: true, result: true, inspectionNo: true },
    });
    const reason = preTripBlock(latest, now, s.preTripValidHours);
    if (reason) throw new BadRequestException(reason);
  }
}
