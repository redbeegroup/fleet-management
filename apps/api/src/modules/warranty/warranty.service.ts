import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateWarrantyClaimInput, Role, UpdateWarrantyClaimInput, VehicleWarrantyInput, WebhookEvent } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { nextNumber } from '../../common/vehicle-status';
import { WebhooksService } from '../integrations/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { replay } from '../tires/tires';
import { CLAIM_FLOW, coverage, Coverage } from './coverage';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

/** Vehicle, part and tire warranty: coverage hints on repairs, warranty claims and alerts. */
@Injectable()
export class WarrantyService {
  private readonly log = new Logger('Warranty');

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------- vehicle warranties

  list(user: AuthUser, vehicleId?: string) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.vehicleWarranty.findMany({ where: { ...(vehicleId && { vehicleId }) }, include: { vehicle: { select: { plateNumber: true } } }, orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }] }),
    );
  }

  create(user: AuthUser, vehicleId: string, body: VehicleWarrantyInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } }))) throw new NotFoundException('Vehicle not found');
      if (body.supplierId && !(await tx.supplier.findFirst({ where: { id: body.supplierId } }))) throw new BadRequestException('Supplier not found');
      return tx.vehicleWarranty.create({ data: { ...body, companyId: user.companyId, vehicleId } });
    });
  }

  update(user: AuthUser, id: string, body: Partial<VehicleWarrantyInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.vehicleWarranty.findFirst({ where: { id } }))) throw new NotFoundException('Warranty not found');
      return tx.vehicleWarranty.update({ where: { id }, data: { ...body, alertedAt: null } });
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.db.tenant(user.companyId, async (tx) => {
      const { count } = await tx.vehicleWarranty.deleteMany({ where: { id } });
      if (!count) throw new NotFoundException('Warranty not found');
    });
  }

  // ---------------------------------------------------------------- coverage

  private async coverageFor(tx: Tx, vehicleId: string, at: Date, odometerKm: number, hint: { text?: string; partIds?: string[]; positions?: string[]; excludeWorkOrderId?: string }): Promise<Coverage[]> {
    const [warranties, lines, changes] = await Promise.all([
      tx.vehicleWarranty.findMany({ where: { vehicleId } }),
      tx.workOrderLine.findMany({
        where: { partId: { not: null }, workOrder: { vehicleId, status: { not: 'CANCELLED' }, ...(hint.excludeWorkOrderId && { id: { not: hint.excludeWorkOrderId } }) }, OR: [{ warrantyUntil: { not: null } }, { warrantyKmUntil: { not: null } }] },
        include: { part: { select: { partNo: true, name: true, supplierId: true } }, workOrder: { select: { woNo: true, completedAt: true, supplierId: true } } },
      }),
      tx.tireChange.findMany({ where: { vehicleId }, orderBy: { changedAt: 'asc' } }),
    ]);
    const current = replay(changes.map((c) => ({ ...c, odometerKm: Number(c.odometerKm), cost: Number(c.cost), removedTreadMm: n(c.removedTreadMm) }))).current;
    const supplierOf = new Map(changes.map((c) => [c.id, c.supplierId]));
    return coverage(
      at,
      odometerKm,
      {
        warranties: warranties.map((w) => ({ ...w, endKm: n(w.endKm) })),
        parts: lines.map((l) => ({
          lineId: l.id,
          woNo: l.workOrder.woNo,
          partId: l.partId!,
          partNo: l.part?.partNo ?? '',
          partName: l.part?.name ?? l.description,
          fittedAt: l.workOrder.completedAt ?? l.createdAt,
          warrantyUntil: l.warrantyUntil,
          warrantyKmUntil: n(l.warrantyKmUntil),
          supplierId: l.part?.supplierId ?? l.workOrder.supplierId,
        })),
        tires: [...current.values()].map((t) => ({ changeId: t.changeId, position: t.position, brand: t.brand, fittedAt: t.fittedAt, fitOdometerKm: t.fitOdometerKm, warrantyMonths: t.warrantyMonths, warrantyKm: t.warrantyKm, supplierId: supplierOf.get(t.changeId) ?? null })),
      },
      hint,
    );
  }

  /** Warranties that may cover a work order (shown on the work order page). */
  forWorkOrder(user: AuthUser, workOrderId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: workOrderId }, include: { lines: { select: { partId: true } }, repairRequests: { select: { description: true } }, vehicle: { select: { odometerKm: true } } } });
      if (!wo) throw new NotFoundException('Work order not found');
      const text = [wo.title, wo.description, ...wo.repairRequests.map((r) => r.description)].filter(Boolean).join(' ');
      const items = await this.coverageFor(tx, wo.vehicleId, wo.openedAt, Number(wo.odometerKm ?? wo.vehicle.odometerKm), {
        text,
        partIds: wo.lines.map((l) => l.partId).filter((x): x is string => !!x),
        excludeWorkOrderId: wo.id,
      });
      const suppliers = await tx.supplier.findMany({ where: { id: { in: items.map((i) => i.supplierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const name = new Map(suppliers.map((s) => [s.id, s.name]));
      const claims = await tx.warrantyClaim.findMany({ where: { workOrderId }, orderBy: { createdAt: 'desc' } });
      return { items: items.map((i) => ({ ...i, supplierName: i.supplierId ? (name.get(i.supplierId) ?? null) : null })), claims };
    });
  }

  /** After a work order is created: tell managers when a warranty may cover it. */
  async noticeForWorkOrder(user: AuthUser, workOrderId: string) {
    try {
      const r = await this.forWorkOrder(user, workOrderId);
      const relevant = r.items.filter((i) => i.relevant);
      if (!relevant.length) return 0;
      const wo = await this.db.tenant(user.companyId, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId }, select: { woNo: true, title: true, vehicle: { select: { plateNumber: true } } } }));
      return await this.notifications.notify({
        companyId: user.companyId,
        roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
        topic: 'warranty.possible',
        severity: 'info',
        title: `${wo.woNo} (${wo.vehicle.plateNumber}) may be under warranty`,
        body: relevant.map((i) => `${i.label}${i.until ? ` until ${i.until.toISOString().slice(0, 10)}` : ''}${i.untilKm != null ? ` / ${Math.round(i.untilKm).toLocaleString('en-US')} km` : ''}`).join('\n'),
        data: { workOrderId, link: `/maintenance/work-orders/${workOrderId}` },
        dedupeKey: `warranty-wo:${workOrderId}`,
      });
    } catch (e) {
      this.log.warn(`Warranty notice for ${workOrderId} failed: ${(e as Error).message}`);
      return 0;
    }
  }

  // ---------------------------------------------------------------- claims

  claims(user: AuthUser, q: { status?: string; vehicleId?: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const items = await tx.warrantyClaim.findMany({ where: { ...(q.status && { status: q.status }), ...(q.vehicleId && { vehicleId: q.vehicleId }) }, orderBy: { createdAt: 'desc' }, take: 300 });
      const [vehicles, suppliers, wos] = await Promise.all([
        tx.vehicle.findMany({ where: { id: { in: [...new Set(items.map((c) => c.vehicleId))] } }, select: { id: true, plateNumber: true } }),
        tx.supplier.findMany({ where: { id: { in: items.map((c) => c.supplierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
        tx.workOrder.findMany({ where: { id: { in: items.map((c) => c.workOrderId).filter((x): x is string => !!x) } }, select: { id: true, woNo: true } }),
      ]);
      const plate = new Map(vehicles.map((v) => [v.id, v.plateNumber]));
      const sup = new Map(suppliers.map((s) => [s.id, s.name]));
      const woNo = new Map(wos.map((w) => [w.id, w.woNo]));
      const year = new Date().getUTCFullYear();
      const recoveredThisYear = items.filter((c) => c.status === 'RECOVERED' && c.recoveredAt && c.recoveredAt.getUTCFullYear() === year).reduce((a, c) => a + Number(c.amountRecovered ?? 0), 0);
      return {
        items: items.map((c) => ({ ...c, plateNumber: plate.get(c.vehicleId) ?? null, supplierName: c.supplierId ? (sup.get(c.supplierId) ?? null) : null, woNo: c.workOrderId ? (woNo.get(c.workOrderId) ?? null) : null })),
        totals: {
          open: items.filter((c) => c.status === 'DRAFT' || c.status === 'SUBMITTED' || c.status === 'APPROVED').length,
          claimedOpen: Math.round(items.filter((c) => c.status === 'SUBMITTED' || c.status === 'APPROVED').reduce((a, c) => a + Number(c.amountClaimed), 0)),
          recoveredThisYear: Math.round(recoveredThisYear),
        },
      };
    });
  }

  createClaim(user: AuthUser, body: CreateWarrantyClaimInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.vehicle.findFirst({ where: { id: body.vehicleId } }))) throw new BadRequestException('Vehicle not found');
      if (body.workOrderId) {
        const wo = await tx.workOrder.findFirst({ where: { id: body.workOrderId }, select: { vehicleId: true } });
        if (!wo || wo.vehicleId !== body.vehicleId) throw new BadRequestException('Work order not found for this vehicle');
      }
      if (body.supplierId && !(await tx.supplier.findFirst({ where: { id: body.supplierId } }))) throw new BadRequestException('Supplier not found');
      const ok = !body.basisRef
        ? true
        : body.basis === 'VEHICLE'
          ? !!(await tx.vehicleWarranty.findFirst({ where: { id: body.basisRef, vehicleId: body.vehicleId } }))
          : body.basis === 'PART'
            ? !!(await tx.workOrderLine.findFirst({ where: { id: body.basisRef, workOrder: { vehicleId: body.vehicleId } } }))
            : !!(await tx.tireChange.findFirst({ where: { id: body.basisRef, vehicleId: body.vehicleId } }));
      if (!ok) throw new BadRequestException('The warranty reference does not belong to this vehicle');
      const year = new Date().getUTCFullYear();
      const claimNo = `WCL-${year}-${String(await nextNumber(tx, user.companyId, `wcl:${year}`)).padStart(5, '0')}`;
      return tx.warrantyClaim.create({ data: { ...body, claimNo, companyId: user.companyId, createdBy: user.userId } });
    });
  }

  updateClaim(user: AuthUser, id: string, body: UpdateWarrantyClaimInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const c = await tx.warrantyClaim.findFirst({ where: { id } });
      if (!c) throw new NotFoundException('Claim not found');
      const next = CLAIM_FLOW[c.status]?.[body.action];
      if (!next) throw new BadRequestException(`A ${c.status.toLowerCase()} claim cannot be ${body.action.toLowerCase()}ed`);
      const at = body.at ?? new Date();
      const data: Prisma.WarrantyClaimUpdateInput = {
        status: next,
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.fileIds && { fileIds: body.fileIds }),
        ...(body.amountClaimed !== undefined && (c.status === 'DRAFT' || body.action === 'EDIT') && { amountClaimed: body.amountClaimed }),
      };
      if (body.action === 'SUBMIT') data.submittedAt = at;
      if (body.action === 'APPROVE') {
        data.decidedAt = at;
        data.amountApproved = body.amountApproved ?? c.amountClaimed;
      }
      if (body.action === 'REJECT') {
        data.decidedAt = at;
        data.amountApproved = 0;
      }
      if (body.action === 'RECOVER') {
        const amount = body.amountRecovered ?? Number(c.amountApproved ?? c.amountClaimed);
        if (!(amount > 0)) throw new BadRequestException('Enter the amount recovered');
        data.recoveredAt = at;
        data.amountRecovered = amount;
      }
      const updated = await tx.warrantyClaim.update({ where: { id }, data });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: `warranty_claim.${body.action.toLowerCase()}`, entity: 'warranty_claim', entityId: id, payload: { from: c.status, to: next } } });
      if (next !== c.status) {
        await this.webhooks.emit(tx, user.companyId, WebhookEvent.WARRANTY_CLAIM_UPDATED, {
          id: updated.id, claimNo: updated.claimNo, vehicleId: updated.vehicleId, workOrderId: updated.workOrderId, basis: updated.basis, status: updated.status,
          amountClaimed: Number(updated.amountClaimed), amountApproved: n(updated.amountApproved), amountRecovered: n(updated.amountRecovered),
        });
      }
      return updated;
    });
  }

  // ---------------------------------------------------------------- alerts

  /** Daily: vehicle warranties ending within 30 days / 2,000 km; claims waiting > 30 days. */
  async alerts(now = new Date()): Promise<number> {
    let sent = 0;
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const ending = await this.db.system((tx) =>
      tx.vehicleWarranty.findMany({ where: { alertedAt: null, vehicle: { deletedAt: null } }, include: { vehicle: { select: { plateNumber: true, odometerKm: true } } } }),
    );
    for (const w of ending) {
      const byDate = w.endDate && w.endDate >= now && w.endDate <= in30;
      const kmLeft = w.endKm != null ? Number(w.endKm) - Number(w.vehicle.odometerKm) : null;
      const byKm = kmLeft != null && kmLeft >= 0 && kmLeft <= 2000;
      if (!byDate && !byKm) continue;
      sent += await this.notifications.notify({
        companyId: w.companyId,
        roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
        topic: 'warranty.ending',
        severity: 'info',
        title: `${w.vehicle.plateNumber}: ${w.label ?? w.component.toLowerCase().replace('_', ' ')} warranty ends soon`,
        body: `${byDate ? `Ends on ${w.endDate!.toISOString().slice(0, 10)}.` : ''}${byKm ? ` ${Math.round(kmLeft!)} km left.` : ''} Have warranty repairs done before it ends.`.trim(),
        data: { vehicleId: w.vehicleId, link: `/vehicles/${w.vehicleId}` },
        dedupeKey: `warranty-end:${w.id}`,
      });
      await this.db.system((tx) => tx.vehicleWarranty.update({ where: { id: w.id }, data: { alertedAt: now } }));
    }
    const stale = await this.db.system((tx) => tx.warrantyClaim.findMany({ where: { status: 'SUBMITTED', submittedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } }));
    for (const c of stale) {
      sent += await this.notifications.notify({
        companyId: c.companyId,
        roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
        topic: 'warranty.claim_waiting',
        severity: 'info',
        title: `Warranty claim ${c.claimNo} has waited over 30 days`,
        body: `Submitted on ${c.submittedAt!.toISOString().slice(0, 10)} for ${Number(c.amountClaimed).toLocaleString('en-US')}. Follow up with the supplier.`,
        data: { claimId: c.id, link: '/maintenance?tab=warranty' },
        dedupeKey: `warranty-claim-wait:${c.id}:${Math.floor(now.getTime() / (14 * 86_400_000))}`,
      });
    }
    this.log.log(`Warranty alerts: ${sent}`);
    return sent;
  }
}
