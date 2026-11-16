import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Permission, permissionsForRoles, ReportKind, ReportSubscriptionInput, Role } from '@fms/shared';
import nodemailer, { Transporter } from 'nodemailer';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService } from '../../common/db/prisma.service';
import { dayBounds, localDate } from '../../common/time';
import { AnalyticsService } from '../analytics/analytics.service';
import { CostsService } from '../costs/costs.service';
import { DeliveryKpiService } from '../logistics/delivery-kpi.service';
import { SiteVisitsService } from '../logistics/site-visits.service';
import { SafetyService } from '../safety/safety.service';
import { BudgetLine, buildBudget, buildDelivery, buildFleet, buildSafety, ComplianceInput, Ctx } from './builders';
import { csvText, ReportModel } from './model';
import { dueNow, Frequency, lastPeriod, localClock, Period } from './period';
import { renderHtml, renderPdf, renderText } from './render';

/** Permission a recipient needs to receive (or preview) each report. */
export const REPORT_PERMISSION: Record<ReportKind, Permission> = {
  FLEET: Permission.COST_READ,
  BUDGET: Permission.BUDGET_READ,
  DELIVERY: Permission.LOGISTICS_READ,
  SAFETY: Permission.SAFETY_READ,
};
export const REPORT_TITLE: Record<ReportKind, string> = {
  FLEET: 'Fleet overview',
  BUDGET: 'Budget vs actual & TCO',
  DELIVERY: 'Delivery performance',
  SAFETY: 'Safety & compliance',
};
const MAX_ATTEMPTS = 5;

export interface ReportMail {
  to: string;
  subject: string;
  html: string;
  attachments: { filename: string; size: number }[];
}

/** Sends report e-mails; keeps the last ones in memory outside production (tests, local). */
@Injectable()
export class ReportMailer {
  private transport: Transporter | null = null;
  readonly recent: ReportMail[] = [];

  get configured() {
    return !!env().SMTP_URL;
  }

  async send(to: string[], subject: string, html: string, text: string, attachments: { filename: string; content: Buffer | string; contentType: string }[]) {
    if (env().NODE_ENV !== 'production') {
      for (const t of to) this.recent.push({ to: t, subject, html, attachments: attachments.map((a) => ({ filename: a.filename, size: Buffer.byteLength(a.content) })) });
      while (this.recent.length > 50) this.recent.shift();
    }
    if (!env().SMTP_URL) return;
    this.transport ??= nodemailer.createTransport(env().SMTP_URL);
    // One message per recipient so addresses are not disclosed to each other.
    for (const t of to) await this.transport.sendMail({ from: env().MAIL_FROM, to: t, subject, html, text, attachments });
  }
}

/** Scheduled management reports by e-mail: subscriptions, preview, send now and the hourly dispatcher. */
@Injectable()
export class ReportsService {
  private readonly log = new Logger('Reports');

