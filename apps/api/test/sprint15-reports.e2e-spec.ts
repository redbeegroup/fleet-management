/**
 * Sprint 15: scheduled management reports — preview (HTML/PDF), subscriptions, recipients'
 * permissions, once-per-period dispatch at 07:00 company time, send now, tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { ReportMailer, ReportsService } from '../src/modules/reports/reports.service';

const PASSWORD = 'E2ePassword123!';
const run = `s15r${Date.now().toString(36)}`;
const DAY = 86_400_000;

describe('Sprint 15 scheduled reports (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let mailer: ReportMailer;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const mails = (subject: RegExp) => mailer.recent.filter((m) => subject.test(m.subject) && m.to.includes(run));

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S15 Reports ${tag}`, timezone: 'Asia/Yangon' } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const a = companyIds[0];
      id.manager = (await tx.user.create({ data: { companyId: a, email: `m-${run}@e2e.local`, fullName: 'Manager', passwordHash, roles: ['FLEET_MANAGER'] } })).id;
      id.dispatcher = (await tx.user.create({ data: { companyId: a, email: `p-${run}@e2e.local`, fullName: 'Dispatcher', passwordHash, roles: ['DISPATCHER'] } })).id;
      id.gone = (await tx.user.create({ data: { companyId: a, email: `x-${run}@e2e.local`, fullName: 'Gone', passwordHash, roles: ['FLEET_MANAGER'], active: false } })).id;
      id.branch = (await tx.branch.create({ data: { companyId: a, code: `B${run}`, name: 'Main depot' } })).id;
      const v = await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V1`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', branchId: id.branch, purchasePrice: 60_000_000, residualValue: 6_000_000, usefulLifeMonths: 60, inServiceAt: new Date('2025-01-01') } });
      const yesterday = new Date(Date.now() - DAY);
      await tx.fuelRecord.create({ data: { companyId: a, vehicleId: v.id, filledAt: yesterday, odometerKm: 1000, litres: 40, unitPrice: 2500, totalCost: 100_000, approvalStatus: 'APPROVED' } });
      await tx.vehicleDocument.create({ data: { companyId: a, vehicleId: v.id, type: 'INSURANCE', number: 'POL-1', expiresAt: new Date(Date.now() + 10 * DAY) } });
      const d = await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver One' } });
      await tx.incident.create({ data: { companyId: a, incidentNo: `${run}-I1`, vehicleId: v.id, driverId: d.id, type: 'COLLISION', severity: 'MINOR', occurredAt: yesterday, description: 'Scratch' } });
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    mailer = app.get(ReportMailer);
    for (const k of ['a', 'b', 'm', 'p']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
  });

  beforeEach(() => {
    const store = app.get<ThrottlerStorageService>(getStorageToken());
    store.storage.clear();
    (store as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1::uuid)`, companyId);
        for (const tbl of ['report_runs', 'report_subscriptions', 'incidents', 'drivers', 'vehicle_documents', 'fuel_records', 'vehicle_status_events', 'vehicles', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('previews every report as HTML and PDF; access follows the report permission', async () => {
    for (const report of ['FLEET', 'BUDGET', 'DELIVERY', 'SAFETY']) {
      const html = await http().get(`/api/report-subscriptions/preview?report=${report}&frequency=MONTHLY`).set(auth('a')).expect(200);
      expect(html.headers['content-type']).toMatch(/text\/html/);
      expect(html.headers['content-security-policy']).toContain("default-src 'none'");
      expect(html.text).toContain('S15 Reports A');
    }
    const fleet = await http().get('/api/report-subscriptions/preview?report=FLEET&frequency=DAILY').set(auth('a')).expect(200);
    expect(fleet.text).toContain(`${run}-V1`);
    expect(fleet.text).toContain('100,000 MMK');
    const safety = await http().get(`/api/report-subscriptions/preview?report=SAFETY&frequency=DAILY&branchId=${id.branch}`).set(auth('a')).expect(200);
    expect(safety.text).toContain('POL-1');
    expect(safety.text).toMatch(/Incidents[\s\S]*?>1</);
    const pdf = await http().get('/api/report-subscriptions/preview?report=BUDGET&frequency=MONTHLY&format=pdf').set(auth('a')).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // A dispatcher may see delivery and safety, not costs.
    await http().get('/api/report-subscriptions/preview?report=FLEET&frequency=DAILY').set(auth('p')).expect(403);
    await http().get('/api/report-subscriptions/preview?report=DELIVERY&frequency=DAILY').set(auth('p')).expect(200);
  });

  it('subscriptions: admin manages, recipients are validated', async () => {
    await http().post('/api/report-subscriptions').set(auth('m')).send({ report: 'FLEET', frequency: 'DAILY' }).expect(403);
    await http().post('/api/report-subscriptions').set(auth('a')).send({ report: 'FLEET', frequency: 'DAILY', userIds: [crypto.randomUUID()] }).expect(400);
    const s = await http()
      .post('/api/report-subscriptions')
      .set(auth('a'))
      .send({ report: 'FLEET', frequency: 'DAILY', userIds: [id.manager, id.dispatcher, id.gone], extraEmails: [`Owner-${run}@E2E.local`] })
      .expect(201);
    id.sub = s.body.id;
    expect(s.body.extraEmails).toEqual([`owner-${run}@e2e.local`]);
    const list = await http().get('/api/report-subscriptions').set(auth('a')).expect(200);
    expect(list.body.smtp).toBe(false);
    expect(list.body.subscriptions.map((x: { id: string; title: string }) => x.title)).toEqual(['Fleet overview']);
    // The dispatcher may not see cost subscriptions at all.
    expect((await http().get('/api/report-subscriptions').set(auth('p')).expect(200)).body.subscriptions).toEqual([]);
  });

  it('the hourly job sends each period once from 07:00 company time, only to allowed recipients', async () => {
    // Created ten days ago, so yesterday's report is due.
    await admin.$executeRawUnsafe(`UPDATE report_subscriptions SET created_at = now() - interval '10 days' WHERE id = $1::uuid`, id.sub);
    const svc = app.get(ReportsService);
    const today = new Date().toISOString().slice(0, 10);
    const early = new Date(`${today}T00:00:00Z`); // 06:30 in Yangon
    const later = new Date(`${today}T03:00:00Z`); // 09:30 in Yangon
    const before = mails(/Fleet overview/).length;
    await svc.dispatch(early);
    expect(mails(/Fleet overview/).length).toBe(before);
    await svc.dispatch(later);
    const sent = mails(/Fleet overview/).slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual([`m-${run}@e2e.local`, `owner-${run}@e2e.local`]);
    expect(sent[0].attachments.map((x) => x.filename)).toEqual([expect.stringMatching(/^fleet-\d{4}-\d{2}-\d{2}\.pdf$/), 'vehicles.csv']);
    // Same period again: nothing new.
    await svc.dispatch(new Date(later.getTime() + 3_600_000));
    expect(mails(/Fleet overview/).length).toBe(before + 2);
    const runs = await admin.$queryRawUnsafe<{ status: string; recipients: number; error: string }[]>(`SELECT status, recipients, error FROM report_runs WHERE subscription_id = $1::uuid`, id.sub);
    expect(runs).toEqual([{ status: 'SKIPPED', recipients: 2, error: 'Not sent: SMTP is not configured' }]);
  });

  it('send now re-sends the last period; disabled subscriptions are not dispatched', async () => {
    const before = mails(/Fleet overview/).length;
    const r = await http().post(`/api/report-subscriptions/${id.sub}/send`).set(auth('a')).expect(200);
    expect(r.body.recipients).toBe(2);
    expect(mails(/Fleet overview/).length).toBe(before + 2);
    await http().patch(`/api/report-subscriptions/${id.sub}`).set(auth('a')).send({ enabled: false }).expect(200);
    const w = await http().post('/api/report-subscriptions').set(auth('a')).send({ report: 'SAFETY', frequency: 'WEEKLY', userIds: [id.dispatcher] }).expect(201);
    await admin.$executeRawUnsafe(`UPDATE report_subscriptions SET created_at = now() - interval '30 days' WHERE id = $1::uuid`, w.body.id);
    await app.get(ReportsService).dispatch(new Date(Date.now() + 0));
    const list = await http().get('/api/report-subscriptions').set(auth('a')).expect(200);
    const fleet = list.body.subscriptions.find((s: { id: string }) => s.id === id.sub);
    expect(fleet.enabled).toBe(false);
  });

  it('keeps subscriptions per company', async () => {
    expect((await http().get('/api/report-subscriptions').set(auth('b')).expect(200)).body.subscriptions).toEqual([]);
    await http().patch(`/api/report-subscriptions/${id.sub}`).set(auth('b')).send({ enabled: true }).expect(404);
    await http().post(`/api/report-subscriptions/${id.sub}/send`).set(auth('b')).expect(404);
    await http().delete(`/api/report-subscriptions/${id.sub}`).set(auth('b')).expect(404);
    await http().post('/api/report-subscriptions').set(auth('b')).send({ report: 'FLEET', frequency: 'DAILY', userIds: [id.manager] }).expect(400);
    await http().get(`/api/report-subscriptions/preview?report=FLEET&frequency=DAILY&branchId=${id.branch}`).set(auth('b')).expect(400);
    await http().delete(`/api/report-subscriptions/${id.sub}`).set(auth('a')).expect(204);
  });
});
