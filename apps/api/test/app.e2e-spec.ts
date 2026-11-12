/**
 * End-to-end tests against a real PostgreSQL + Redis.
 * Requires DATABASE_URL (non-superuser app role, so RLS applies),
 * DATABASE_MIGRATION_URL (owner, used for fixtures), REDIS_URL, JWT_ACCESS_SECRET.
 * Migrations and the demo seed must have been applied.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';

const PASSWORD = 'E2ePassword123!';
const run = Date.now().toString(36);

describe('FMS API (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let tokenA: string;
  let tokenB: string;
  let viewerToken: string;
  let companyAId: string;
  let companyBId: string;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const a = await tx.company.create({ data: { code: `E2EA-${run}`, name: 'E2E Company A' } });
      const b = await tx.company.create({ data: { code: `E2EB-${run}`, name: 'E2E Company B' } });
      companyAId = a.id;
      companyBId = b.id;
      await tx.user.createMany({
        data: [
          { companyId: a.id, email: `a-${run}@e2e.local`, fullName: 'A admin', passwordHash, roles: ['COMPANY_ADMIN'] },
          { companyId: a.id, email: `v-${run}@e2e.local`, fullName: 'A viewer', passwordHash, roles: ['VIEWER'] },
          { companyId: b.id, email: `b-${run}@e2e.local`, fullName: 'B admin', passwordHash, roles: ['COMPANY_ADMIN'] },
        ],
      });
    });

    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    tokenA = (await login(`a-${run}@e2e.local`)).accessToken;
    tokenB = (await login(`b-${run}@e2e.local`)).accessToken;
    viewerToken = (await login(`v-${run}@e2e.local`)).accessToken;
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of [companyAId, companyBId]) {
        await tx.vehicleAssignment.deleteMany({ where: { companyId } });
        await tx.vehicleStatusEvent.deleteMany({ where: { companyId } });
        await tx.vehicleDocument.deleteMany({ where: { companyId } });
        await tx.vehicle.deleteMany({ where: { companyId } });
        await tx.driverLicense.deleteMany({ where: { companyId } });
        await tx.driver.deleteMany({ where: { companyId } });
        await tx.auditLog.deleteMany({ where: { companyId } });
        await tx.user.deleteMany({ where: { companyId } });
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/api/vehicles').expect(401);
  });

  it('rejects bad credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `a-${run}@e2e.local`, password: 'wrong-password' })
      .expect(401);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const first = await login(`a-${run}@e2e.local`);
    const second = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.accessToken).toBeDefined();
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    // Reuse revoked the whole family, including the newly issued token.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
  });

  describe('vehicles', () => {
    let vehicleId: string;

    it('creates a vehicle and normalises the plate', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plateNumber: 'e2e-1a-0001', make: 'Isuzu', model: 'NPR', vehicleClass: 'TRUCK', capacityKg: 4500 })
        .expect(201);
      vehicleId = res.body.id;
      expect(res.body.plateNumber).toBe('E2E-1A-0001');
      expect(res.body.status).toBe('AVAILABLE');
    });

    it('rejects duplicate plates within the company', async () => {
      await request(app.getHttpServer())
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plateNumber: 'E2E-1A-0001', make: 'Isuzu', model: 'NPR', vehicleClass: 'TRUCK' })
        .expect(409);
    });

    it('validates input', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plateNumber: '', vehicleClass: 'SPACESHIP' })
        .expect(400);
      expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
        expect.arrayContaining(['plateNumber', 'make', 'model', 'vehicleClass']),
      );
    });

    it('enforces RBAC (viewer cannot write)', async () => {
      await request(app.getHttpServer()).get('/api/vehicles').set('Authorization', `Bearer ${viewerToken}`).expect(200);
      await request(app.getHttpServer())
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ plateNumber: 'X', make: 'X', model: 'X', vehicleClass: 'CAR' })
        .expect(403);
    });

    it('isolates tenants', async () => {
      await request(app.getHttpServer())
        .get(`/api/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const list = await request(app.getHttpServer()).get('/api/vehicles').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(list.body.total).toBe(0);
      await request(app.getHttpServer())
        .patch(`/api/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ make: 'Hacked' })
        .expect(404);
    });

    it('allows the same plate in another company', async () => {
      await request(app.getHttpServer())
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ plateNumber: 'E2E-1A-0001', make: 'Hino', model: '300', vehicleClass: 'TRUCK' })
        .expect(201);
    });

    it('enforces the status state machine and records history', async () => {
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'DISPOSED' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'UNDER_REPAIR', reason: 'Brake service' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'AVAILABLE' })
        .expect(200);
      const res = await request(app.getHttpServer())
        .get(`/api/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.statusHistory.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'AVAILABLE',
        'UNDER_REPAIR',
        'AVAILABLE',
      ]);
    });

    it('assigns a driver, marks the vehicle ASSIGNED, then unassigns', async () => {
      const driver = await request(app.getHttpServer())
        .post('/api/drivers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ employeeNo: 'E2E-001', fullName: 'Test Driver', licenseNumber: 'L-1', licenseClass: 'E' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/assignments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ driverId: driver.body.id })
        .expect(201);
      let v = await request(app.getHttpServer()).get(`/api/vehicles/${vehicleId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(v.body.status).toBe('ASSIGNED');
      expect(v.body.assignments).toHaveLength(1);

      // Company B cannot assign its vehicles to company A's driver.
      const bVehicles = await request(app.getHttpServer()).get('/api/vehicles').set('Authorization', `Bearer ${tokenB}`);
      await request(app.getHttpServer())
        .post(`/api/vehicles/${bVehicles.body.items[0].id}/assignments`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ driverId: driver.body.id })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/vehicles/${vehicleId}/assignments/current`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      v = await request(app.getHttpServer()).get(`/api/vehicles/${vehicleId}`).set('Authorization', `Bearer ${tokenA}`);
      expect(v.body.status).toBe('AVAILABLE');
      expect(v.body.assignments).toHaveLength(0);
    });

    it('lists expiring documents', async () => {
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'INSURANCE', number: 'POL-1', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'ROAD_TAX', number: 'RT-1', expiresAt: new Date(Date.now() + 200 * 86_400_000).toISOString() })
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/vehicles/documents/expiring?days=30')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.map((d: { number: string }) => d.number)).toEqual(['POL-1']);
    });

    it('writes audit logs for mutations', async () => {
      // audit writes are fire-and-forget
      await new Promise((r) => setTimeout(r, 300));
      const res = await request(app.getHttpServer()).get('/api/audit-logs').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.some((l: { action: string }) => l.action === 'VehiclesController.create')).toBe(true);
      expect(res.body.every((l: { companyId: string }) => l.companyId === companyAId)).toBe(true);
    });
  });
});