  constructor(
    private readonly db: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly costs: CostsService,
    private readonly delivery: DeliveryKpiService,
    private readonly visits: SiteVisitsService,
    private readonly safety: SafetyService,
    private readonly mailer: ReportMailer,
  ) {}

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  /** Builds a report for a company and period, as the company (all data of the scope). */
  async build(companyId: string, report: ReportKind, period: Period, branchId: string | null): Promise<ReportModel> {
    const company = await this.db.system((tx) => tx.company.findUniqueOrThrow({ where: { id: companyId } }));
    const branch = branchId ? await this.db.tenant(companyId, (tx) => tx.branch.findFirst({ where: { id: branchId }, select: { name: true } })) : null;
    if (branchId && !branch) throw new BadRequestException('Branch not found');
    // Internal identity: reports are built with the company's full read access, then sent only
    // to recipients who hold the report's permission.
    const actor: AuthUser = { userId: '00000000-0000-0000-0000-000000000000', companyId, email: 'reports@fms', roles: [Role.COMPANY_ADMIN], permissions: permissionsForRoles([Role.COMPANY_ADMIN]) };
    const ctx: Ctx = { company: company.name, currency: company.currency, scope: branch ? `Branch ${branch.name}` : 'All branches', periodLabel: period.label };
    const range = { from: period.from, to: period.to, ...(branchId ? { branchId } : {}) };
    const prevRange = { from: period.prev.from, to: period.prev.to, ...(branchId ? { branchId } : {}) };

    if (report === 'FLEET') {
      const [cur, prev] = await Promise.all([this.analytics.overview(actor, range), this.analytics.overview(actor, prevRange)]);
      return buildFleet(ctx, cur as never, prev as never);
    }
    if (report === 'BUDGET') {
      const month = period.to.slice(0, 7);
      const year = Number(month.slice(0, 4));
      const idx = Number(month.slice(5, 7)) - 1;
      const dims = branchId ? (['branch'] as const) : (['company', 'branch', 'department'] as const);
      const grids = await Promise.all(dims.map((d) => this.costs.budgets(actor, year, d)));
      const lines: BudgetLine[] = [];
      for (const g of grids) {
        for (const s of g.scopes) {
          if (branchId && s.id !== branchId) continue;
          for (const l of s.lines) {
            const m = l.months[idx];
            if (m.budget || m.actual) lines.push({ scope: s.name, category: l.category, budget: m.budget, actual: m.actual, usedPct: m.usedPct, forecast: m.forecast, status: m.status });
          }
        }
      }
      const tco = await this.costs.tco(actor, range);
      return buildBudget({ ...ctx, month }, lines, tco as never);
    }
    if (report === 'DELIVERY') {
      const [cur, prev, dwell, pod] = await Promise.all([
        this.delivery.overview(actor, range),
        this.delivery.overview(actor, prevRange),
        this.visits.report(actor, { from: period.from, to: period.to }),
        this.podExceptions(companyId, company.timezone, period, branchId),
      ]);
      return buildDelivery(ctx, cur as never, prev as never, dwell as never, pod);
    }
    const [cur, prev, compliance] = await Promise.all([
      this.safety.scoresFor(companyId, { from: period.from, to: period.to }),
      this.safety.scoresFor(companyId, { from: period.prev.from, to: period.prev.to }),
      this.compliance(companyId, company.timezone, period, branchId),
    ]);
    return buildSafety({ ...ctx, scope: branch ? `${ctx.scope} (driver scores: all branches)` : ctx.scope }, cur as never, prev as never, compliance);
  }

  private podExceptions(companyId: string, tz: string, p: Period, branchId: string | null) {
    const start = dayBounds(p.from, tz).start;
    const end = dayBounds(p.to, tz).end;
    return this.db.tenant(companyId, (tx) =>
      tx.tripStop.count({ where: { completedAt: { gte: start, lt: end }, NOT: { podFlags: { isEmpty: true } }, ...(branchId ? { trip: { branchId } } : {}) } }),
    );
  }

