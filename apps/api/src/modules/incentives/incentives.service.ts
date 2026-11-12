import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateAdjustmentInput, Role, UpdateAdjustmentInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { localDate } from '../../common/time';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyService } from '../safety/safety.service';
import { periodBounds, previousPeriod, safetyBonuses, summarize } from './rules';

const include = { driver: { select: { id: true, fullName: true, employeeNo: true } } } satisfies Prisma.DriverAdjustmentInclude;

export interface AdjustmentQuery {
  period?: string;
  driverId?: string;
  status?: string;
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Injectable()
export class IncentivesService {
  private readonly logger = new Logger(IncentivesService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly safety: SafetyService,
  ) {}

  list(user: AuthUser, q: AdjustmentQuery) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.driverAdjustment.findMany({
        where: { ...(q.period && { period: q.period }), ...(q.driverId && { driverId: q.driverId }), ...(q.status && { status: q.status as never }) },
        include,
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
    );
  }

  create(user: AuthUser, input: CreateAdjustmentInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.assertRefs(tx, input.driverId, input.incidentId);
      return tx.driverAdjustment.create({ data: { ...input, companyId: user.companyId, proposedBy: user.userId }, include });
    });
  }

  update(user: AuthUser, id: string, input: UpdateAdjustmentInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const a = await this.find(tx, id);
      if (a.status !== 'PROPOSED') throw new BadRequestException('Only proposed items can be edited');
      await this.assertRefs(tx, null, input.incidentId);
      return tx.driverAdjustment.update({ where: { id }, data: input, include });
    });
  }

  async decide(user: AuthUser, id: string, status: 'APPROVED' | 'REJECTED', note?: string | null) {
    const res = await this.db.tenant(user.companyId, async (tx) => {
      const a = await this.find(tx, id);
      if (a.status !== 'PROPOSED') throw new BadRequestException(`Already ${a.status.toLowerCase()}`);
      if (a.proposedBy === user.userId) throw new ForbiddenException('You cannot decide on your own proposal');
      if (status === 'REJECTED' && !note?.trim()) throw new BadRequestException('Give a reason for rejecting');
      return tx.driverAdjustment.update({
        where: { id },
        data: { status, decidedBy: user.userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
        include: { driver: { select: { id: true, fullName: true, employeeNo: true, userId: true } } },
      });
    });
    if (status === 'APPROVED' && res.driver.userId) {
      await this.notifications
        .notify({
          companyId: user.companyId,
          userIds: [res.driver.userId],
          topic: 'driver.adjustment',
          severity: 'info',
          title: `${res.kind === 'INCENTIVE' ? 'Incentive' : 'Deduction'} for ${res.period}: ${Number(res.amount).toLocaleString('en-US')}`,
          body: res.reason,
          data: { adjustmentId: res.id },
          dedupeKey: `adj:${res.id}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    }
    const { driver, ...rest } = res;
    return { ...rest, driver: { id: driver.id, fullName: driver.fullName, employeeNo: driver.employeeNo } };
  }

  /** Per-driver approved totals for a payroll month. */
  summary(user: AuthUser, period: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [rows, drivers, company] = await Promise.all([
        tx.driverAdjustment.findMany({ where: { period }, select: { driverId: true, kind: true, amount: true, status: true } }),
        tx.driver.findMany({ select: { id: true, fullName: true, employeeNo: true } }),
        tx.company.findFirstOrThrow({ select: { currency: true } }),
      ]);
      const sums = summarize(rows.map((r) => ({ ...r, amount: Number(r.amount) })));
      const lines = drivers
        .filter((d) => sums.has(d.id))
        .map((d) => ({ ...d, ...sums.get(d.id)! }))
        .sort((a, b) => b.net - a.net);
      return {
        period,
        currency: company.currency,
        drivers: lines,
        totals: {
          incentives: lines.reduce((s, l) => s + l.incentives, 0),
          penalties: lines.reduce((s, l) => s + l.penalties, 0),
          net: lines.reduce((s, l) => s + l.net, 0),
          pending: lines.reduce((s, l) => s + l.pending, 0),
        },
      };
    });
  }

  async csv(user: AuthUser, period: string): Promise<string> {
    const s = await this.summary(user, period);
    const head = ['period', 'employee_no', 'driver', 'incentives', 'penalties', 'net', 'pending_items', 'currency'];
    const body = s.drivers.map((d) => [period, d.employeeNo, d.fullName, d.incentives, d.penalties, d.net, d.pending, s.currency].map(csvCell).join(','));
    return [head.join(','), ...body].join('\n') + '\n';
  }

  /** Driver app: own items (all statuses) for the last 6 months. */
  mine(user: AuthUser, driverId: string) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.driverAdjustment.findMany({
        where: { driverId, status: { in: ['APPROVED', 'PROPOSED'] } },
        select: { id: true, kind: true, category: true, period: true, amount: true, reason: true, status: true },
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
    );
  }

  /** Monthly job: propose safety bonuses for last month. Idempotent via dedupe keys. */
  async proposeMonthly(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, timezone: true, settings: true } }));
    let created = 0;
    for (const c of companies) {
      const s = parseCompanySettings(c.settings).incentives;
      if (!s.safetyBonusEnabled) continue;
      const p = previousPeriod(localDate(now, c.timezone));
      created += await this.proposeSafetyBonuses(c.id, p.period);
    }
    this.logger.log(`Monthly incentive proposals: ${created}`);
    return created;
  }

  async proposeSafetyBonuses(companyId: string, period: string): Promise<number> {
    const company = await this.db.system((tx) => tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }));
    const s = parseCompanySettings(company.settings).incentives;
    const scores = await this.safety.scoresFor(companyId, periodBounds(period));
    const bonuses = safetyBonuses(scores.drivers, s);
    if (!bonuses.length) return 0;
    const res = await this.db.tenant(companyId, (tx) =>
      tx.driverAdjustment.createMany({
        data: bonuses.map((b) => ({
          companyId,
          driverId: b.driverId,
          kind: 'INCENTIVE' as const,
          category: 'SAFETY_BONUS',
          period,
          amount: b.amount,
          reason: b.reason,
          source: 'auto:safety-bonus',
          dedupeKey: `safety-bonus:${period}:${b.driverId}`,
        })),
        skipDuplicates: true,
      }),
    );
    if (res.count) {
      await this.notifications
        .notify({
          companyId,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
          topic: 'incentive.proposed',
          severity: 'info',
          title: `${res.count} safety bonus proposal(s) for ${period}`,
          body: `Review and approve them before payroll.`,
          data: { link: `/incentives?period=${period}` },
          dedupeKey: `safety-bonus:${period}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    }
    return res.count;
  }

  private async find(tx: Tx, id: string) {
    const a = await tx.driverAdjustment.findFirst({ where: { id } });
    if (!a) throw new NotFoundException('Item not found');
    return a;
  }

  private async assertRefs(tx: Tx, driverId?: string | null, incidentId?: string | null) {
    if (driverId && !(await tx.driver.findFirst({ where: { id: driverId }, select: { id: true } }))) throw new BadRequestException('Driver not found');
    if (incidentId && !(await tx.incident.findFirst({ where: { id: incidentId }, select: { id: true } }))) throw new BadRequestException('Incident not found');
  }
}
