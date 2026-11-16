/**
 * Sprint 15: read-only BI logins. A company login reads only its own rows in the
 * "reporting" views and nothing in the application tables; the group login reads all.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';

const PASSWORD = 'E2ePassword123!';
const run = `s15bi${Date.now().toString(36)}`;

describe('Sprint 15 BI logins (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const roles: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const dbUrl = new URL(process.env.DATABASE_URL!);
  /** A PrismaClient connected as a BI login. */
  const asBi = (role: string, password: string) => {
    const u = new URL(dbUrl.toString());
    u.username = role;
    u.password = password;
    u.search = '';
    return new PrismaClient({ datasourceUrl: u.toString() });
  };
  const dropRole = async (role: string) => {
    await admin.$executeRawUnsafe(`DELETE FROM fms_bi.logins WHERE role_name = '${role}'`).catch(() => undefined);
    await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${dbUrl.pathname.slice(1)}" FROM "${role}"`).catch(() => undefined);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    await dropRole('fms_bi_group'); // left over from an aborted run
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S15 BI ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
        await tx.vehicle.create({ data: { companyId: c.id, plateNumber: `${run}-${tag}`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK' } });
      }
      await tx.user.create({ data: { companyId: companyIds[0], email: `s-${run}@e2e.local`, fullName: 'Super', passwordHash, roles: ['SUPER_ADMIN'] } });
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 's']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
  });

  beforeEach(() => {
    const store = app.get<ThrottlerStorageService>(getStorageToken());
    store.storage.clear();
    (store as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    for (const r of roles) await dropRole(r);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1::uuid)`, companyId);
        for (const tbl of ['vehicle_status_events', 'vehicles', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('only super admins manage BI logins', async () => {
    await http().get('/api/admin/bi-logins').set(auth('a')).expect(403);
    await http().post('/api/admin/bi-logins').set(auth('a')).send({ companyId: companyIds[0] }).expect(403);
    const l = await http().get('/api/admin/bi-logins').set(auth('s')).expect(200);
    expect(l.body.available).toBe(true);
    expect(l.body.connection).toMatchObject({ database: dbUrl.pathname.slice(1), schema: 'reporting' });
  });

  it('a company login reads only its company through the reporting views', async () => {
    const res = await http().post('/api/admin/bi-logins').set(auth('s')).send({ companyId: companyIds[0] }).expect(201);
    expect(res.body.roleName).toBe(`fms_bi_${run}a`);
    roles.push(res.body.roleName);
    await http().post('/api/admin/bi-logins').set(auth('s')).send({ companyId: companyIds[0] }).expect(409);

    const bi = asBi(res.body.roleName, res.body.password);
    try {
      const rows = await bi.$queryRawUnsafe<{ plate_number: string; company_code: string }[]>(`SELECT plate_number, company_code FROM reporting.vehicles`);
      expect(rows.map((r) => r.plate_number)).toEqual([`${run}-A`]);
      expect((await bi.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM reporting.companies`))[0].n).toBe(1n);
      await expect(bi.$queryRawUnsafe(`SELECT * FROM public.vehicles`)).rejects.toThrow(/permission denied/);
      await expect(bi.$queryRawUnsafe(`SELECT * FROM public.users`)).rejects.toThrow(/permission denied/);
      // Session settings do not widen what the login sees.
      await bi.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true), set_config('app.company_id', '${companyIds[1]}', true)`);
        const again = await tx.$queryRawUnsafe<{ plate_number: string }[]>(`SELECT plate_number FROM reporting.vehicles`);
        expect(again.map((r) => r.plate_number)).toEqual([`${run}-A`]);
      });
      await expect(bi.$executeRawUnsafe(`UPDATE reporting.vehicles SET plate_number = 'x'`)).rejects.toThrow();
      const cal = await bi.$queryRawUnsafe<{ weekday: number }[]>(`SELECT weekday FROM reporting.calendar WHERE date = '2026-11-16'`);
      expect(cal[0].weekday).toBe(1);
    } finally {
      await bi.$disconnect();
    }
  });

  it('the group login reads every company; rotate and remove', async () => {
    const res = await http().post('/api/admin/bi-logins').set(auth('s')).send({ companyId: null }).expect(201);
    expect(res.body.roleName).toBe('fms_bi_group');
    roles.push('fms_bi_group');
    const bi = asBi('fms_bi_group', res.body.password);
    const rows = await bi.$queryRawUnsafe<{ plate_number: string }[]>(`SELECT plate_number FROM reporting.vehicles WHERE plate_number LIKE '${run}-%' ORDER BY 1`);
    expect(rows.map((r) => r.plate_number)).toEqual([`${run}-A`, `${run}-B`]);
    await bi.$disconnect();

    const list = await http().get('/api/admin/bi-logins').set(auth('s')).expect(200);
    expect(list.body.logins.map((l: { roleName: string; scope: string }) => `${l.roleName}:${l.scope}`)).toEqual(expect.arrayContaining(['fms_bi_group:GROUP', `fms_bi_${run}a:COMPANY`]));
    expect(JSON.stringify(list.body)).not.toContain(res.body.password);

    // (Local test databases use trust authentication, so compare the stored SCRAM hash.)
    const hash = async () => (await admin.$queryRawUnsafe<{ p: string }[]>(`SELECT rolpassword p FROM pg_authid WHERE rolname = 'fms_bi_group'`))[0].p;
    const before = await hash();
    expect(before).toMatch(/^SCRAM-SHA-256/);
    const rotated = await http().post('/api/admin/bi-logins/fms_bi_group/rotate').set(auth('s')).expect(200);
    expect(rotated.body.password).not.toBe(res.body.password);
    expect(await hash()).not.toBe(before);
    const fresh = asBi('fms_bi_group', rotated.body.password);
    await fresh.$queryRawUnsafe('SELECT 1');
    await fresh.$disconnect();

    await http().delete('/api/admin/bi-logins/fms_bi_group').set(auth('s')).expect(204);
    const gone = await admin.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM pg_roles WHERE rolname = 'fms_bi_group'`);
    expect(gone[0].n).toBe(0n);
    await http().post('/api/admin/bi-logins/x;drop/rotate').set(auth('s')).expect(400);
  });
});