  private compliance(companyId: string, tz: string, p: Period, branchId: string | null): Promise<ComplianceInput> {
    const start = dayBounds(p.from, tz).start;
    const end = dayBounds(p.to, tz).end;
    const today = localDate(new Date(), tz);
    const in30 = new Date(Date.parse(today) + 30 * 86_400_000);
    return this.db.tenant(companyId, async (tx) => {
      // Events reference vehicles by id only: filter a branch through its vehicle ids.
      const vehicle = branchId ? { vehicleId: { in: (await tx.vehicle.findMany({ where: { branchId }, select: { id: true } })).map((v) => v.id) } } : {};
      const [incidents, injuries, claims, claimed, paid, inspections, failed, alerts, docs, licences] = await Promise.all([
        tx.incident.count({ where: { occurredAt: { gte: start, lt: end }, ...vehicle } }),
        tx.incident.count({ where: { occurredAt: { gte: start, lt: end }, injuries: true, ...vehicle } }),
        tx.insuranceClaim.count({ where: { status: { notIn: ['REJECTED', 'SETTLED'] } } }),
        tx.insuranceClaim.aggregate({ where: { submittedAt: { gte: start, lt: end } }, _sum: { amountClaimed: true } }),
        tx.insuranceClaim.aggregate({ where: { settledAt: { gte: start, lt: end } }, _sum: { amountPaid: true } }),
        tx.inspection.count({ where: { performedAt: { gte: start, lt: end }, ...vehicle } }),
        tx.inspection.count({ where: { performedAt: { gte: start, lt: end }, result: 'FAIL', ...vehicle } }),
        tx.telemetryEvent.groupBy({ by: ['type'], where: { occurredAt: { gte: start, lt: end }, ...vehicle }, _count: { _all: true } }),
        tx.vehicleDocument.findMany({ where: { expiresAt: { gte: new Date(today), lte: in30 }, vehicle: { deletedAt: null, ...(branchId ? { branchId } : {}) } }, select: { type: true, number: true, expiresAt: true, vehicle: { select: { plateNumber: true } } }, orderBy: { expiresAt: 'asc' }, take: 100 }),
        tx.driverLicense.findMany({ where: { expiresAt: { gte: new Date(today), lte: in30 }, driver: { active: true, ...(branchId ? { branchId } : {}) } }, select: { number: true, licenseClass: true, expiresAt: true, driver: { select: { fullName: true } } }, orderBy: { expiresAt: 'asc' }, take: 100 }),
      ]);
      const days = (d: Date) => Math.round((d.getTime() - Date.parse(today)) / 86_400_000);
      return {
        incidents,
        injuries,
        claims: { open: claims, claimed: Number(claimed._sum.amountClaimed ?? 0), paid: Number(paid._sum.amountPaid ?? 0) },
        inspections: { total: inspections, failed },
        alertsByType: Object.fromEntries(alerts.map((a) => [a.type, a._count._all])),
        expiring: [
          ...docs.map((d) => ({ kind: 'Vehicle document', name: d.vehicle.plateNumber, item: `${String(d.type).toLowerCase().replace(/_/g, ' ')}${d.number ? ` ${d.number}` : ''}`, expiresAt: d.expiresAt!.toISOString().slice(0, 10), days: days(d.expiresAt!) })),
          ...licences.map((l) => ({ kind: 'Driving licence', name: l.driver.fullName, item: `${l.licenseClass ?? ''} ${l.number}`.trim(), expiresAt: l.expiresAt!.toISOString().slice(0, 10), days: days(l.expiresAt!) })),
        ].sort((a, b) => a.days - b.days),
      };
    });
  }

  private links() {
    const app = env().APP_URL.replace(/\/$/, '');
    return { app, manage: `${app}/report-subscriptions` };
  }

  // ---------------------------------------------------------------------------
  // Preview and sending
  // ---------------------------------------------------------------------------

  private assertCan(user: AuthUser, report: ReportKind) {
    if (!user.permissions.includes(REPORT_PERMISSION[report])) throw new ForbiddenException('You do not have access to this report');
  }

  async preview(user: AuthUser, q: { report: ReportKind; frequency: Frequency; branchId?: string | null; format: 'html' | 'pdf' }) {
    this.assertCan(user, q.report);
    const tz = await this.db.tenant(user.companyId, (tx) => tx.company.findFirstOrThrow({ select: { timezone: true } })).then((c) => c.timezone);
    const period = lastPeriod(q.frequency, localDate(new Date(), tz));
    const model = await this.build(user.companyId, q.report, period, q.branchId ?? null);
    return q.format === 'pdf' ? { pdf: await renderPdf(model), filename: this.filename(model, period) } : { html: renderHtml(model, this.links()) };
  }

