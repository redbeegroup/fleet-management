/**
 * Sprint 17: replacement advice (limits, cost vs class), lifetime view, replacement plan,
 * disposal with book value and gain / loss, benchmarking within classes, tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';

const PASSWORD = 'E2ePassword123!';
const run = `s17${Date.now().toString(36)}`;
const DAY = 86_400_000;

describe('Sprint 17 lifecycle and benchmarking (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * DAY);
  const day = (d: number) => new Date(new Date(Date.now() - d * DAY).toISOString().slice(0, 10));

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S17 ${tag}`, timezone: 'Asia/Yangon' } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const a = companyIds[0];
      id.branch = (await tx.branch.create({ data: { companyId: a, code: `B${run}`, name: 'Yangon' } })).id;
      const mk = async (tag: string, data: Record<string, unknown>) =>
        (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-${tag}`, make: 'Isuzu', model: 'FVR', vehicleClass: 'TRUCK', ownership: 'OWNED', branchId: id.branch, ...data } })).id;
      id.old = await mk('OLD', { inServiceAt: yearsAgo(11), odometerKm: 400_000, purchasePrice: 60_000_000, residualValue: 6_000_000, usefulLifeMonths: 120 });
      id.km = await mk('KM', { inServiceAt: yearsAgo(4), odometerKm: 590_000, purchasePrice: 60_000_000, residualValue: 6_000_000, usefulLifeMonths: 120 });
      id.costly = await mk('COST', { inServiceAt: yearsAgo(3), odometerKm: 200_000 });
      id.ok1 = await mk('OK1', { inServiceAt: yearsAgo(2), odometerKm: 100_000, purchasePrice: 50_000_000, residualValue: 5_000_000, usefulLifeMonths: 120 });
      id.ok2 = await mk('OK2', { inServiceAt: yearsAgo(2), odometerKm: 90_000 });
      // 60 days of driving for every truck (km per day differs), costs mostly equal per km except COST.
      for (const [vid, kmDay] of [[id.old, 150], [id.km, 400], [id.costly, 200], [id.ok1, 220], [id.ok2, 180]] as [string, number][]) {
        await tx.vehicleDailyStat.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ companyId: a, vehicleId: vid, day: day(i + 1), distanceKm: kmDay, engineMinutes: 300, movingMinutes: 240, idleMinutes: 30, positions: 100 })) });
        const km = kmDay * 60;
        const cost = vid === id.costly ? km * 2000 : km * 1000;
        await tx.workOrder.create({ data: { companyId: a, woNo: `${run}-${vid.slice(0, 6)}`, vehicleId: vid, type: 'PREVENTIVE', status: 'COMPLETED', title: 'Service', openedAt: day(20), completedAt: day(19), totalCost: cost } });
      }
      id.vb = (await tx.vehicle.create({ data: { companyId: companyIds[1], plateNumber: `${run}-VB`, make: 'X', model: 'Y', vehicleClass: 'TRUCK' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
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
        for (const tbl of ['vehicle_disposals', 'vehicle_daily_stats', 'work_order_lines', 'work_orders', 'vehicle_assignments', 'vehicle_status_events', 'vehicles', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('replacement advice: age, km soon, running cost above the class median', async () => {
    const r = await http().get('/api/lifecycle/replacement').set(auth('a')).expect(200);
    const row = (k: string) => r.body.vehicles.find((x: { vehicle: { id: string } }) => x.vehicle.id === id[k]);
    expect(row('old')).toMatchObject({ advice: 'REPLACE_NOW', reasons: expect.arrayContaining([expect.stringMatching(/^Age 11 years \(limit 10\)/)]) });
    expect(row('km')).toMatchObject({ advice: 'PLAN', reasons: [expect.stringMatching(/^Reaches 600,000 km in about \d+ months$/)] });
    expect(row('costly')).toMatchObject({ advice: 'REPLACE_NOW', reasons: ['Running cost 100 % above the class median per km'] });
    expect(row('costly').classMedianRunningPerKm).toBe(1000);
    expect(row('ok1')).toMatchObject({ advice: 'OK', runningPerKm12m: 1000 });
    expect(row('ok1').bookValue).toBeGreaterThan(30_000_000);
    expect(r.body.totals).toMatchObject({ replaceNow: 2, plan: 1, ok: 2 });
    // Company limits per class override the defaults.
    await http().patch('/api/company/settings').set(auth('a')).send({ lifecycle: { limits: { TRUCK: { maxAgeYears: 20 } } } }).expect(200);
    const r2 = await http().get('/api/lifecycle/replacement').set(auth('a')).expect(200);
    expect(r2.body.vehicles.find((x: { vehicle: { id: string } }) => x.vehicle.id === id.old).advice).toBe('OK');
    expect((await http().get('/api/lifecycle/replacement').set(auth('b')).expect(200)).body.vehicles.map((x: { vehicle: { id: string } }) => x.vehicle.id)).toEqual([id.vb]);
  });

  it('vehicle lifetime view and replacement plan', async () => {
    const l = await http().get(`/api/vehicles/${id.ok1}/lifecycle`).set(auth('a')).expect(200);
    expect(l.body.lifetime.km).toBe(220 * 60);
    expect(l.body.lifetime.byCategory.MAINTENANCE).toBe(220 * 60 * 1000);
    expect(l.body.lifetime.byCategory.DEPRECIATION).toBeGreaterThan(0);
    expect(l.body.timeline.map((x: { event: string }) => x.event)).toEqual(['In service']);
    await http().patch(`/api/vehicles/${id.km}/replacement-plan`).set(auth('a')).send({ replacementPlannedFor: '2027-06-01', replacementNote: 'Budget 2027' }).expect(200);
    const r = await http().get('/api/lifecycle/replacement').set(auth('a')).expect(200);
    expect(r.body.vehicles.find((x: { vehicle: { id: string } }) => x.vehicle.id === id.km)).toMatchObject({ replacementPlannedFor: '2027-06-01', replacementNote: 'Budget 2027' });
    await http().get(`/api/vehicles/${id.ok1}/lifecycle`).set(auth('b')).expect(404);
  });

  it('disposal: blocked by open work, book value and gain or loss, then out of service', async () => {
    const wo = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.old, type: 'CORRECTIVE', title: 'Last fix', offRoad: false }).expect(201);
    const body = { disposedAt: new Date().toISOString().slice(0, 10), method: 'SALE', buyer: 'Golden Used Trucks', saleValue: 8_000_000 };
    const blocked = await http().post(`/api/vehicles/${id.old}/dispose`).set(auth('a')).send(body).expect(409);
    expect(blocked.body.message).toMatch(/Work order .* still open/);
    await http().post(`/api/maintenance/work-orders/${wo.body.id}/cancel`).set(auth('a')).send({ reason: 'Selling' }).expect(200);
    await http().post(`/api/vehicles/${id.old}/dispose`).set(auth('b')).send(body).expect(404);
    const d = await http().post(`/api/vehicles/${id.old}/dispose`).set(auth('a')).send(body).expect(201);
    // Fully depreciated after 11 years: book value = residual 6,000,000 → gain 2,000,000.
    expect(d.body).toMatchObject({ method: 'SALE', bookValue: '6000000', gainLoss: '2000000' });
    await http().post(`/api/vehicles/${id.old}/dispose`).set(auth('a')).send(body).expect(409);
    const v = await http().get(`/api/vehicles/${id.old}`).set(auth('a')).expect(200);
    expect(v.body.status).toBe('DISPOSED');
    const r = await http().get('/api/lifecycle/replacement').set(auth('a')).expect(200);
    expect(r.body.vehicles.some((x: { vehicle: { id: string } }) => x.vehicle.id === id.old)).toBe(false);
    expect(r.body.disposals[0]).toMatchObject({ plateNumber: `${run}-OLD`, gainLoss: '2000000' });
    const life = await http().get(`/api/vehicles/${id.old}/lifecycle`).set(auth('a')).expect(200);
    expect(life.body.timeline.map((x: { event: string }) => x.event)).toEqual(['In service', 'Disposed (sale)']);
    expect(life.body.advice).toBeNull();
  });

  it('benchmark within the class: medians, percentiles, ranks, branches', async () => {
    const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    const to = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const b = await http().get(`/api/analytics/benchmark?from=${from}&to=${to}`).set(auth('a')).expect(200);
    const truck = b.body.classes.find((c: { vehicleClass: string }) => c.vehicleClass === 'TRUCK');
    expect(truck.vehicles).toBe(4); // the disposed truck is out
    expect(truck.medians.kmPerDay).toBe(210);
    const km = b.body.vehicles.find((x: { id: string }) => x.id === id.km);
    expect(km.metrics.kmPerDay).toMatchObject({ value: 400, percentile: 100 });
    expect(km.rank).toBe(1);
    expect(b.body.branches[0]).toMatchObject({ branchName: 'Yangon', vehicles: 4 });
    expect((await http().get(`/api/analytics/benchmark?from=${from}&to=${to}`).set(auth('b')).expect(200)).body.vehicles.map((x: { id: string }) => x.id)).toEqual([id.vb]);
  });
});
