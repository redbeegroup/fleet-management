import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalRequest, Prisma } from '@prisma/client';
import { Role, WebhookEvent } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { ApprovalKind, approvalNeed, decisionBlock } from './rules';

export type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
/** Applies the final decision to the owning record, inside the deciding transaction. */
export type OutcomeHandler = (tx: Tx, entityId: string, outcome: Outcome, ctx: { note: string | null; userId: string | null }) => Promise<void>;

const DECIDERS = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER];
const include = { decisions: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.ApprovalRequestInclude;
const LINKS: Record<ApprovalKind, (id: string) => string> = {
  WORK_ORDER: (id) => `/maintenance/work-orders/${id}`,
  EXPENSE: () => '/reports',
  FUEL: () => '/fuel',
  VEHICLE_REQUEST: () => '/vehicle-requests',
  CLAIM: () => '/incidents',
};

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly handlers = new Map<ApprovalKind, OutcomeHandler>();

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  register(kind: ApprovalKind, handler: OutcomeHandler) {
    this.handlers.set(kind, handler);
  }

  /** Whether `amount` needs approval for this company (reads settings in the transaction). */
  async need(tx: Tx, kind: ApprovalKind, amount: number | null) {
    const company = await tx.company.findFirstOrThrow({ select: { settings: true } });
    return approvalNeed(kind, amount, parseCompanySettings(company.settings).approvals);
  }

  /** Open a request inside the caller's transaction. Call `announce` after the transaction commits. */
  async request(tx: Tx, companyId: string, requestedBy: string | null, input: { kind: ApprovalKind; entityId: string; title: string; amount: number | null; required?: 1 | 2 }) {
    const required = input.required ?? (await this.need(tx, input.kind, input.amount)).required;
    const req = await tx.approvalRequest.create({
      data: { companyId, kind: input.kind, entityId: input.entityId, title: input.title, amount: input.amount, requestedBy, requiredApprovals: required },
      include,
    });
    await this.webhooks.emit(tx, companyId, WebhookEvent.APPROVAL_REQUESTED, this.payload(req));
    return req;
  }

  /** Notify everyone who can decide (except the requester). Safe to call with null. */
  async announce(req: ApprovalRequest | null | undefined) {
    if (!req) return;
    const users = await this.db.system((tx) =>
      tx.user.findMany({ where: { companyId: req.companyId, active: true, roles: { hasSome: DECIDERS }, ...(req.requestedBy && { id: { not: req.requestedBy } }) }, select: { id: true } }),
    );
    if (!users.length) return;
    await this.notifications
      .notify({
        companyId: req.companyId,
        userIds: users.map((u) => u.id),
        topic: 'approval.requested',
        severity: 'warning',
        title: `Approval needed: ${req.title}`,
        body: `${req.amount != null ? `Amount ${Number(req.amount).toLocaleString('en-US')}. ` : ''}${req.requiredApprovals === 2 ? 'Two approvers are required.' : ''}`.trim() || 'Open the approvals inbox to decide.',
        data: { approvalId: req.id, link: '/approvals' },
        dedupeKey: `approval:${req.id}`,
      })
      .catch((e: Error) => this.logger.warn(e.message));
  }

  /** Cancel any pending request for an entity (e.g. the record was deleted or withdrawn). */
  async cancelFor(tx: Tx, kind: ApprovalKind, entityId: string) {
    await tx.approvalRequest.updateMany({ where: { kind, entityId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  }

  /** Latest request for an entity, if any. */
  latestFor(tx: Tx, kind: ApprovalKind, entityId: string) {
    return tx.approvalRequest.findFirst({ where: { kind, entityId }, orderBy: { createdAt: 'desc' } });
  }

  async decide(user: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
    if (decision === 'REJECTED' && !note?.trim()) throw new BadRequestException('Give a reason for rejecting');
    const res = await this.db.tenant(user.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const req = await tx.approvalRequest.findFirst({ where: { id }, include });
      if (!req) throw new NotFoundException('Approval request not found');
      const block = decisionBlock(req, req.decisions, user.userId);
      if (block) throw (block.includes('own') ? new ForbiddenException(block) : new BadRequestException(block));
      await tx.approvalDecision.create({ data: { companyId: user.companyId, requestId: id, approverId: user.userId, decision, note: note?.trim() || null } });
      const approvals = req.decisions.filter((d) => d.decision === 'APPROVED').length + (decision === 'APPROVED' ? 1 : 0);
      const final: Outcome | null = decision === 'REJECTED' ? 'REJECTED' : approvals >= req.requiredApprovals ? 'APPROVED' : null;
      if (final) {
        const handler = this.handlers.get(req.kind);
        if (!handler) throw new Error(`No approval handler registered for ${req.kind}`);
        await handler(tx, req.entityId, final, { note: note?.trim() || null, userId: user.userId });
      }
      const updated = await tx.approvalRequest.update({
        where: { id },
        data: final ? { status: final, decidedAt: new Date() } : {},
        include,
      });
      if (final) await this.webhooks.emit(tx, user.companyId, final === 'APPROVED' ? WebhookEvent.APPROVAL_APPROVED : WebhookEvent.APPROVAL_REJECTED, this.payload(updated));
      return updated;
    });
    if (res.status !== 'PENDING' && res.requestedBy) {
      await this.notifications
        .notify({
          companyId: user.companyId,
          userIds: [res.requestedBy],
          topic: `approval.${res.status.toLowerCase()}`,
          severity: res.status === 'APPROVED' ? 'info' : 'warning',
          title: `${res.status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${res.title}`,
          body: res.decisions.at(-1)?.note ?? '',
          data: { approvalId: res.id, link: LINKS[res.kind](res.entityId) },
          dedupeKey: `approval-decided:${res.id}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    } else if (res.status === 'PENDING') {
      // First of two approvals: remind the other approvers.
      await this.announce(res);
    }
    return res;
  }

  /** Inbox: `pending` = waiting for me; `mine` = what I asked for; `all` = everything (deciders). */
  list(user: AuthUser, q: { scope: 'pending' | 'mine' | 'all'; kind?: string; status?: string; take: number }) {
    const where: Prisma.ApprovalRequestWhereInput =
      q.scope === 'mine'
        ? { requestedBy: user.userId }
        : q.scope === 'pending'
          ? { status: 'PENDING', OR: [{ requestedBy: null }, { requestedBy: { not: user.userId } }], decisions: { none: { approverId: user.userId } } }
          : {};
    return this.db.tenant(user.companyId, (tx) =>
      tx.approvalRequest.findMany({
        where: { ...where, ...(q.kind && { kind: q.kind as never }), ...(q.status && { status: q.status as never }) },
        include,
        orderBy: { createdAt: 'desc' },
        take: q.take,
      }),
    );
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = await tx.approvalRequest.findFirst({ where: { id }, include });
      if (!r) throw new NotFoundException('Approval request not found');
      if (r.requestedBy !== user.userId && !user.permissions.includes('approval:decide')) throw new NotFoundException('Approval request not found');
      return { ...r, details: await this.details(tx, r.kind, r.entityId) };
    });
  }

  /** Key facts and attached photos of the record behind a request (mobile approvals). */
  private async details(tx: Tx, kind: ApprovalKind, entityId: string): Promise<{ facts: [string, string][]; fileIds: string[] }> {
    const d = (x: Date | null | undefined) => (x ? x.toISOString() : '');
    const num = (x: unknown) => (x == null ? '' : Number(x).toLocaleString('en-US'));
    switch (kind) {
      case 'EXPENSE': {
        const e = await tx.vehicleExpense.findFirst({ where: { id: entityId }, include: { vehicle: { select: { plateNumber: true } } } });
        if (!e) break;
        return { facts: [['Vehicle', e.vehicle.plateNumber], ['Category', e.category], ['Date', d(e.incurredAt)], ['Amount', num(e.amount)], ['Description', e.description ?? '']], fileIds: e.receiptFileId ? [e.receiptFileId] : [] };
      }
      case 'FUEL': {
        const f = await tx.fuelRecord.findFirst({ where: { id: entityId }, include: { vehicle: { select: { plateNumber: true } } } });
        if (!f) break;
        return {
          facts: [['Vehicle', f.vehicle.plateNumber], ['Filled', d(f.filledAt)], ['Litres', num(f.litres)], ['Total', num(f.totalCost)], ['Odometer', `${num(f.odometerKm)} km`], ['Station', f.station ?? ''], ['Checks', f.flags.join(', ')]],
          fileIds: f.receiptFileId ? [f.receiptFileId] : [],
        };
      }
      case 'WORK_ORDER': {
        const w = await tx.workOrder.findFirst({ where: { id: entityId }, include: { vehicle: { select: { plateNumber: true } }, lines: true } });
        if (!w) break;
        return { facts: [['Vehicle', w.vehicle.plateNumber], ['Work order', `${w.woNo} · ${w.title}`], ['Estimate', num(w.estimatedCost)], ...w.lines.map((l) => [l.description, num(l.total)] as [string, string])], fileIds: [] };
      }
      case 'CLAIM': {
        const c = await tx.insuranceClaim.findFirst({ where: { id: entityId }, include: { incident: { select: { description: true, photoFileIds: true, occurredAt: true } } } });
        if (!c) break;
        return { facts: [['Claim', c.claimNo], ['Claimed', num(c.amountClaimed)], ['Incident', d(c.incident.occurredAt)], ['What happened', c.incident.description]], fileIds: c.incident.photoFileIds };
      }
      case 'VEHICLE_REQUEST': {
        const v = await tx.vehicleRequest.findFirst({ where: { id: entityId } });
        if (!v) break;
        return { facts: [['Request', v.requestNo], ['Purpose', v.purpose], ['From', v.originName], ['To', v.destinationName], ['Start', d(v.plannedStart)], ['End', d(v.plannedEnd)]], fileIds: [] };
      }
    }
    return { facts: [], fileIds: [] };
  }

  private payload(r: Prisma.ApprovalRequestGetPayload<{ include: typeof include }>) {
    return {
      id: r.id,
      kind: r.kind,
      entityId: r.entityId,
      title: r.title,
      amount: r.amount,
      status: r.status,
      requiredApprovals: r.requiredApprovals,
      requestedBy: r.requestedBy,
      decisions: r.decisions.map((d) => ({ approverId: d.approverId, decision: d.decision, note: d.note, at: d.createdAt })),
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    };
  }
}