  private filename(m: ReportModel, p: Period) {
    return `${m.report.toLowerCase()}-${p.key}.pdf`;
  }

  /** Active recipients of a subscription who may see the report, plus the extra addresses. */
  private async recipients(sub: { companyId: string; report: string; userIds: string[]; extraEmails: string[] }) {
    const perm = REPORT_PERMISSION[sub.report as ReportKind];
    const users = sub.userIds.length ? await this.db.tenant(sub.companyId, (tx) => tx.user.findMany({ where: { id: { in: sub.userIds }, active: true }, select: { email: true, roles: true } })) : [];
    const allowed = users.filter((u) => permissionsForRoles(u.roles).includes(perm)).map((u) => u.email);
    return [...new Set([...allowed, ...sub.extraEmails.map((e) => e.toLowerCase())])];
  }

  /** Builds and sends one subscription for one period; records the run (idempotent per period). */
  async sendSubscription(sub: { id: string; companyId: string; report: string; branchId: string | null; userIds: string[]; extraEmails: string[] }, period: Period, force = false) {
    const prior = await this.db.tenant(sub.companyId, (tx) => tx.reportRun.findUnique({ where: { subscriptionId_periodKey: { subscriptionId: sub.id, periodKey: period.key } } }));
    if (prior && !force && (prior.status !== 'FAILED' || prior.attempts >= MAX_ATTEMPTS)) return prior;
    const record = (status: 'SENT' | 'FAILED' | 'SKIPPED', recipients: number, error: string | null) =>
      this.db.tenant(sub.companyId, (tx) =>
        tx.reportRun.upsert({
          where: { subscriptionId_periodKey: { subscriptionId: sub.id, periodKey: period.key } },
          create: { companyId: sub.companyId, subscriptionId: sub.id, periodKey: period.key, status, recipients, error },
          update: { status, recipients, error, attempts: { increment: 1 } },
        }),
      );
    const to = await this.recipients(sub);
    if (!to.length) return record('SKIPPED', 0, 'No recipient may receive this report');
    try {
      const model = await this.build(sub.companyId, sub.report as ReportKind, period, sub.branchId);
      const [pdf, html] = [await renderPdf(model), renderHtml(model, this.links())];
      await this.mailer.send(to, `[FMS] ${model.title} · ${model.periodLabel}`, html, renderText(model), [
        { filename: this.filename(model, period), content: pdf, contentType: 'application/pdf' },
        ...model.csv.map((c) => ({ filename: c.name, content: csvText(c.table), contentType: 'text/csv' })),
      ]);
      if (!this.mailer.configured) return record('SKIPPED', to.length, 'Not sent: SMTP is not configured');
      return record('SENT', to.length, null);
    } catch (e) {
      this.log.warn(`Report ${sub.id} ${period.key} failed: ${(e as Error).message}`);
      return record('FAILED', to.length, (e as Error).message.slice(0, 500));
    }
  }

