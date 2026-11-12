/**
 * Sprint 6: daily stats rollup, analytics overview & CSV, expenses, devices, metrics.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s6${Date.now().toString(36)}`;
const DEV = `S6-${run}`;
// A fixed past local day in Asia/Yangon (UTC+6:30): 2026-03-10 00:00 local = 2026-03-09T17:30Z
const DAY = '2026-03-10';
const localStart = Date.parse('2026-03-09T17:30:00Z');
const at = (min: number) => new Date(localStart + min * 60_000);

describe('Sprint 6 analytics (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let token: string;
  let tokenB: string;
  let execToken: string;
  let dispatcherToken: string;
  const companyIds: string[] = [];
  let truck: string;
  let idle: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S6 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `x-${run}@e2e.local`, fullName: 'Exec', passwordHash, roles: ['EXECUTIVE'] } });
      await tx.user.create({ data: { companyId: a, email: `p-${run}@e2e.local`, fullName: 'Disp', passwordHash, roles: ['DISPATCHER'] } });
      truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-T`, make: 'Hino', model: '300', vehicleClass: 'TRUCK', gpsDeviceId: DEV } })).id;
      idle = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-I`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN' } })).id;
      await tx.$executeRaw`SELECT fms_ensure_position_partition(${DAY}::date)`;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['metrics'] });
    await app.init();
    const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
    token = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    execToken = await login(`x-${run}@e2e.local`);
    dispatcherToken = await login(`p-${run}@e2e.local`);
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of ['notifications', 'user_devices', 'vehicle_daily_stats', 'vehicle_expenses', 'fuel_records', 'telemetry_events', 'vehicle_telemetry_state',
          'vehicle_last_positions', 'vehicle_positions', 'vehicle_status_events', 'vehicles', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('rolls GPS positions up into company-local days', async () => {
    // 1 fix/min. 10 min idling (engine on, 0 km/h), then 60 min driving north at ~60 km/h (1 km/min),
    // then engine off. One fix the evening before (local) must land in the previous day.
    const fixes = [{ deviceId: DEV, recordedAt: at(-5), latitude: 16.8, longitude: 96.1, speedKmh: 0, ignition: true }];
    for (let m = 0; m <= 10; m++) fixes.push({ deviceId: DEV, recordedAt: at(60 + m), latitude: 16.8, longitude: 96.1, speedKmh: 0, ignition: true });
    for (let m = 1; m <= 60; m++) fixes.push({ deviceId: DEV, recordedAt: at(70 + m), latitude: 16.8 + m * 0.008993, longitude: 96.1, speedKmh: 60, ignition: true });
    fixes.push({ deviceId: DEV, recordedAt: at(131), latitude: 16.8 + 60 * 0.008993, longitude: 96.1, speedKmh: 0, ignition: false });
    await app.get(TelematicsService).ingest(fixes);

    await app.get(AnalyticsService).rollup('2026-03-09', '2026-03-10');
    const rows = await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.vehicleDailyStat.findMany({ where: { vehicleId: truck }, orderBy: { day: 'asc' } });
    });
    expect(rows.map((r) => r.day.toISOString().slice(0, 10))).toEqual(['2026-03-09', DAY]);
    const d = rows[1];
    expect(Number(d.distanceKm)).toBeCloseTo(60, 0);
    expect(d.engineMinutes).toBe(71); // 10 idle + 60 moving + 1 minute before engine-off fix
    expect(d.idleMinutes).toBe(11); // incl. the minute from the last idle fix to the first moving fix
    expect(d.movingMinutes).toBe(60);
    expect(d.maxSpeedKmh).toBe(60);
  });

  it('records expenses with validation and tenant isolation', async () => {
    await http().post('/api/expenses').set(auth(token)).send({ vehicleId: truck, category: 'TOLL', incurredAt: '2026-03-10T05:00:00Z', amount: 5000 }).expect(201);
    await http().post('/api/expenses').set(auth(token)).send({ vehicleId: truck, category: 'NOPE', incurredAt: '2026-03-10T05:00:00Z', amount: 1 }).expect(400);
    await http().post('/api/expenses').set(auth(tokenB)).send({ vehicleId: truck, category: 'TOLL', incurredAt: '2026-03-10T05:00:00Z', amount: 1 }).expect(400);
    await http().post('/api/expenses').set(auth(dispatcherToken)).send({}).expect(403);
    const list = await http().get('/api/expenses').set(auth(execToken)).expect(200);
    expect(list.body.total).toBe(1);
  });

  it('computes fleet KPIs for the period', async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.fuelRecord.create({
        data: { companyId: companyIds[0], vehicleId: truck, filledAt: new Date('2026-03-10T08:00:00Z'), odometerKm: 60, litres: 10, unitPrice: 2500, totalCost: 25_000, distanceKm: 60, kmPerLitre: 6 },
      });
    });
    const res = await http().get(`/api/analytics/overview?from=${DAY}&to=${DAY}`).set(auth(execToken)).expect(200);
    const f = res.body.fleet;
    expect(f).toMatchObject({ vehicles: 2, days: 1, fuelCost: 25_000, otherCost: 5000, totalCost: 30_000, fuelKmPerLitre: 6, utilizationPct: 50 });
    expect(f.distanceKm).toBeCloseTo(60, 0);
    expect(f.costPerKm).toBeCloseTo(500, -1);
    const t = res.body.vehicles.find((v: { id: string }) => v.id === truck);
    expect(t).toMatchObject({ daysUsed: 1, utilizationPct: 100, otherCost: 5000 });
    expect(res.body.vehicles.find((v: { id: string }) => v.id === idle)).toMatchObject({ daysUsed: 0, costPerKm: null });
    expect(res.body.series).toEqual([expect.objectContaining({ day: DAY, fuelCost: 25_000, otherCost: 5000, activeVehicles: 1 })]);
    expect(res.body.expenseByCategory).toEqual({ TOLL: 5000 });

    await http().get(`/api/analytics/overview?from=${DAY}&to=2026-03-01`).set(auth(token)).expect(400);
    await http().get(`/api/analytics/overview?from=${DAY}&to=${DAY}`).set(auth(dispatcherToken)).expect(403);
    const b = await http().get(`/api/analytics/overview?from=${DAY}&to=${DAY}`).set(auth(tokenB)).expect(200);
    expect(b.body.fleet.vehicles).toBe(0);
  });

  it('exports CSV safely', async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.vehicle.update({ where: { id: idle }, data: { plateNumber: '=HYPERLINK("http://evil")' } });
    });
    const res = await http().get(`/api/analytics/vehicles.csv?from=${DAY}&to=${DAY}`).set(auth(token)).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toMatch(/^Vehicle,Class,Branch,Distance km/);
    expect(lines).toHaveLength(3);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('registers push devices per user', async () => {
    const tokenStr = `ExponentPushToken[${run}]`;
    await http().post('/api/notifications/devices').set(auth(token)).send({ pushToken: tokenStr, platform: 'android' }).expect(200);
    await http().post('/api/notifications/devices').set(auth(token)).send({ pushToken: tokenStr, platform: 'android' }).expect(200); // idempotent
    await http().post('/api/notifications/devices').set(auth(token)).send({ pushToken: 'x', platform: 'android' }).expect(400);
    await http().delete(`/api/notifications/devices/${encodeURIComponent(tokenStr)}`).set(auth(token)).expect(204);
  });

  it('exposes Prometheus metrics outside /api', async () => {
    const res = await http().get('/metrics').expect(200);
    expect(res.text).toContain('fms_http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/fms_positions_ingested_total \d+/);
    await http().get('/api/metrics').expect(404); // not routed under the public /api prefix
  });
});
