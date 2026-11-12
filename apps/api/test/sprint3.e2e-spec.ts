/**
 * Sprint 3: geofences, rules engine via real ingest, events, history, live WebSocket.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s3${Date.now().toString(36)}`;
const DEVICE = `DEV-${run}`;
const base = new Date(Date.now() - 60 * 60_000); // an hour ago
const at = (min: number) => new Date(base.getTime() + min * 60_000);

describe('Sprint 3 telematics (e2e)', () => {
  let app: INestApplication;
  let telematics: TelematicsService;
  let admin: PrismaClient;
  let token: string;
  let tokenB: string;
  let vehicleId: string;
  let url: string;
  const companyIds: string[] = [];

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S3 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({
          data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] },
        });
      }
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    telematics = app.get(TelematicsService);

    const login = async (email: string) =>
      (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
    token = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    vehicleId = (
      await http()
        .post('/api/vehicles')
        .set('Authorization', `Bearer ${token}`)
        .send({ plateNumber: `${run}-T1`, make: 'Isuzu', model: 'NPR', vehicleClass: 'TRUCK', gpsDeviceId: DEVICE })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of [
          'notifications',
          'telemetry_events',
          'vehicle_telemetry_state',
          'vehicle_last_positions',
          'vehicle_positions',
          'geofences',
          'vehicle_status_events',
          'vehicles',
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

  it('manages company telematics settings with defaults', async () => {
    const def = await http().get('/api/company/settings').set('Authorization', `Bearer ${token}`).expect(200);
    expect(def.body.telematics).toMatchObject({ speedLimitKmh: 80, idleMinutes: 10 });
    const res = await http()
      .patch('/api/company/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ telematics: { speedLimitKmh: 60, idleMinutes: 5 } })
      .expect(200);
    expect(res.body.telematics).toMatchObject({ speedLimitKmh: 60, idleMinutes: 5, offlineMinutes: 30 });
    await http().patch('/api/company/settings').set('Authorization', `Bearer ${token}`).send({ telematics: { speedLimitKmh: 999 } }).expect(400);
  });

  it('validates and creates geofences', async () => {
    await http()
      .post('/api/geofences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', shape: 'CIRCLE' })
      .expect(400);
    await http()
      .post('/api/geofences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Depot', category: 'WAREHOUSE', shape: 'CIRCLE', centerLat: 16.8, centerLng: 96.15, radiusM: 300, alertOnEnter: true })
      .expect(201);
    await http()
      .post('/api/geofences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Zone', shape: 'POLYGON', polygon: [[96.3, 16.9], [96.4, 16.9], [96.4, 17.0], [96.3, 17.0]], alertOnExit: true })
      .expect(201);
    const b = await http().get('/api/geofences').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(b.body).toHaveLength(0);
  });

  it('pushes live positions and events over WebSocket to the right company only', async () => {
    const connect = (t: string) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(url, { path: '/api/socket.io', auth: { token: t }, transports: ['websocket'] });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });
    const [a, b] = await Promise.all([connect(token), connect(tokenB)]);
    const bReceived: unknown[] = [];
    b.on('positions', (p) => bReceived.push(p));
    const gotPositions = new Promise<{ vehicleId: string }[]>((r) => a.once('positions', r));
    const gotEvents = new Promise<{ type: string }[]>((r) => a.on('events', (e) => e.some((x: { type: string }) => x.type === 'OVERSPEED') && r(e)));
    await new Promise((r) => setTimeout(r, 300)); // let joins settle

    // Drive: outside → into depot → speeding → slow → idle 6 min (engine on) → leave
    const track = [
      { min: 0, lat: 16.81, lng: 96.16, speed: 40, ign: true },
      { min: 1, lat: 16.8, lng: 96.15, speed: 20, ign: true }, // enter depot
      { min: 2, lat: 16.79, lng: 96.14, speed: 85, ign: true }, // exit depot + overspeed (limit 60)
      { min: 3, lat: 16.78, lng: 96.13, speed: 92, ign: true },
      { min: 4, lat: 16.77, lng: 96.12, speed: 50, ign: true }, // overspeed ends (<= 55)
      { min: 5, lat: 16.77, lng: 96.12, speed: 0, ign: true },
      { min: 11, lat: 16.77, lng: 96.12, speed: 0, ign: true }, // idle ≥ 5 min
      { min: 13, lat: 16.76, lng: 96.11, speed: 30, ign: true }, // idle ends
      { min: 14, lat: 16.76, lng: 96.11, speed: 0, ign: false },
    ];
    const stored = await telematics.ingest(
      track.map((p) => ({ deviceId: DEVICE, recordedAt: at(p.min), latitude: p.lat, longitude: p.lng, speedKmh: p.speed, ignition: p.ign })),
    );
    expect(stored).toBe(track.length);

    const positions = await gotPositions;
    expect(positions[0].vehicleId).toBe(vehicleId);
    await gotEvents;
    await new Promise((r) => setTimeout(r, 200));
    expect(bReceived).toHaveLength(0);
    a.disconnect();
    b.disconnect();
  });

  it('rejects WebSocket connections without a valid token', async () => {
    const s = io(url, { path: '/api/socket.io', auth: { token: 'nope' }, transports: ['websocket'] });
    await new Promise<void>((resolve) => s.on('disconnect', () => resolve()));
    s.close();
  });

  it('records the expected telemetry events', async () => {
    const res = await http().get(`/api/tracking/events?vehicleId=${vehicleId}&pageSize=50`).set('Authorization', `Bearer ${token}`).expect(200);
    const types = res.body.items.map((e: { type: string }) => e.type).reverse();
    // EXIT and OVERSPEED share a timestamp, so their relative order is not defined.
    expect(types[0]).toBe('GEOFENCE_ENTER');
    expect(types.slice(1, 3).sort()).toEqual(['GEOFENCE_EXIT', 'OVERSPEED']);
    expect(types[3]).toBe('IDLE');
    const over = res.body.items.find((e: { type: string }) => e.type === 'OVERSPEED');
    expect(over.data).toMatchObject({ limitKmh: 60, maxKmh: 92 });
    expect(new Date(over.endedAt)).toEqual(at(4));
    const idle = res.body.items.find((e: { type: string }) => e.type === 'IDLE');
    expect(idle.data).toMatchObject({ durationMin: 8 });
    expect(res.body.items[0].plateNumber).toBe(`${run}-T1`.toUpperCase());

    const all = await http().get(`/api/tracking/events?vehicleId=${vehicleId}&type=IGNITION_OFF`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(all.body.total).toBe(1);
  });

  it('notifies about overspeed and alerting geofences only', async () => {
    const res = await http().get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    const topics = res.body.map((n: { topic: string }) => n.topic).sort();
    // Depot alerts on enter only; exit is silent. Idle notifies.
    expect(topics).toEqual(['telematics.geofence_enter', 'telematics.idle', 'telematics.overspeed']);
  });

  it('is idempotent for re-delivered fixes', async () => {
    const stored = await telematics.ingest([{ deviceId: DEVICE, recordedAt: at(3), latitude: 16.78, longitude: 96.13, speedKmh: 92, ignition: true }]);
    expect(stored).toBe(1); // accepted, but ON CONFLICT DO NOTHING + rules ignore old fixes
    const res = await http().get(`/api/tracking/events?vehicleId=${vehicleId}`).set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(4);
  });

  it('returns history with a trip summary', async () => {
    const res = await http()
      .get(`/api/tracking/vehicles/${vehicleId}/history?from=${at(-1).toISOString()}&to=${at(20).toISOString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.points).toHaveLength(9);
    expect(res.body.summary.maxSpeedKmh).toBe(92);
    expect(res.body.summary.distanceKm).toBeGreaterThan(5);
    expect(res.body.events.map((e: { type: string }) => e.type)).toContain('OVERSPEED');
    await http()
      .get(`/api/tracking/vehicles/${vehicleId}/history?from=${at(-1).toISOString()}&to=${at(20).toISOString()}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('detects GPS offline and restoration', async () => {
    const n = await telematics.checkOffline(new Date(Date.now() + 2 * 60 * 60_000));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await telematics.checkOffline(new Date(Date.now() + 3 * 60 * 60_000))).toBe(0);
    await telematics.ingest([{ deviceId: DEVICE, recordedAt: new Date(), latitude: 16.7, longitude: 96.1, speedKmh: 10, ignition: true }]);
    const res = await http().get(`/api/tracking/events?vehicleId=${vehicleId}&pageSize=50`).set('Authorization', `Bearer ${token}`);
    const types = res.body.items.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['GPS_OFFLINE', 'GPS_RESTORED']));
    expect(res.body.items.find((e: { type: string }) => e.type === 'GPS_OFFLINE').endedAt).not.toBeNull();
  });
});
