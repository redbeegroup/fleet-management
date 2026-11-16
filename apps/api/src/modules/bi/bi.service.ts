import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService } from '../../common/db/prisma.service';

/** BI role names: fms_bi_group, or fms_bi_<company code>. */
export function biRoleName(code: string | null): string {
  if (code === null) return 'fms_bi_group';
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (!slug) throw new BadRequestException('The company code cannot be used for a login name');
  return `fms_bi_${slug}`;
}

const ROLE_RE = /^fms_bi_[a-z0-9_]{1,40}$/;
const quoteIdent = (name: string) => {
  if (!ROLE_RE.test(name)) throw new BadRequestException('Invalid login name');
  return `"${name}"`;
};
/** Random password: base64url characters only, so it is safe inside a SQL string literal. */
const newPassword = () => randomBytes(24).toString('base64url');

interface LoginRow {
  role_name: string;
  company_id: string | null;
  created_at: Date;
  rotated_at: Date | null;
}

/**
 * Read-only PostgreSQL logins for BI tools (Power BI, Metabase, Tableau). Each login reads
 * only the "reporting" views; a company login sees its company, the group login all companies.
 * Role DDL runs on the admin connection (BI_ADMIN_DATABASE_URL or DATABASE_MIGRATION_URL).
 * Passwords are shown once and stored only as the database's own SCRAM hash.
 */
@Injectable()
export class BiService implements OnModuleDestroy {
  private readonly log = new Logger('BI');
  private admin: PrismaClient | null = null;

  constructor(private readonly db: PrismaService) {}

  private adminUrl(): string | undefined {
    return env().BI_ADMIN_DATABASE_URL ?? env().DATABASE_MIGRATION_URL;
  }

  private client(): PrismaClient {
    const url = this.adminUrl();
    if (!url) throw new ServiceUnavailableException('BI logins are not set up: BI_ADMIN_DATABASE_URL (or DATABASE_MIGRATION_URL) is missing.');
    this.admin ??= new PrismaClient({ datasourceUrl: url });
    return this.admin;
  }

  async onModuleDestroy() {
    await this.admin?.$disconnect();
  }

  connection() {
    const u = new URL(env().DATABASE_URL);
    const ssl = u.searchParams.get('sslmode');
    return {
      host: env().BI_DB_HOST ?? u.hostname,
      port: env().BI_DB_PORT ?? Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      sslmode: ssl ?? 'prefer',
      schema: 'reporting',
    };
  }

  private async readerReady(c: PrismaClient): Promise<boolean> {
    const r = await c.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') AS ok`;
    return r[0].ok;
  }

  async list() {
    const url = this.adminUrl();
    const companies = await this.db.system((tx) => tx.company.findMany({ select: { id: true, code: true, name: true, active: true }, orderBy: { code: 'asc' } }));
    if (!url) return { available: false, reason: 'BI_ADMIN_DATABASE_URL (or DATABASE_MIGRATION_URL) is not configured for the API.', connection: this.connection(), companies, logins: [] };
    const c = this.client();
    try {
      if (!(await this.readerReady(c))) return { available: false, reason: 'The database role fms_bi_reader is missing (see docs/BI_REPORTING.md).', connection: this.connection(), companies, logins: [] };
      const rows = await c.$queryRaw<LoginRow[]>`SELECT role_name, company_id, created_at, rotated_at FROM fms_bi.logins ORDER BY role_name`;
      const byId = new Map(companies.map((x) => [x.id, x]));
      return {
        available: true,
        connection: this.connection(),
        companies,
        logins: rows.map((r) => ({ roleName: r.role_name, companyId: r.company_id, company: r.company_id ? byId.get(r.company_id) ?? null : null, scope: r.company_id ? 'COMPANY' : 'GROUP', createdAt: r.created_at, rotatedAt: r.rotated_at })),
      };
    } catch (e) {
      this.log.warn(`BI admin connection failed: ${(e as Error).message}`);
      return { available: false, reason: 'The BI admin database connection failed.', connection: this.connection(), companies, logins: [] };
    }
  }

  async create(actor: AuthUser, companyId: string | null) {
    let code: string | null = null;
    if (companyId) {
      const company = await this.db.system((tx) => tx.company.findUnique({ where: { id: companyId } }));
      if (!company) throw new NotFoundException('Company not found');
      code = company.code;
    }
    const role = biRoleName(code);
    const c = this.client();
    if (!(await this.readerReady(c))) throw new ServiceUnavailableException('The database role fms_bi_reader is missing (see docs/BI_REPORTING.md).');
    const exists = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${role}`;
    if (Number(exists[0].n) > 0) throw new ConflictException(`A login ${role} already exists. Rotate its password or remove it first.`);
    const password = newPassword();
    const id = quoteIdent(role);
    const dbName = this.connection().database.replace(/"/g, '""');
    await c.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE ROLE ${id} LOGIN PASSWORD '${password}' CONNECTION LIMIT 10 IN ROLE fms_bi_reader`);
      await tx.$executeRawUnsafe(`ALTER ROLE ${id} SET search_path = reporting`);
      await tx.$executeRawUnsafe(`ALTER ROLE ${id} SET default_transaction_read_only = on`);
      await tx.$executeRawUnsafe(`ALTER ROLE ${id} SET statement_timeout = '300s'`);
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO ${id}`);
      await tx.$executeRaw`INSERT INTO fms_bi.logins (role_name, company_id, created_by) VALUES (${role}, ${companyId}::uuid, ${actor.userId}::uuid)`;
    });
    await this.audit(actor, companyId, 'bi.login.create', { role });
    return { roleName: role, password, scope: companyId ? 'COMPANY' : 'GROUP', connection: this.connection() };
  }

  private async row(role: string): Promise<LoginRow> {
    quoteIdent(role);
    const r = await this.client().$queryRaw<LoginRow[]>`SELECT role_name, company_id, created_at, rotated_at FROM fms_bi.logins WHERE role_name = ${role}`;
    if (!r.length) throw new NotFoundException('BI login not found');
    return r[0];
  }

  async rotate(actor: AuthUser, role: string) {
    const r = await this.row(role);
    const password = newPassword();
    await this.client().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER ROLE ${quoteIdent(role)} PASSWORD '${password}'`);
      await tx.$executeRaw`UPDATE fms_bi.logins SET rotated_at = now() WHERE role_name = ${role}`;
    });
    await this.audit(actor, r.company_id, 'bi.login.rotate', { role });
    return { roleName: role, password, connection: this.connection() };
  }

  async remove(actor: AuthUser, role: string) {
    const r = await this.row(role);
    const id = quoteIdent(role);
    const dbName = this.connection().database.replace(/"/g, '""');
    const c = this.client();
    await c.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM fms_bi.logins WHERE role_name = ${role}`;
      await tx.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${dbName}" FROM ${id}`);
      await tx.$executeRawUnsafe(`DROP ROLE ${id}`);
    });
    // Open sessions keep running until they end; close them if we are allowed to.
    await c.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ${role}`.catch(() => undefined);
    await this.audit(actor, r.company_id, 'bi.login.delete', { role });
  }

  private async audit(actor: AuthUser, companyId: string | null, action: string, payload: Record<string, unknown>) {
    await this.db.system((tx) => tx.auditLog.create({ data: { companyId: companyId ?? actor.companyId, userId: actor.userId, action, entity: 'bi_login', entityId: payload.role as string, payload: payload as never } }));
  }
}
