import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { Prisma } from '@prisma/client';
import { CreateClaimInput, CreateIncidentInput, Role, UpdateClaimInput, UpdateIncidentInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { nextNumber } from '../../common/vehicle-status';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';

const include = {
  vehicle: { select: { id: true, plateNumber: true } },
  driver: { select: { id: true, fullName: true, employeeNo: true } },
  claims: { orderBy: { submittedAt: 'desc' as const } },
} satisfies Prisma.IncidentInclude;

const INCIDENT_FLOW: Record<string, string[]> = { REPORTED: ['INVESTIGATING', 'CLOSED'], INVESTIGATING: ['CLOSED'], CLOSED: ['INVESTIGATING'] };
const CLAIM_FLOW: Record<string, string[]> = { PENDING_APPROVAL: [], SUBMITTED: ['APPROVED', 'REJECTED'], APPROVED: ['SETTLED'], REJECTED: ['SUBMITTED'], SETTLED: [] };

@Injectable()
export class IncidentsService implements OnModuleInit {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.register('CLAIM', async (tx, id, outcome, ctx) => {
      const c = await tx.insuranceClaim.findUnique({ where: { id } });
      if (!c || c.status !== 'PENDING_APPROVAL' || outcome === 'CANCELLED') return;
      await tx.insuranceClaim.update({
        where: { id },
        data:
          outcome === 'APPROVED'
            ? { status: 'SUBMITTED', submittedAt: new Date() }
            : { status: 'REJECTED', decidedAt: new Date(), notes: `${c.notes ? `${c.notes}\n` : ''}Internal approval rejected: ${ctx.note ?? ''}`.trim() },
      });
    });
  }

  list(user: AuthUser, q: { status?: string; vehicleId?: string; driverId?: string; reportedBy?: string; page: number; pageSize: number }) {
    const where: Prisma.IncidentWhereInput = {
      ...(q.status && { status: q.status as never }),
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.driverId && { driverId: q.driverId }),
      ...(q.reportedBy && { reportedBy: q.reportedBy }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.incident.findMany({ where, include, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.incident.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const i = await tx.incident.findFirst({ where: { id }, include });
      if (!i) throw new NotFoundException('Incident not found');
      return i;
    });
  }

  async create(user: AuthUser, input: CreateIncidentInput, opts: { allowedVehicleIds?: string[]; forceDriverId?: string } = {}) {
    if (opts.allowedVehicleIds && input.vehicleId && !opts.allowedVehicleIds.includes(input.vehicleId)) {
      throw new BadRequestException('You can only report incidents for a vehicle assigned to you');
    }
    const inc = await this.db.tenant(user.companyId, async (tx) => {
      await this.assertRefs(tx, input);
      for (const f of input.photoFileIds) await FilesService.assertOwned(tx, f);
      let driverId = opts.forceDriverId ?? input.driverId ?? null;
      if (!driverId && input.vehicleId) {
        // Default to whoever was driving: ongoing trip, else standing assignment.
        const trip = await tx.trip.findFirst({ where: { vehicleId: input.vehicleId, status: 'ONGOING' }, select: { driverId: true } });
        const asg = await tx.vehicleAssignment.findFirst({ where: { vehicleId: input.vehicleId, endAt: null, driverId: { not: null } }, select: { driverId: true } });
        driverId = trip?.driverId ?? asg?.driverId ?? null;
      }
      const year = input.occurredAt.getUTCFullYear();
      const incidentNo = `INC-${year}-${String(await nextNumber(tx, user.companyId, `inc:${year}`)).padStart(6, '0')}`;
      return tx.incident.create({ data: { ...input, driverId, incidentNo, companyId: user.companyId, reportedBy: user.userId }, include });
    });
    if (inc.severity === 'HIGH' || inc.severity === 'CRITICAL' || inc.injuries) {
      await this.notifications
        .notify({
          companyId: user.companyId,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
          topic: 'safety.incident',
          severity: inc.severity === 'CRITICAL' || inc.injuries ? 'critical' : 'warning',
          title: `${inc.incidentNo}: ${inc.type.toLowerCase().replace('_', ' ')}${inc.vehicle ? ` — ${inc.vehicle.plateNumber}` : ''}${inc.injuries ? ' (injuries)' : ''}`,
          body: inc.description.slice(0, 300),
          data: { incidentId: inc.id, link: `/incidents/${inc.id}` },
          dedupeKey: `incident:${inc.id}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    }
    return inc;
  }

  update(user: AuthUser, id: string, input: UpdateIncidentInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const cur = await tx.incident.findFirst({ where: { id } });
      if (!cur) throw new NotFoundException('Incident not found');
      if (input.status && input.status !== cur.status && !INCIDENT_FLOW[cur.status].includes(input.status)) {
        throw new BadRequestException(`Cannot move an incident from ${cur.status} to ${input.status}`);
      }
      const findings = input.findings ?? cur.findings;
      if (input.status === 'CLOSED' && !findings) throw new BadRequestException('Record the findings before closing the incident');
      if (input.workOrderId && !(await tx.workOrder.findFirst({ where: { id: input.workOrderId }, select: { id: true } }))) {
        throw new BadRequestException('Work order not found');
      }
      if (input.driverId && !(await tx.driver.findFirst({ where: { id: input.driverId }, select: { id: true } }))) {
        throw new BadRequestException('Driver not found');
      }
      for (const f of input.photoFileIds ?? []) await FilesService.assertOwned(tx, f);
      return tx.incident.update({
        where: { id },
        data: {
          ...input,
          ...(input.status === 'CLOSED' && cur.status !== 'CLOSED' && { closedAt: new Date() }),
          ...(input.status && input.status !== 'CLOSED' && { closedAt: null }),
        },
        include,
      });
    });
  }

  async createClaim(user: AuthUser, incidentId: string, input: CreateClaimInput) {
    const { claim, req } = await this.db.tenant(user.companyId, async (tx) => {
      const inc = await tx.incident.findFirst({ where: { id: incidentId } });
      if (!inc) throw new NotFoundException('Incident not found');
      // Defaults from the vehicle's latest insurance document.
      const policy = inc.vehicleId
        ? await tx.vehicleDocument.findFirst({ where: { vehicleId: inc.vehicleId, type: 'INSURANCE' }, orderBy: { expiresAt: 'desc' } })
        : null;
      const year = new Date().getUTCFullYear();
      const claimNo = `CLM-${year}-${String(await nextNumber(tx, user.companyId, `clm:${year}`)).padStart(6, '0')}`;
      const needsApproval = (await this.approvals.need(tx, 'CLAIM', input.amountClaimed)).needed;
      const claim = await tx.insuranceClaim.create({
        data: {
          ...input,
          insurer: input.insurer ?? policy?.issuer ?? null,
          policyNo: input.policyNo ?? policy?.number ?? null,
          claimNo,
          incidentId,
          companyId: user.companyId,
          status: needsApproval ? 'PENDING_APPROVAL' : 'SUBMITTED',
        },
      });
      const req = needsApproval
        ? await this.approvals.request(tx, user.companyId, user.userId, { kind: 'CLAIM', entityId: claim.id, title: `${claimNo} for ${inc.incidentNo}`, amount: input.amountClaimed })
        : null;
      return { claim, req };
    });
    await this.approvals.announce(req);
    return claim;
  }

  updateClaim(user: AuthUser, id: string, input: UpdateClaimInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const c = await tx.insuranceClaim.findFirst({ where: { id } });
      if (!c) throw new NotFoundException('Claim not found');
      if (input.status && input.status !== c.status && !CLAIM_FLOW[c.status].includes(input.status)) {
        throw new BadRequestException(`Cannot move a claim from ${c.status} to ${input.status}`);
      }
      const approved = input.amountApproved ?? (c.amountApproved ? Number(c.amountApproved) : null);
      if (input.status === 'APPROVED' && approved == null) throw new BadRequestException('amountApproved is required to approve a claim');
      const paid = input.amountPaid ?? (c.amountPaid ? Number(c.amountPaid) : null);
      if (input.status === 'SETTLED' && paid == null) throw new BadRequestException('amountPaid is required to settle a claim');
      if (approved != null && approved > Number(c.amountClaimed)) throw new BadRequestException('Approved amount exceeds the claimed amount');
      return tx.insuranceClaim.update({
        where: { id },
        data: {
          ...input,
          ...((input.status === 'APPROVED' || input.status === 'REJECTED') && { decidedAt: new Date() }),
          ...(input.status === 'SETTLED' && { settledAt: new Date() }),
        },
      });
    });
  }

  claims(user: AuthUser, status?: string) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.insuranceClaim.findMany({
        where: status ? { status: status as never } : {},
        include: { incident: { select: { id: true, incidentNo: true, type: true, vehicle: { select: { plateNumber: true } } } } },
        orderBy: { submittedAt: 'desc' },
        take: 200,
      }),
    );
  }

  private async assertRefs(tx: Tx, i: { vehicleId?: string | null; driverId?: string | null; tripId?: string | null }) {
    if (i.vehicleId && !(await tx.vehicle.findFirst({ where: { id: i.vehicleId, deletedAt: null }, select: { id: true } }))) throw new BadRequestException('Vehicle not found');
    if (i.driverId && !(await tx.driver.findFirst({ where: { id: i.driverId }, select: { id: true } }))) throw new BadRequestException('Driver not found');
    if (i.tripId && !(await tx.trip.findFirst({ where: { id: i.tripId }, select: { id: true } }))) throw new BadRequestException('Trip not found');
  }
}
