import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCompanyInput, InviteUserInput, Role, UpdateUserInput } from '@fms/shared';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AuthService } from './auth.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const INVITE_HOURS = 72;
const RESET_HOURS = 1;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const userSelect = { id: true, email: true, fullName: true, roles: true, branchId: true, active: true, lastLoginAt: true, invitedAt: true, passwordSetAt: true, createdAt: true } as const;

/**
 * Sends account e-mails. Without SMTP (local/test) the message is logged instead, and the last messages
 * are kept in memory outside production so tests and developers can follow the links.
 */
@Injectable()
export class AccountMailer {
  private readonly logger = new Logger(AccountMailer.name);
  private transport: Transporter | null = null;
  readonly recent: { to: string; subject: string; text: string }[] = [];

  async send(to: { email: string; fullName: string }, subject: string, text: string, link: string) {
    const e = env();
    if (e.NODE_ENV !== 'production') {
      this.recent.push({ to: to.email, subject, text });
      if (this.recent.length > 50) this.recent.shift();
    }
    if (!e.SMTP_URL) {
      this.logger.warn(`No SMTP configured; e-mail to ${to.email} not sent: ${subject}`);
      return;
    }
    this.transport ??= nodemailer.createTransport(e.SMTP_URL);
    await this.transport.sendMail({
      from: e.MAIL_FROM,
      to: `"${to.fullName.replace(/"/g, '')}" <${to.email}>`,
      subject: `[FMS] ${subject}`,
      text,
      html: `<p>${esc(text.split('\n\n')[0])}</p><p><a href="${esc(link)}">${esc(link)}</a></p><p style="color:#666">${esc(text.split('\n\n').slice(2).join(' '))}</p>`,
    });
  }
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly mailer: AccountMailer,
  ) {}

  // ---- tokens -------------------------------------------------------------------

  private async issue(tx: Tx, user: { id: string; companyId: string }, kind: 'INVITE' | 'RESET', createdBy: string | null) {
    // A new link replaces older unused ones of the same kind.
    await tx.authToken.updateMany({ where: { userId: user.id, kind, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomBytes(32).toString('base64url');
    await tx.authToken.create({ data: { companyId: user.companyId, userId: user.id, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + (kind === 'INVITE' ? INVITE_HOURS : RESET_HOURS) * 3_600_000), createdBy } });
    return token;
  }

  private link(token: string) {
    return `${env().APP_URL.replace(/\/$/, '')}/set-password?token=${token}`;
  }

  private async sendInvite(u: { email: string; fullName: string }, companyName: string, token: string) {
    const link = this.link(token);
    await this.mailer.send(u, `You are invited to ${companyName}`, `${u.fullName}, an account was created for you in the ${companyName} fleet management system. Choose your password here:\n\n${link}\n\nThe link is valid for ${INVITE_HOURS} hours.`, link);
  }

  // ---- users of the caller's company ----------------------------------------------

  async invite(actor: AuthUser, input: InviteUserInput) {
    this.assertRoles(actor, input.roles);
    const r = await this.db.tenant(actor.companyId, async (tx) => {
      if (input.branchId && !(await tx.branch.findFirst({ where: { id: input.branchId } }))) throw new BadRequestException('Unknown branch');
      if (await tx.user.findFirst({ where: { email: input.email } })) throw new BadRequestException('A user with this e-mail already exists');
      const company = await tx.company.findFirstOrThrow({ select: { name: true } });
      const u = await tx.user.create({
        data: { companyId: actor.companyId, email: input.email, fullName: input.fullName, roles: input.roles, branchId: input.branchId ?? null, passwordHash: await AuthService.hashPassword(randomBytes(32).toString('hex')), invitedAt: new Date() },
        select: userSelect,
      });
      return { u, token: await this.issue(tx, { id: u.id, companyId: actor.companyId }, 'INVITE', actor.userId), company: company.name };
    }).catch((e: { code?: string }) => {
      // The e-mail is unique across companies.
      if (e.code === 'P2002') throw new BadRequestException('A user with this e-mail already exists');
      throw e;
    });
    await this.sendInvite(r.u, r.company, r.token);
    return r.u;
  }

  async resendInvite(actor: AuthUser, id: string) {
    const r = await this.db.tenant(actor.companyId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id } });
      if (!u) throw new NotFoundException('User not found');
      if (u.passwordSetAt || !u.invitedAt) throw new BadRequestException('This user has already set a password; send a password reset instead');
      return { u, token: await this.issue(tx, u, 'INVITE', actor.userId), company: (await tx.company.findFirstOrThrow({ select: { name: true } })).name };
    });
    await this.sendInvite(r.u, r.company, r.token);
    return { sent: true };
  }

  /** An admin sends a reset link to one of their users. */
  async adminReset(actor: AuthUser, id: string) {
    const r = await this.db.tenant(actor.companyId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id, active: true } });
      if (!u) throw new NotFoundException('User not found');
      return { u, token: await this.issue(tx, u, 'RESET', actor.userId) };
    });
    await this.sendReset(r.u, r.token);
    return { sent: true };
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput) {
    if (input.roles) this.assertRoles(actor, input.roles);
    if (id === actor.userId && (input.active === false || input.roles)) throw new ForbiddenException('You cannot deactivate yourself or change your own roles');
    return this.db.tenant(actor.companyId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id } });
      if (!u) throw new NotFoundException('User not found');
      if (u.roles.includes(Role.SUPER_ADMIN) && !actor.roles.includes(Role.SUPER_ADMIN)) throw new ForbiddenException('Only a super admin can change a super admin');
      if (input.branchId && !(await tx.branch.findFirst({ where: { id: input.branchId } }))) throw new BadRequestException('Unknown branch');
      const next = await tx.user.update({ where: { id }, data: { fullName: input.fullName, roles: input.roles, branchId: input.branchId, active: input.active }, select: userSelect });
      // Deactivated users are signed out everywhere (refresh tokens); access tokens expire within minutes.
      if (input.active === false || (input.roles && input.roles.join() !== u.roles.join())) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (input.active === false) await tx.userDevice.deleteMany({ where: { userId: id } });
      return next;
    });
  }

  private assertRoles(actor: AuthUser, roles: string[]) {
    const known = new Set(Object.values(Role) as string[]);
    const bad = roles.filter((r) => !known.has(r));
    if (bad.length) throw new BadRequestException(`Unknown role: ${bad.join(', ')}`);
    if (roles.includes(Role.SUPER_ADMIN) && !actor.roles.includes(Role.SUPER_ADMIN)) throw new ForbiddenException('Only a super admin can grant SUPER_ADMIN');
  }

  // ---- self-service -------------------------------------------------------------

  private async sendReset(u: { email: string; fullName: string }, token: string) {
    const link = this.link(token);
    await this.mailer.send(u, 'Reset your password', `${u.fullName}, a password reset was requested for your fleet management account. Choose a new password here:\n\n${link}\n\nThe link is valid for ${RESET_HOURS} hour. If you did not ask for this, ignore this e-mail; your password stays the same.`, link);
  }

  /** Always answers the same way, whether the e-mail exists or not (no account enumeration). */
  async forgot(email: string): Promise<void> {
    const r = await this.db.system(async (tx) => {
      const u = await tx.user.findUnique({ where: { email }, include: { company: { select: { active: true } } } });
      if (!u || !u.active || !u.company.active) return null;
      // At most 3 reset e-mails per hour per account.
      const recent = await tx.authToken.count({ where: { userId: u.id, kind: 'RESET', createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (recent >= 3) return null;
      return { u, token: await this.issue(tx, u, 'RESET', null) };
    });
    if (r) await this.sendReset(r.u, r.token).catch((e: Error) => this.logger.error(`Reset e-mail failed: ${e.message}`));
  }

  /** What a link is for, so the page can greet the user (the token itself is the secret). */
  async tokenInfo(token: string) {
    const t = await this.db.system((tx) => tx.authToken.findUnique({ where: { tokenHash: sha256(token) } }));
    if (!t || t.usedAt || t.expiresAt < new Date()) throw new BadRequestException('This link is invalid or has expired. Ask for a new one.');
    const u = await this.db.system((tx) => tx.user.findUniqueOrThrow({ where: { id: t.userId }, select: { email: true, fullName: true } }));
    return { kind: t.kind, email: u.email, fullName: u.fullName };
  }

  async setPassword(token: string, password: string): Promise<void> {
    const passwordHash = await AuthService.hashPassword(password);
    await this.db.system(async (tx) => {
      const t = await tx.authToken.findUnique({ where: { tokenHash: sha256(token) } });
      // Single use, guarded against two concurrent submissions.
      const claimed = t && !t.usedAt && t.expiresAt > new Date() ? (await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } })).count : 0;
      if (!t || !claimed) throw new BadRequestException('This link is invalid or has expired. Ask for a new one.');
      const u = await tx.user.findUniqueOrThrow({ where: { id: t.userId }, include: { company: { select: { active: true } } } });
      if (!u.active || !u.company.active) throw new BadRequestException('This account is disabled.');
      await tx.user.update({ where: { id: u.id }, data: { passwordHash, passwordSetAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: new Date() } });
    });
  }

  // ---- group administration (super admin) ----------------------------------------

  async companies() {
    return this.db.system(async (tx) => {
      const rows = await tx.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, timezone: true, currency: true, active: true, createdAt: true } });
      const [users, vehicles] = await Promise.all([
        tx.user.groupBy({ by: ['companyId'], where: { active: true }, _count: { _all: true } }),
        tx.vehicle.groupBy({ by: ['companyId'], where: { deletedAt: null }, _count: { _all: true } }),
      ]);
      const u = new Map(users.map((x) => [x.companyId, x._count._all]));
      const v = new Map(vehicles.map((x) => [x.companyId, x._count._all]));
      return rows.map((c) => ({ ...c, users: u.get(c.id) ?? 0, vehicles: v.get(c.id) ?? 0 }));
    });
  }

  async createCompany(actor: AuthUser, input: CreateCompanyInput) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
    } catch {
      throw new BadRequestException('Unknown time zone');
    }
    const r = await this.db.system(async (tx) => {
      if (await tx.company.findUnique({ where: { code: input.code } })) throw new BadRequestException('A company with this code exists');
      if (await tx.user.findUnique({ where: { email: input.admin.email } })) throw new BadRequestException('A user with this e-mail already exists');
      const c = await tx.company.create({ data: { code: input.code, name: input.name, timezone: input.timezone, currency: input.currency } });
      const u = await tx.user.create({
        data: { companyId: c.id, email: input.admin.email, fullName: input.admin.fullName, roles: [Role.COMPANY_ADMIN], passwordHash: await AuthService.hashPassword(randomBytes(32).toString('hex')), invitedAt: new Date() },
        select: userSelect,
      });
      await tx.auditLog.create({ data: { companyId: c.id, userId: actor.userId, action: 'company.create', entity: 'company', entityId: c.id, payload: { code: c.code, name: c.name, admin: u.email } } });
      return { c, u, token: await this.issue(tx, { id: u.id, companyId: c.id }, 'INVITE', actor.userId) };
    });
    await this.sendInvite(r.u, r.c.name, r.token);
    return { ...r.c, admin: r.u };
  }

  async updateCompany(actor: AuthUser, id: string, input: { name?: string; active?: boolean }) {
    if (id === actor.companyId && input.active === false) throw new ForbiddenException('You cannot deactivate your own company');
    return this.db.system(async (tx) => {
      const c = await tx.company.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Company not found');
      const next = await tx.company.update({ where: { id }, data: { name: input.name, active: input.active } });
      // A deactivated company is signed out everywhere.
      if (input.active === false) await tx.refreshToken.updateMany({ where: { user: { companyId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: id, userId: actor.userId, action: 'company.update', entity: 'company', entityId: id, payload: { before: { name: c.name, active: c.active }, after: { name: next.name, active: next.active } } } });
      return next;
    });
  }
}
