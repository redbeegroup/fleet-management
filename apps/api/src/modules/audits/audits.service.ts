import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditQuestion, AuditTemplateInput, CreateAuditInput, Permission, Role, UpdateCorrectiveActionInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { localDate } from '../../common/time';
import { nextNumber } from '../../common/vehicle-status';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_AUDITS, scoreAudit } from './scoring';

/** Safety audits of branches / sites and vehicles, with corrective actions. */
@Injectable()
export class AuditsService {
  private readonly log = new Logger('SafetyAudits');

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ templates

  templates(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      let rows = await tx.auditTemplate.findMany({ orderBy: [{ target: 'asc' }, { name: 'asc' }] });
      if (!rows.length) {
        await tx.auditTemplate.createMany({ data: DEFAULT_AUDITS.map((t) => ({ companyId: user.companyId, name: t.name, target: t.target, questions: t.questions as unknown as Prisma.InputJsonValue })) });
        rows = await tx.auditTemplate.findMany({ orderBy: [{ target: 'asc' }, { name: 'asc' }] });
      }
      return rows;
    });
  }

  createTemplate(user: AuthUser, body: AuditTemplateInput) {
    return this.db.tenant(user.companyId, (tx) => tx.auditTemplate.create({ data: { ...body, questions: body.questions as unknown as Prisma.InputJsonValue, companyId: user.companyId } }));
  }

  updateTemplate(user: AuthUser, id: string, body: Partial<AuditTemplateInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.auditTemplate.findFirst({ where: { id } }))) throw new NotFoundException('Template not found');
      return tx.auditTemplate.update({ where: { id }, data: { ...body, ...(body.questions && { questions: body.questions as unknown as Prisma.InputJsonValue }) } });
    });
  }

  // ------------------------------------------------------------ audits

  list(user: AuthUser, q: { target?: string; branchId?: string; vehicleId?: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rows = await tx.safetyAudit.findMany({
        where: { ...(q.target && { target: q.target }), ...(q.branchId && { branchId: q.branchId }), ...(q.vehicleId && { vehicleId: q.vehicleId }) },
        include: { actions: { select: { id: true, status: true, dueDate: true } } },
        orderBy: { performedAt: 'desc' },
        take: 200,
      });
      return this.decorate(tx, rows);
    });
  }

  private async decorate<T extends { templateId: string; branchId: string | null; vehicleId: string | null }>(tx: Tx, rows: T[]) {
    const [templates, branches, vehicles] = await Promise.all([
      tx.auditTemplate.findMany({ where: { id: { in: rows.map((r) => r.templateId) } }, select: { id: true, name: true } }),
      tx.branch.findMany({ where: { id: { in: rows.map((r) => r.branchId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      tx.vehicle.findMany({ where: { id: { in: rows.map((r) => r.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, plateNumber: true } }),
    ]);
    const t = new Map(templates.map((x) => [x.id, x.name]));
    const b = new Map(branches.map((x) => [x.id, x.name]));
    const v = new Map(vehicles.map((x) => [x.id, x.plateNumber]));
    return rows.map((r) => ({ ...r, templateName: t.get(r.templateId) ?? null, subject: r.branchId ? (b.get(r.branchId) ?? null) : r.vehicleId ? (v.get(r.vehicleId) ?? null) : null }));
  }

  get(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const a = await tx.safetyAudit.findFirst({ where: { id }, include: { actions: { orderBy: { dueDate: 'asc' } } } });
      if (!a) throw new NotFoundException('Audit not found');
      return (await this.decorate(tx, [a]))[0];
    });
  }

  async create(user: AuthUser, body: CreateAuditInput) {
    const owners: string[] = [];
    const audit = await this.db.tenant(user.companyId, async (tx) => {
      const tpl = await tx.auditTemplate.findFirst({ where: { id: body.templateId, active: true } });
      if (!tpl) throw new BadRequestException('Audit template not found');
      if (tpl.target === 'BRANCH' && !body.branchId) throw new BadRequestException('This audit is for a branch / site');
      if (tpl.target === 'VEHICLE' && !body.vehicleId) throw new BadRequestException('This audit is for a vehicle');
      if (body.branchId && !(await tx.branch.findFirst({ where: { id: body.branchId } }))) throw new BadRequestException('Branch not found');
      const vehicle = body.vehicleId ? await tx.vehicle.findFirst({ where: { id: body.vehicleId, deletedAt: null } }) : null;
      if (body.vehicleId && !vehicle) throw new BadRequestException('Vehicle not found');
      const s = scoreAudit(tpl.questions as unknown as AuditQuestion[], body.answers, tpl.passMark);
      if ('errors' in s && s.errors) throw new BadRequestException({ message: 'Incomplete audit', errors: s.errors.map((m) => ({ path: 'answers', message: m })) });
      for (const a of body.actions) {
        if (a.ownerUserId && !(await tx.user.findFirst({ where: { id: a.ownerUserId, active: true } }))) throw new BadRequestException('Action owner not found');
      }
      const performedAt = body.performedAt ?? new Date();
      const year = performedAt.getUTCFullYear();
      const auditNo = `AUD-${year}-${String(await nextNumber(tx, user.companyId, `aud:${year}`)).padStart(5, '0')}`;
      const created = await tx.safetyAudit.create({
        data: {
          companyId: user.companyId, auditNo, templateId: tpl.id, target: tpl.target, branchId: body.branchId ?? null, vehicleId: body.vehicleId ?? null, performedAt,
          auditorId: user.userId, auditorName: body.auditorName ?? null, answers: s.items as unknown as Prisma.InputJsonValue, score: s.score, result: s.result, notes: body.notes ?? null,
        },
      });
      if (body.actions.length) {
        await tx.correctiveAction.createMany({ data: body.actions.map((a) => ({ companyId: user.companyId, auditId: created.id, questionKey: a.questionKey ?? null, description: a.description, ownerUserId: a.ownerUserId ?? null, dueDate: a.dueDate })) });
        owners.push(...body.actions.map((a) => a.ownerUserId).filter((x): x is string => !!x));
      }
      // A failed critical item on a vehicle goes to the workshop like an inspection defect.
      if (vehicle && s.result === 'FAIL') {
        await tx.repairRequest.create({
          data: {
            companyId: user.companyId, vehicleId: vehicle.id, reportedBy: user.userId, severity: 'HIGH',
            description: `${auditNo} (${tpl.name}) failed:\n${s.findings.map((f) => `• ${f.label}${f.critical ? ' [critical]' : ''}${f.note ? `: ${f.note}` : ''}`).join('\n')}`,
          },
        });
      }
      return created;
    });
    for (const u of [...new Set(owners)]) {
      await this.notifications.notify({
        companyId: user.companyId, userIds: [u], topic: 'audits.action', severity: 'info',
        title: `Corrective action from safety audit ${audit.auditNo}`, body: 'You have been made responsible for a corrective action. Open it to see the due date.',
        data: { auditId: audit.id, link: `/audits/${audit.id}` }, dedupeKey: `audit-action:${audit.id}:${u}`,
      });
    }
    return this.get(user, audit.id);
  }

  addAction(user: AuthUser, auditId: string, body: { description: string; ownerUserId?: string | null; dueDate: Date; questionKey?: string | null }) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.safetyAudit.findFirst({ where: { id: auditId } }))) throw new NotFoundException('Audit not found');
      if (body.ownerUserId && !(await tx.user.findFirst({ where: { id: body.ownerUserId, active: true } }))) throw new BadRequestException('Action owner not found');
      return tx.correctiveAction.create({ data: { companyId: user.companyId, auditId, description: body.description, ownerUserId: body.ownerUserId ?? null, dueDate: body.dueDate, questionKey: body.questionKey ?? null } });
    });
  }

  // ------------------------------------------------------------ corrective actions

  actions(user: AuthUser, q: { status?: string; mine?: boolean; overdue?: boolean }) {
    const canAll = user.permissions.includes(Permission.AUDIT_SAFETY_READ);
    if (!canAll && !q.mine) throw new ForbiddenException('You can see your own actions only');
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const today = localDate(new Date(), company.timezone);
      const rows = await tx.correctiveAction.findMany({
        where: {
          ...(q.status && { status: q.status }),
          ...(q.mine && { ownerUserId: user.userId }),
          ...(q.overdue && { status: 'OPEN', dueDate: { lt: new Date(today) } }),
        },
        include: { audit: { select: { auditNo: true, branchId: true, vehicleId: true, templateId: true } } },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        take: 300,
      });
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.map((r) => ({ ...r, ownerName: r.ownerUserId ? (users.get(r.ownerUserId) ?? null) : null, overdue: r.status === 'OPEN' && r.dueDate.toISOString().slice(0, 10) < today }));
    });
  }

  updateAction(user: AuthUser, id: string, body: UpdateCorrectiveActionInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const a = await tx.correctiveAction.findFirst({ where: { id } });
      if (!a) throw new NotFoundException('Action not found');
      const manager = user.permissions.includes(Permission.AUDIT_SAFETY_WRITE);
      const owner = a.ownerUserId === user.userId;
      if (body.action === 'DONE') {
        if (!manager && !owner) throw new ForbiddenException('Only the owner or a safety manager can close this action');
        if (a.status !== 'OPEN') throw new BadRequestException('The action is not open');
        if (!body.closureNote?.trim() && !body.evidenceFileId) throw new BadRequestException('Describe what was done or add evidence');
        return tx.correctiveAction.update({ where: { id }, data: { status: 'DONE', closedAt: new Date(), closureNote: body.closureNote ?? null, evidenceFileId: body.evidenceFileId ?? null } });
      }
      if (!manager) throw new ForbiddenException('Safety managers verify, reopen and edit actions');
      if (body.action === 'VERIFY') {
        if (a.status !== 'DONE') throw new BadRequestException('Only done actions can be verified');
        if (owner) throw new ForbiddenException('Someone other than the owner verifies the action');
        return tx.correctiveAction.update({ where: { id }, data: { status: 'VERIFIED', verifiedBy: user.userId, verifiedAt: new Date() } });
      }
      if (body.action === 'REOPEN') return tx.correctiveAction.update({ where: { id }, data: { status: 'OPEN', closedAt: null, verifiedAt: null, verifiedBy: null, alertedAt: null } });
      return tx.correctiveAction.update({ where: { id }, data: { ...(body.ownerUserId !== undefined && { ownerUserId: body.ownerUserId }), ...(body.dueDate && { dueDate: body.dueDate, alertedAt: null }) } });
    });
  }

  /** Average score per branch and month (last 12 months), and open / overdue actions per branch. */
  trend(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const since = new Date(Date.now() - 365 * 86_400_000);
      const [audits, branches, actions, company] = await Promise.all([
        tx.safetyAudit.findMany({ where: { performedAt: { gte: since } }, select: { branchId: true, vehicleId: true, performedAt: true, score: true, result: true } }),
        tx.branch.findMany({ select: { id: true, name: true } }),
        tx.correctiveAction.findMany({ where: { status: 'OPEN' }, select: { dueDate: true, audit: { select: { branchId: true, vehicleId: true } } } }),
        tx.company.findFirstOrThrow({ select: { timezone: true } }),
      ]);
      const today = localDate(new Date(), company.timezone);
      const vehicleBranch = new Map((await tx.vehicle.findMany({ select: { id: true, branchId: true } })).map((v) => [v.id, v.branchId]));
      const branchOf = (a: { branchId: string | null; vehicleId: string | null }) => a.branchId ?? (a.vehicleId ? (vehicleBranch.get(a.vehicleId) ?? null) : null);
      return branches.map((b) => {
        const mine = audits.filter((a) => branchOf(a) === b.id);
        const months = new Map<string, number[]>();
        for (const a of mine) {
          const m = localDate(a.performedAt, company.timezone).slice(0, 7);
          months.set(m, [...(months.get(m) ?? []), Number(a.score)]);
        }
        const open = actions.filter((x) => branchOf(x.audit) === b.id);
        return {
          branchId: b.id,
          branchName: b.name,
          audits: mine.length,
          averageScore: mine.length ? Math.round((mine.reduce((s, a) => s + Number(a.score), 0) / mine.length) * 10) / 10 : null,
          failed: mine.filter((a) => a.result === 'FAIL').length,
          openActions: open.length,
          overdueActions: open.filter((x) => x.dueDate.toISOString().slice(0, 10) < today).length,
          months: [...months.entries()].sort().map(([month, scores]) => ({ month, averageScore: Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10, audits: scores.length })),
        };
      });
    });
  }

  /** Daily: overdue corrective actions (once per action until the due date changes). */
  async overdueAlerts(now = new Date()): Promise<number> {
    const rows = await this.db.system((tx) => tx.correctiveAction.findMany({ where: { status: 'OPEN', alertedAt: null, dueDate: { lt: now } }, include: { audit: { select: { auditNo: true } } } }));
    let sent = 0;
    for (const a of rows) {
      sent += await this.notifications.notify({
        companyId: a.companyId,
        ...(a.ownerUserId ? { userIds: [a.ownerUserId] } : { roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN] }),
        topic: 'audits.overdue',
        severity: 'warning',
        title: `Corrective action overdue (${a.audit.auditNo})`,
        body: `${a.description}\nDue ${a.dueDate.toISOString().slice(0, 10)}.`,
        data: { auditId: a.auditId, link: `/audits/${a.auditId}` },
        dedupeKey: `audit-overdue:${a.id}:${a.dueDate.toISOString().slice(0, 10)}`,
      });
      await this.db.system((tx) => tx.correctiveAction.update({ where: { id: a.id }, data: { alertedAt: now } }));
    }
    this.log.log(`Overdue corrective actions: ${sent}`);
    return sent;
  }
}
