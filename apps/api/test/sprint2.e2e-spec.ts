/**
 * Sprint 2: files, notifications, drivers, vehicle history.
 * Same prerequisites as app.e2e-spec.ts.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { DbModule } from '../src/common/db/db.module';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { ComplianceAlertsJob } from '../src/worker/compliance-alerts.job';

const PASSWORD = 'E2ePassword123!';
const run = `s2${Date.now().toString(36)}`;
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('Sprint 2 (e2e)', () => {
  let app: INestApplication;
  let job: ComplianceAlertsJob;
  let admin: PrismaClient;
  let tokenA: string;
  let tokenB: string;
  const companyIds: string[] = [];
  let vehicleId: string;

  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S2 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({
          data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] },
        });
      }
    });

    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const jobModule = await Test.createTestingModule({
      imports: [DbModule, NotificationsModule],
      providers: [ComplianceAlertsJob],
    }).compile();
    job = jobModule.get(ComplianceAlertsJob);

    tokenA = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    vehicleId = (
      await http()
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plateNumber: `${run}-1`, make: 'Hino', model: '300', vehicleClass: 'TRUCK' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of [
          'notifications',
          'vehicle_assignments',
          'vehicle_status_events',
          'vehicle_documents',
          'vehicles',
          'driver_licenses',
          'drivers',
          'files',
          'audit_logs',
          'users',
        ]) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  describe('files', () => {
    let fileId: string;

    it('uploads a PNG and sniffs its type', async () => {
      const res = await http()
        .post('/api/files')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', PNG, { filename: '../../etc/passwd.png', contentType: 'application/octet-stream' })
        .expect(201);
      fileId = res.body.id;
      expect(res.body).toMatchObject({ contentType: 'image/png', sizeBytes: PNG.length, filename: 'passwd.png' });
    });

    it('rejects unsupported content regardless of declared type', async () => {
      await http()
        .post('/api/files')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(400);
    });

    it('streams the file back to its company only', async () => {
      const res = await http().get(`/api/files/${fileId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
      await http().get(`/api/files/${fileId}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
    });

    it('attaches a file to a document, but not another company’s file', async () => {
      const doc = await http()
        .post(`/api/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'INSURANCE', number: 'POL-9', fileId, expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })
        .expect(201);
      const v = await http().get(`/api/vehicles/${vehicleId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(v.body.documents.find((d: { id: string }) => d.id === doc.body.id).file.filename).toBe('passwd.png');

      const bVehicle = await http()
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ plateNumber: `${run}-B`, make: 'Isuzu', model: 'NPR', vehicleClass: 'TRUCK' })
        .expect(201);
      await http()
        .post(`/api/vehicles/${bVehicle.body.id}/documents`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ type: 'INSURANCE', fileId })
        .expect(400);
    });
  });

  describe('compliance notifications', () => {
    it('notifies once per threshold and supports read state', async () => {
      const first = await job.run();
      expect(first.notified).toBeGreaterThan(0);
      const second = await job.run();
      expect(second.notified).toBe(0); // deduplicated

      const list = await http().get('/api/notifications').set('Authorization', `Bearer ${tokenA}`).expect(200);
      const n = list.body.find((x: { topic: string }) => x.topic === 'vehicle.document.expiring');
      expect(n).toMatchObject({ severity: 'warning' });
      expect(n.title).toContain(`${run}-1`.toUpperCase());

      expect((await http().get('/api/notifications/unread-count').set('Authorization', `Bearer ${tokenA}`)).body.count).toBe(
        list.body.length,
      );
      await http().post(`/api/notifications/${n.id}/read`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      const after = await http().get('/api/notifications/unread-count').set('Authorization', `Bearer ${tokenA}`);
      expect(after.body.count).toBe(list.body.length - 1);

      // Company B sees none of A's notifications.
      const b = await http().get('/api/notifications').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(b.body.some((x: { title: string }) => x.title.includes(`${run}-1`.toUpperCase()))).toBe(false);
    });

    it('stops alerting once the document is renewed', async () => {
      await http()
        .post(`/api/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'INSURANCE', number: 'POL-10', expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString() })
        .expect(201);
      const res = await http().get('/api/notifications').set('Authorization', `Bearer ${tokenA}`);
      const before = res.body.length;
      await job.run(new Date(Date.now() + 86_400_000 * 2)); // two days later the old policy would be in the 1d bucket
      const after = await http().get('/api/notifications').set('Authorization', `Bearer ${tokenA}`);
      expect(after.body.length).toBe(before);
    });
  });

  describe('drivers', () => {
    it('updates, adds licences, and deactivation releases the vehicle', async () => {
      const d = await http()
        .post('/api/drivers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ employeeNo: `${run}-D1`, fullName: 'Ko Ko' })
        .expect(201);
      await http()
        .patch(`/api/drivers/${d.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: '+95 9 123' })
        .expect(200);
      await http()
        .post(`/api/drivers/${d.body.id}/licenses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ number: 'L-77', licenseClass: 'E', expiresAt: '2030-01-01' })
        .expect(201);
      // Myanmar letter input is normalised; expiry defaults to the category validity (ဃ D = 3 years).
      const mm = await http()
        .post(`/api/drivers/${d.body.id}/licenses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ number: 'L-78', licenseClass: 'ဃ', issuedAt: '2026-01-15' })
        .expect(201);
      expect(mm.body.licenseClass).toBe('D');
      expect(mm.body.expiresAt.slice(0, 10)).toBe('2029-01-15');
      await http()
        .post(`/api/drivers/${d.body.id}/licenses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ number: 'L-79', licenseClass: 'Z' })
        .expect(400);
      await http()
        .post(`/api/vehicles/${vehicleId}/assignments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ driverId: d.body.id })
        .expect(201);
      await http()
        .patch(`/api/drivers/${d.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ active: false })
        .expect(200);

      const detail = await http().get(`/api/drivers/${d.body.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(detail.body).toMatchObject({ phone: '+95 9 123', active: false });
      expect(detail.body.licenses.map((l: { number: string }) => l.number).sort()).toEqual(['L-77', 'L-78']);
      expect(detail.body.assignments.every((a: { endAt: string | null }) => a.endAt !== null)).toBe(true);

      // Not visible from company B
      await http().patch(`/api/drivers/${d.body.id}`).set('Authorization', `Bearer ${tokenB}`).send({ phone: 'x' }).expect(404);
    });
  });

  it('returns a consolidated vehicle history', async () => {
    const res = await http().get(`/api/vehicles/${vehicleId}/history`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    const kinds = new Set(res.body.map((e: { kind: string }) => e.kind));
    expect(kinds).toEqual(new Set(['status', 'assignment', 'document']));
    const times = res.body.map((e: { at: string }) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
