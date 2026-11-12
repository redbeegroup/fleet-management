/**
 * Sprint 4: trips, availability, licence rules, concurrency, driver self-service, attendance.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s4${Date.now().toString(36)}`;
const H = 3_600_000;
const day0 = new Date(Date.now() + 2 * 86_400_000); // future windows
const at = (h: number) => new Date(day0.getTime() + h * H).toISOString();

describe('Sprint 4 dispatch (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let token: string;
  let tokenB: string;
  let driverToken: string;
  let otherDriverToken: string;
  const companyIds: string[] = [];
  let truck: string;
  let van: string;
  let heavyDriver: string; // class E, linked to driver login
  let carDriver: string; // class B, linked to other login

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S4 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      const u1 = await tx.user.create({ data: { companyId: a, email: `d1-${run}@e2e.local`, fullName: 'Heavy Driver', passwordHash, roles: ['DRIVER'] } });
      const u2 = await tx.user.create({ data: { companyId: a, email: `d2-${run}@e2e.local`, fullName: 'Car Driver', passwordHash, roles: ['DRIVER'] } });
      heavyDriver = (await tx.driver.create({
        data: { companyId: a, employeeNo: `${run}-1`, fullName: 'Heavy Driver', userId: u1.id, licenses: { create: { companyId: a, number: 'H1', licenseClass: 'B/E', expiresAt: new Date(Date.now() + 365 * 86_400_000) } } },
      })).id;
      carDriver = (await tx.driver.create({
        data: { companyId: a, employeeNo: `${run}-2`, fullName: 'Car Driver', userId: u2.id, licenses: { create: { companyId: a, number: 'C1', licenseClass: 'B', expiresAt: new Date(Date.now() + 365 * 86_400_000) } } },
      })).id;
      truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-TRK`, make: 'Hino', model: '500', vehicleClass: 'TRUCK', odometerKm: 1000, gpsDeviceId: `GPS-${run}` } })).id;
      van = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-VAN`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
    token = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    driverToken = await login(`d1-${run}@e2e.local`);
    otherDriverToken = await login(`d2-${run}@e2e.local`);
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of ['notifications', 'trip_status_events', 'trips', 'duty_sessions', 'company_counters', 'vehicle_positions', 'vehicle_last_positions',
          'vehicle_telemetry_state', 'telemetry_events', 'vehicle_status_events', 'vehicle_assignments', 'vehicles', 'driver_licenses', 'drivers', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  const trip = (h0: number, h1: number, extra: Record<string, unknown> = {}) => ({
    originName: 'Yangon depot',
    destinationName: 'Bago customer',
    plannedStart: at(h0),
    plannedEnd: at(h1),
    ...extra,
  });

  it('creates planned trips with sequential numbers and validates windows', async () => {
    const a = await http().post('/api/trips').set(auth(token)).send(trip(0, 2)).expect(201);
    const b = await http().post('/api/trips').set(auth(token)).send(trip(0, 2)).expect(201);
    expect(a.body.status).toBe('PLANNED');
    const n = (s: string) => Number(s.split('-').pop());
    expect(n(b.body.tripNo)).toBe(n(a.body.tripNo) + 1);
    await http().post('/api/trips').set(auth(token)).send(trip(2, 1)).expect(400);
    await http().post('/api/trips').set(auth(token)).send(trip(0, 1, { vehicleId: truck })).expect(400); // vehicle without driver
  });

  it('enforces licence class for heavy vehicles', async () => {
    const res = await http().post('/api/trips').set(auth(token)).send(trip(10, 12, { vehicleId: truck, driverId: carDriver })).expect(409);
    expect(res.body.reasons.join(' ')).toMatch(/requires licence class/);
    await http().post('/api/trips').set(auth(token)).send(trip(10, 12, { vehicleId: van, driverId: carDriver })).expect(201);
  });

  it('reports availability with reasons', async () => {
    const res = await http().get(`/api/dispatch/availability?from=${at(10.5)}&to=${at(11)}&vehicleId=${truck}`).set(auth(token)).expect(200);
    const v = res.body.vehicles.find((x: { id: string }) => x.id === van);
    expect(v.available).toBe(false);
    expect(v.reasons[0]).toMatch(/Booked on TRP-/);
    const cd = res.body.drivers.find((x: { id: string }) => x.id === carDriver);
    expect(cd.reasons.some((r: string) => /Booked/.test(r))).toBe(true);
    expect(cd.reasons.some((r: string) => /licence class/.test(r))).toBe(true);
    expect(res.body.drivers.find((x: { id: string }) => x.id === heavyDriver).available).toBe(true);
  });

  it('allows only one of two concurrent overlapping bookings', async () => {
    const t1 = (await http().post('/api/trips').set(auth(token)).send(trip(20, 23)).expect(201)).body.id;
    const t2 = (await http().post('/api/trips').set(auth(token)).send(trip(21, 24)).expect(201)).body.id;
    const results = await Promise.all([
      http().post(`/api/trips/${t1}/assign`).set(auth(token)).send({ vehicleId: truck, driverId: heavyDriver }),
      http().post(`/api/trips/${t2}/assign`).set(auth(token)).send({ vehicleId: truck, driverId: heavyDriver }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    // Back-to-back (touching) windows are fine.
    const t3 = (await http().post('/api/trips').set(auth(token)).send(trip(24, 25)).expect(201)).body.id;
    await http().post(`/api/trips/${t3}/assign`).set(auth(token)).send({ vehicleId: truck, driverId: heavyDriver }).expect(200);
  });

  it('runs the full lifecycle via the driver app with GPS distance and odometer', async () => {
    const t = (await http().post('/api/trips').set(auth(token)).send(trip(-48, -46, { vehicleId: truck, driverId: heavyDriver })).expect(201)).body;
    expect(t.status).toBe('ASSIGNED');

    // The driver was notified and sees the trip; the other driver does not.
    const notes = await http().get('/api/notifications').set(auth(driverToken)).expect(200);
    expect(notes.body.some((n: { title: string }) => n.title.includes(t.tripNo))).toBe(true);
    const mine = await http().get('/api/me/trips').set(auth(driverToken)).expect(200);
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(t.id);
    await http().post(`/api/me/trips/${t.id}/start`).set(auth(otherDriverToken)).send({}).expect(404);
    await http().post(`/api/trips/${t.id}/start`).set(auth(driverToken)).send({}).expect(403); // needs trip:write

    await http().post('/api/me/duty/start').set(auth(driverToken)).expect(201);
    await http().post('/api/me/duty/start').set(auth(driverToken)).expect(409);

    const startAt = new Date(Date.now() - 30 * 60_000);
    const started = await http().post(`/api/me/trips/${t.id}/start`).set(auth(driverToken)).send({ at: startAt.toISOString() }).expect(200);
    expect(started.body.status).toBe('ONGOING');
    expect(Number(started.body.startOdometerKm)).toBe(1000);
    let v = await http().get(`/api/vehicles/${truck}`).set(auth(token));
    expect(v.body.status).toBe('OPERATING');

    // ~11 km of GPS track during the trip
    const telematics = app.get(TelematicsService);
    await telematics.ingest(
      Array.from({ length: 11 }, (_, i) => ({
        deviceId: `GPS-${run}`,
        recordedAt: new Date(startAt.getTime() + (i + 1) * 60_000),
        latitude: 16.8 + i * 0.009,
        longitude: 96.15,
        speedKmh: 50,
        ignition: true,
      })),
    );
    const done = await http().post(`/api/me/trips/${t.id}/complete`).set(auth(driverToken)).send({}).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(Number(done.body.gpsDistanceKm)).toBeCloseTo(10, 0);
    expect(Number(done.body.endOdometerKm)).toBeCloseTo(1010, 0);
    v = await http().get(`/api/vehicles/${truck}`).set(auth(token));
    expect(v.body.status).toBe('AVAILABLE');
    expect(Number(v.body.odometerKm)).toBeCloseTo(1010, 0);

    const detail = await http().get(`/api/trips/${t.id}`).set(auth(token)).expect(200);
    expect(detail.body.statusHistory.map((e: { toStatus: string }) => e.toStatus)).toEqual(['PLANNED', 'ASSIGNED', 'ONGOING', 'COMPLETED']);
    await http().post(`/api/trips/${t.id}/cancel`).set(auth(token)).send({ reason: 'too late' }).expect(400);

    const hist = await http().get(`/api/vehicles/${truck}/history`).set(auth(token));
    expect(hist.body.some((e: { kind: string; summary: string }) => e.kind === 'trip' && e.summary.includes(t.tripNo))).toBe(true);
  });

  it('records attendance', async () => {
    await http().post('/api/me/duty/end').set(auth(driverToken)).expect(200);
    const today = new Date(Date.now() + 6.5 * H).toISOString().slice(0, 10); // company tz Asia/Yangon
    const res = await http().get(`/api/dispatch/attendance?day=${today}`).set(auth(token)).expect(200);
    const d = res.body.drivers.find((x: { id: string }) => x.id === heavyDriver);
    expect(d).toMatchObject({ present: true, onDutyNow: false, completedTrips: 1 });
    expect(res.body.drivers.find((x: { id: string }) => x.id === carDriver).present).toBe(false);
    await http().post(`/api/drivers/${carDriver}/duty`).set(auth(token)).send({ action: 'start' }).expect(201);
  });

  it('cancels and unassigns, and blocks cross-tenant access', async () => {
    const t = (await http().post('/api/trips').set(auth(token)).send(trip(30, 31, { vehicleId: van, driverId: carDriver })).expect(201)).body;
    const un = await http().delete(`/api/trips/${t.id}/assign`).set(auth(token)).expect(200);
    expect(un.body).toMatchObject({ status: 'PLANNED', vehicleId: null, driverId: null });
    await http().post(`/api/trips/${t.id}/cancel`).set(auth(token)).send({ reason: 'x' }).expect(400); // reason too short
    await http().post(`/api/trips/${t.id}/cancel`).set(auth(token)).send({ reason: 'Customer closed' }).expect(200);
    await http().get(`/api/trips/${t.id}`).set(auth(tokenB)).expect(404);
    await http().post(`/api/trips/${t.id}/assign`).set(auth(tokenB)).send({ vehicleId: van, driverId: carDriver }).expect(404);
    const list = await http().get('/api/trips').set(auth(tokenB)).expect(200);
    expect(list.body.total).toBe(0);
  });

  it('rejects vehicles under repair', async () => {
    await http().post(`/api/vehicles/${van}/status`).set(auth(token)).send({ status: 'UNDER_REPAIR' }).expect(200);
    const res = await http().post('/api/trips').set(auth(token)).send(trip(40, 41, { vehicleId: van, driverId: carDriver })).expect(409);
    expect(res.body.reasons).toContain('Vehicle is under repair');
  });
});
