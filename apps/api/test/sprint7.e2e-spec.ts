/**
 * Sprint 7: harsh events from GPS with driver attribution, safety scores, incidents & insurance claims.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { localDate } from '../src/common/time';
import { TelematicsService } from '../src/modules/telematics/telematics.service';
import { SafetyService } from '../src/modules/safety/safety.service';

const PASSWORD = 'E2ePassword123!';
const run = `s7${Date.now().toString(36)}`;
const DEV = `S7-${run}`;
// Yesterday (company-local) so the driver's own 30-day window covers it.
const t0 = new Date(Date.now() - 86_400_000);
t0.setUTCSeconds(0, 0);
const DAY = localDate(t0, 'Asia/Yangon');
const sec = (s: number) => new Date(t0.getTime() + s * 1000);

describe('Sprint 7 safety (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let token: string;
  let tokenB: string;
  let driverToken: string;
  let viewerToken: string;
  const companyIds: string[] = [];
  let truck: string;
  let van: string;
  let driver: string;
  let other: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S7 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      const du = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Safe Driver', passwordHash, roles: ['DRIVER'] } });
      await tx.user.create({ data: { companyId: a, email: `v-${run}@e2e.local`, fullName: 'Exec', passwordHash, roles: ['EXECUTIVE'] } });
      driver = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-1`, fullName: 'Safe Driver', userId: du.id } })).id;
      other = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-2`, fullName: 'Idle Driver' } })).id;
      truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-T`, make: 'Hino', model: '300', vehicleClass: 'TRUCK', gpsDeviceId: DEV } })).id;
      van = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN' } })).id;
      await tx.vehicleAssignment.create({ data: { companyId: a, vehicleId: truck, driverId: driver, startAt: new Date(t0.getTime() - 10 * 86_400_000) } });
      await tx.vehicleDocument.create({
        data: { companyId: a, vehicleId: truck, type: 'INSURANCE', number: 'POL-777', issuer: 'Myanma Insurance', expiresAt: new Date(Date.now() + 200 * 86_400_000) },
      });
      // 100 km driven that day (the score needs >= 50 km).
      await tx.vehicleDailyStat.create({ data: { companyId: a, vehicleId: truck, day: new Date(DAY), distanceKm: 100, engineMinutes: 120, movingMinutes: 110, idleMinutes: 10, maxSpeedKmh: 70 } });
      await tx.$executeRaw`SELECT fms_ensure_position_partition(${DAY}::date)`;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
    token = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    driverToken = await login(`d-${run}@e2e.local`);
    viewerToken = await login(`v-${run}@e2e.local`);
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of ['insurance_claims', 'incidents', 'notifications', 'vehicle_daily_stats', 'telemetry_events', 'vehicle_telemetry_state', 'vehicle_last_positions',
          'vehicle_positions', 'vehicle_status_events', 'vehicle_documents', 'vehicle_assignments', 'vehicles', 'drivers', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('detects harsh braking from GPS and device events, attributed to the assigned driver', async () => {
    const fix = (s: number, speedKmh: number, extra: Record<string, unknown> = {}) => ({ deviceId: DEV, recordedAt: sec(s), latitude: 16.8 + s * 0.0001, longitude: 96.1, speedKmh, heading: 0, ignition: true, ...extra });
    await app.get(TelematicsService).ingest([
      fix(0, 40),
      fix(2, 58), // +9 km/h/s — below the 10 km/h/s threshold
      fix(4, 28), // −15 km/h/s → HARSH_BRAKE
      fix(60, 30), // gap 56 s > 15 s: a big drop is ignored
      fix(62, 30, { attributes: { event: 'harsh_acceleration' } }), // device event
    ]);
    // Sparse drop after a long gap is not flagged.
    await app.get(TelematicsService).ingest([fix(120, 0)]);
    const events = await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.telemetryEvent.findMany({ where: { vehicleId: truck, type: { in: ['HARSH_BRAKE', 'HARSH_ACCEL', 'HARSH_CORNER'] } }, orderBy: { occurredAt: 'asc' } });
    });
    expect(events.map((e) => e.type)).toEqual(['HARSH_BRAKE', 'HARSH_ACCEL']);
    expect(events.every((e) => e.driverId === driver)).toBe(true);
    expect(events[0].data).toMatchObject({ source: 'gps', unit: 'km/h/s', value: 15 });
    expect(events[1].data).toMatchObject({ source: 'device' });
  });

  it('scores drivers per 100 km with tenant isolation and permissions', async () => {
    const res = await http().get(`/api/safety/scores?from=${DAY}&to=${DAY}`).set(auth(token)).expect(200);
    const d = res.body.drivers.find((x: { id: string }) => x.id === driver);
    // defaults: brake 4 + accel 3 points per event, per 100 km
    expect(d).toMatchObject({ distanceKm: 100, harshBrake: 1, harshAccel: 1, score: 93, band: 'GOOD' });
    expect(res.body.drivers.find((x: { id: string }) => x.id === other)).toMatchObject({ distanceKm: 0, score: null, band: 'INSUFFICIENT_DATA' });
    expect(res.body.fleet).toMatchObject({ drivers: 2, scoredDrivers: 1, averageScore: 93, belowThreshold: 0 });
    expect(res.body.drivers[0].id).toBe(driver); // scored drivers first

    const card = await http().get(`/api/safety/drivers/${driver}?from=${DAY}&to=${DAY}`).set(auth(viewerToken)).expect(200);
    expect(card.body.recentEvents).toHaveLength(2);
    expect(card.body.recentEvents[0].plateNumber).toBe(`${run}-T`);

    await http().get(`/api/safety/scores?from=${DAY}&to=2020-01-01`).set(auth(token)).expect(400);
    await http().get(`/api/safety/scores?from=${DAY}&to=${DAY}`).set(auth(driverToken)).expect(403);
    await http().get(`/api/safety/drivers/${driver}?from=${DAY}&to=${DAY}`).set(auth(tokenB)).expect(404);
    const b = await http().get(`/api/safety/scores?from=${DAY}&to=${DAY}`).set(auth(tokenB)).expect(200);
    expect(b.body.drivers).toHaveLength(0);

    const mine = await http().get('/api/me/safety').set(auth(driverToken)).expect(200);
    expect(mine.body).toMatchObject({ id: driver, score: 93 });
  });

  it('alerts managers about low scores once per week', async () => {
    await http().patch('/api/company/settings').set(auth(token)).send({ safety: { alertBelow: 95, weights: { harshBrake: 4 } } }).expect(200);
    const s = app.get(SafetyService);
    await s.lowScoreAlerts(new Date(t0.getTime() + 3_600_000));
    await s.lowScoreAlerts(new Date(t0.getTime() + 3_600_000));
    const notes = await http().get('/api/notifications').set(auth(token)).expect(200);
    const low = notes.body.filter((n: { topic: string }) => n.topic === 'safety.low_score');
    expect(low).toHaveLength(1);
    expect(low[0].title).toContain('Safe Driver');
    const org = await http().get('/api/company/settings').set(auth(token)).expect(200);
    expect(org.body.safety).toMatchObject({ alertBelow: 95, minDistanceKm: 50, weights: { harshBrake: 4, harshAccel: 3 } });
  });

  it('runs the incident → investigation → claim lifecycle', async () => {
    // Driver reports from the app: driver is forced to self, vehicle must be theirs.
    await http().post('/api/me/incidents').set(auth(driverToken)).send({ vehicleId: van, type: 'COLLISION', occurredAt: t0.toISOString(), description: 'Not my van' }).expect(400);
    const rep = await http()
      .post('/api/me/incidents')
      .set(auth(driverToken))
      .send({ vehicleId: truck, driverId: other, type: 'COLLISION', severity: 'HIGH', occurredAt: t0.toISOString(), description: 'Rear-ended at a junction', injuries: false, estimatedCost: 800_000 })
      .expect(201);
    expect(rep.body).toMatchObject({ driverId: driver, status: 'REPORTED' });
    expect(rep.body.incidentNo).toMatch(/^INC-\d{4}-000001$/);
    const mine = await http().get('/api/me/incidents').set(auth(driverToken)).expect(200);
    expect(mine.body.items).toHaveLength(1);
    const notes = await http().get('/api/notifications').set(auth(token)).expect(200);
    expect(notes.body.some((n: { topic: string }) => n.topic === 'safety.incident')).toBe(true);

    // Manager-reported incident defaults the driver from the standing assignment.
    const mgr = await http().post('/api/incidents').set(auth(token)).send({ vehicleId: truck, type: 'DAMAGE', occurredAt: t0.toISOString(), description: 'Scratched mirror' }).expect(201);
    expect(mgr.body).toMatchObject({ driverId: driver, incidentNo: expect.stringMatching(/000002$/) });

    const id = rep.body.id as string;
    await http().patch(`/api/incidents/${id}`).set(auth(token)).send({ status: 'CLOSED' }).expect(400); // findings required
    await http().patch(`/api/incidents/${id}`).set(auth(token)).send({ status: 'INVESTIGATING' }).expect(200);
    await http().patch(`/api/incidents/${id}`).set(auth(driverToken)).send({ status: 'CLOSED' }).expect(403);
    await http().patch(`/api/incidents/${id}`).set(auth(tokenB)).send({ status: 'CLOSED' }).expect(404);

    const claim = await http().post(`/api/incidents/${id}/claims`).set(auth(token)).send({ amountClaimed: 800_000 }).expect(201);
    expect(claim.body).toMatchObject({ status: 'SUBMITTED', insurer: 'Myanma Insurance', policyNo: 'POL-777' });
    expect(claim.body.claimNo).toMatch(/^CLM-\d{4}-000001$/);
    const cid = claim.body.id as string;
    await http().patch(`/api/claims/${cid}`).set(auth(token)).send({ status: 'SETTLED', amountPaid: 1 }).expect(400); // must be approved first
    await http().patch(`/api/claims/${cid}`).set(auth(token)).send({ status: 'APPROVED' }).expect(400); // amount needed
    await http().patch(`/api/claims/${cid}`).set(auth(token)).send({ status: 'APPROVED', amountApproved: 900_000 }).expect(400); // > claimed
    await http().patch(`/api/claims/${cid}`).set(auth(token)).send({ status: 'APPROVED', amountApproved: 700_000 }).expect(200);
    const settled = await http().patch(`/api/claims/${cid}`).set(auth(token)).send({ status: 'SETTLED', amountPaid: 700_000 }).expect(200);
    expect(settled.body.settledAt).toBeTruthy();
    await http().patch(`/api/claims/${cid}`).set(auth(tokenB)).send({ notes: 'x' }).expect(404);

    const closed = await http().patch(`/api/incidents/${id}`).set(auth(token)).send({ status: 'CLOSED', findings: 'Third party at fault', correctiveActions: 'Defensive driving refresher' }).expect(200);
    expect(closed.body.closedAt).toBeTruthy();
    expect(closed.body.claims).toHaveLength(1);

    const list = await http().get('/api/incidents?status=CLOSED').set(auth(viewerToken)).expect(200);
    expect(list.body.total).toBe(1);
    expect((await http().get('/api/incidents').set(auth(tokenB)).expect(200)).body.total).toBe(0);
    expect((await http().get('/api/claims').set(auth(token)).expect(200)).body).toHaveLength(1);
    await http().post('/api/incidents').set(auth(viewerToken)).send({}).expect(403);
  });
});