  /** Hourly job: sends every subscription whose last period is due (07:00 company time). */
  async dispatch(now = new Date()) {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, timezone: true } }));
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const c of companies) {
      const subs = await this.db.tenant(c.id, (tx) => tx.reportSubscription.findMany({ where: { enabled: true } }));
      const clock = localClock(now, c.timezone);
      for (const s of subs) {
        const period = dueNow(s.frequency as Frequency, clock, localDate(s.createdAt, c.timezone));
        if (!period) continue;
        const prior = await this.db.tenant(c.id, (tx) => tx.reportRun.findUnique({ where: { subscriptionId_periodKey: { subscriptionId: s.id, periodKey: period.key } } }));
        if (prior && (prior.status !== 'FAILED' || prior.attempts >= MAX_ATTEMPTS)) continue;
        const run = await this.sendSubscription(s, period);
        if (run.status === 'SENT') sent++;
        else if (run.status === 'SKIPPED') skipped++;
        else failed++;
      }
    }
    return { sent, skipped, failed };
  }

  /** Sends the last period now, to the subscription's recipients (re-sends if already sent). */
  async sendNow(user: AuthUser, id: string) {
    const sub = await this.db.tenant(user.companyId, (tx) => tx.reportSubscription.findUnique({ where: { id } }));
    if (!sub) throw new NotFoundException('Subscription not found');
    this.assertCan(user, sub.report as ReportKind);
    const tz = (await this.db.tenant(user.companyId, (tx) => tx.company.findFirstOrThrow({ select: { timezone: true } }))).timezone;
    return this.sendSubscription(sub, lastPeriod(sub.frequency as Frequency, localDate(new Date(), tz)), true);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  list(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const subs = await tx.reportSubscription.findMany({ orderBy: [{ report: 'asc' }, { frequency: 'asc' }] });
      const runs = await tx.reportRun.findMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } }, orderBy: { createdAt: 'desc' }, take: 500 });
      return {
        smtp: this.mailer.configured,
        subscriptions: subs
          .filter((s) => user.permissions.includes(REPORT_PERMISSION[s.report as ReportKind]))
          .map((s) => ({ ...s, title: REPORT_TITLE[s.report as ReportKind], runs: runs.filter((r) => r.subscriptionId === s.id).slice(0, 5) })),
      };
    });
  }

  private async validate(user: AuthUser, body: Partial<ReportSubscriptionInput>) {
    if (body.report) this.assertCan(user, body.report);
    await this.db.tenant(user.companyId, async (tx) => {
      if (body.branchId && !(await tx.branch.findFirst({ where: { id: body.branchId } }))) throw new BadRequestException('Branch not found');
      if (body.userIds?.length) {
        const found = await tx.user.count({ where: { id: { in: body.userIds } } });
        if (found !== new Set(body.userIds).size) throw new BadRequestException('Unknown recipient');
      }
    });
  }

  async create(user: AuthUser, body: ReportSubscriptionInput) {
    await this.validate(user, body);
    return this.db.tenant(user.companyId, async (tx) => {
      const s = await tx.reportSubscription.create({ data: { companyId: user.companyId, report: body.report, frequency: body.frequency, branchId: body.branchId ?? null, userIds: [...new Set(body.userIds)], extraEmails: [...new Set(body.extraEmails)], enabled: body.enabled, createdBy: user.userId } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'report.subscription.create', entity: 'report_subscription', entityId: s.id, payload: { report: s.report, frequency: s.frequency, recipients: s.userIds.length + s.extraEmails.length } } });
      return s;
    });
  }

  async update(user: AuthUser, id: string, body: Partial<ReportSubscriptionInput>) {
    const cur = await this.db.tenant(user.companyId, (tx) => tx.reportSubscription.findUnique({ where: { id } }));
    if (!cur) throw new NotFoundException('Subscription not found');
    this.assertCan(user, cur.report as ReportKind);
    await this.validate(user, body);
    return this.db.tenant(user.companyId, (tx) =>
      tx.reportSubscription.update({
        where: { id },
        data: {
          ...(body.report && { report: body.report }),
          ...(body.frequency && { frequency: body.frequency }),
          ...(body.branchId !== undefined && { branchId: body.branchId }),
          ...(body.userIds && { userIds: [...new Set(body.userIds)] }),
          ...(body.extraEmails && { extraEmails: [...new Set(body.extraEmails)] }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      }),
    );
  }

  async remove(user: AuthUser, id: string) {
    await this.db.tenant(user.companyId, async (tx) => {
      const cur = await tx.reportSubscription.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Subscription not found');
      await tx.reportRun.deleteMany({ where: { subscriptionId: id } });
      await tx.reportSubscription.delete({ where: { id } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'report.subscription.delete', entity: 'report_subscription', entityId: id, payload: { report: cur.report, frequency: cur.frequency } } });
    });
  }
}
