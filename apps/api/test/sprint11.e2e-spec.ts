/**
 * Sprint 11: OSRM/VROOM routing (fake engine) with straight-line fallback, proof of delivery,
 * customer returns, warehouse check-in, delivery KPIs.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { resetEnvCache } from '../src/common/config/env';
import { localDate } from '../src/common/time';
import { WebhooksService } from '../src/modules/integrations/webhooks.service';

const PASSWORD = 'E2ePassword123!';
const run = `s11${Date.now().toString(36)}`;
const D = localDate(new Date(), 'Asia/Yangon'); // today: trips run and complete now
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('Sprint 11 routing, POD, returns, check-in, KPIs (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let engine: Server;
  let hooks: Server;
  let engineDown = false;
  const engineCalls: string[] = [];
  const events: { event: string; body: Record<string, unknown> }[] = [];
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  let apiKey: string;
  let depot: string;
  let v1: string;
  let v2: string;
  const drivers: string[] = [];
  const ids: Record<string, string> = {};
  let load1: { tripId: string; stops: { id: string; name: string; plannedArrival: string; orders: { id: string }[] }[] };

  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const order = (cust: string, lat: number, over: Record<string, unknown> = {}) => ({
    customer: { code: `${run}-${cust}`, name: `Shop ${cust}`, city: 'Yangon', latitude: lat, longitude: 96.15 },
    depotCode: `Y${run}`,
    deliveryDate: D,
    lines: [{ sku: 'WATER', quantity: 10, uom: 'CTN', weightKg: 100 }],
    ...over,
  });

  beforeAll(async () => {
    // Fake OSRM + vroom-express: VROOM returns the jobs in reverse order, OSRM a fixed 12.3 km route.
    engine = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        engineCalls.push(`${req.method} ${req.url?.split('?')[0].split('/').slice(0, 4).join('/')}`);
        res.setHeader('content-type', 'application/json');
        if (engineDown) {
          res.statusCode = 503;
          return res.end('{}');
        }
        if (req.method === 'POST') {
          const p = JSON.parse(body) as { vehicles: { id: number; time_window: number[] }[]; jobs: { id: number }[] };
          const t0 = p.vehicles[0].time_window[0];
          const jobs = [...p.jobs].reverse();
          return res.end(
            JSON.stringify({
              code: 0,
              routes: [
                {
                  vehicle: p.vehicles[0].id,
                  distance: 21400,
                  duration: 2700,
                  service: 900 * jobs.length,
                  geometry: 'ofx_BoyqmQ??',
                  steps: [{ type: 'start', arrival: t0 }, ...jobs.map((j, i) => ({ type: 'job', id: j.id, arrival: t0 + 900 * (i + 1) })), { type: 'end', arrival: t0 + 9999 }],
                },
              ],
              unassigned: [],
            }),
          );
        }
        if (req.url?.startsWith('/route/')) {
          const n = req.url.split('/')[4].split('?')[0].split(';').length - 1;
          return res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 12300, duration: 1800, geometry: 'abc', legs: Array.from({ length: n }, () => ({ distance: 12300 / n, duration: 1800 / n })) }] }));
        }
        res.end(JSON.stringify({ code: 'Ok' }));
      });
    });
    await new Promise<void>((r) => engine.listen(0, '127.0.0.1', r));
    const ePort = (engine.address() as AddressInfo).port;
    hooks = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        events.push({ event: String(req.headers['x-fms-event']), body: JSON.parse(body) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => hooks.listen(0, '127.0.0.1', r));
    process.env.OSRM_URL = `http://127.0.0.1:${ePort}`;
    process.env.VROOM_URL = `http://127.0.0.1:${ePort}/`;
    process.env.WEBHOOK_ALLOW_INSECURE = 'true';
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    resetEnvCache();

    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S11 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      depot = (await tx.branch.create({ data: { companyId: a, code: `Y${run}`, name: 'Yangon DC', latitude: 16.8, longitude: 96.15 } })).id;
      await tx.user.create({ data: { companyId: a, email: `m-${run}@e2e.local`, fullName: 'Manager', passwordHash, roles: ['FLEET_MANAGER'] } });
      await tx.user.create({ data: { companyId: a, email: `p-${run}@e2e.local`, fullName: 'Dispatcher', passwordHash, roles: ['DISPATCHER'] } });
      for (const i of [1, 2]) {
        const u = await tx.user.create({ data: { companyId: a, email: `d${i}-${run}@e2e.local`, fullName: `Driver ${i}`, passwordHash, roles: ['DRIVER'] } });
        drivers.push((await tx.driver.create({
          data: { companyId: a, employeeNo: `${run}-${i}`, fullName: `Driver ${i}`, userId: u.id, licenses: { create: { companyId: a, number: `L${i}`, licenseClass: 'E', expiresAt: new Date(Date.now() + 365 * 86_400_000) } } },
        })).id);
      }
      v1 = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V1`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', branchId: depot, capacityKg: 2000 } })).id;
      v2 = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V2`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', branchId: depot, capacityKg: 2000 } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'm', 'p', 'd1', 'd2']) t[k] = (await http().post('/api/auth/login').send({ email: `${k}-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
    apiKey = (await http().post('/api/integrations/api-keys').set(auth('a')).send({ name: 'DMS', scopes: ['orders:write', 'orders:read'] }).expect(201)).body.key;
    await http()
      .post('/api/integrations/webhooks')
      .set(auth('a'))
      .send({ url: `http://127.0.0.1:${(hooks.address() as AddressInfo).port}/h`, events: ['order.delivered', 'return.collected', 'load.checked_in'] })
      .expect(201);
    const put = (ref: string, body: Record<string, unknown>) => http().put(`/api/integrations/v1/orders/${run}-${ref}`).set('X-API-Key', apiKey).send(body).expect(201);
    await put('O1', order('C1', 16.81, { codAmount: 50_000 }));
    await put('O2', order('C2', 16.82));
    await put('O3', order('C3', 16.83));
    await put('O4', order('C4', 16.84));
    for (const r of ['O1', 'O2', 'O3', 'O4']) ids[r] = (await http().get(`/api/integrations/v1/orders/${run}-${r}`).set('X-API-Key', apiKey).expect(200)).body.fmsId;
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`UPDATE delivery_orders SET trip_id = NULL, stop_id = NULL WHERE company_id = $1::uuid`, companyId);
        for (const tbl of ['delivery_returns', 'trip_stops', 'webhook_deliveries', 'webhook_endpoints', 'delivery_order_lines', 'delivery_orders', 'customers', 'api_keys', 'files', 'notifications',
          'trip_status_events', 'trips', 'vehicle_status_events', 'vehicles', 'driver_licenses', 'drivers', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    await new Promise((r) => engine.close(r));
    await new Promise((r) => hooks.close(r));
    delete process.env.OSRM_URL;
    delete process.env.VROOM_URL;
    resetEnvCache();
  });

  it('plans a load with VROOM order, ETAs and road distance', async () => {
    const st = await http().get('/api/routing/status').set(auth('p')).expect(200);
    expect(st.body).toMatchObject({ configured: true, osrm: true, source: 'osrm' });
    const r = await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: depot, vehicleId: v1, driverId: drivers[0], orderIds: [ids.O1, ids.O2, ids.O3] }).expect(201);
    load1 = r.body;
    expect(r.body).toMatchObject({ routingSource: 'osrm', plannedKm: 21.4, plannedMinutes: 90, routeGeometry: 'ofx_BoyqmQ??' });
    // The fake engine reverses the job order, proving the VROOM sequence is used.
    expect(r.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C3', 'Shop C2', 'Shop C1']);
    expect(new Date(r.body.stops[1].plannedArrival).getTime() - new Date(r.body.stops[0].plannedArrival).getTime()).toBe(900_000);
    // Manual reorder → OSRM route for the given order (no re-optimisation).
    const re = await http()
      .patch(`/api/logistics/loads/${load1.tripId}`)
      .set(auth('p'))
      .send({ stopIds: [...r.body.stops].reverse().map((s: { id: string }) => s.id) })
      .expect(200);
    expect(re.body).toMatchObject({ routingSource: 'osrm', plannedKm: 12.3 });
    expect(re.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C1', 'Shop C2', 'Shop C3']);
    expect(engineCalls.some((c) => c.startsWith('GET /route/v1'))).toBe(true);
    load1 = re.body;
  });

  it('falls back to straight lines when the engine is down', async () => {
    engineDown = true;
    const r = await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: depot, vehicleId: v2, driverId: drivers[1], orderIds: [ids.O4] }).expect(201);
    expect(r.body).toMatchObject({ routingSource: 'straight-line' });
    expect(r.body.plannedKm).toBe(8.8); // 4.4 km each way (0.04° of latitude)
    expect((await http().get('/api/routing/status').set(auth('p')).expect(200)).body).toMatchObject({ osrm: false, source: 'straight-line' });
    engineDown = false;
    // Dispatch may record an outcome without driver evidence; it is flagged as such.
    await http().post(`/api/trips/${r.body.tripId}/start`).set(auth('p')).send({}).expect(200);
    const s = await http().post(`/api/logistics/stops/${r.body.stops[0].id}/status`).set(auth('p')).send({ outcome: 'DELIVERED' }).expect(200);
    expect(s.body.podFlags).toEqual(['RECORDED_BY_DISPATCH']);
    await http().post(`/api/logistics/loads/${r.body.tripId}/check-in`).set(auth('p')).send({ lines: [] }).expect(400); // trip not completed
  });

  it('requires proof of delivery from the driver and flags anomalies', async () => {
    const [s1, s2, s3] = load1.stops;
    await http().post(`/api/me/trips/${load1.tripId}/start`).set(auth('d1')).send({}).expect(200);
    const missing = await http().post(`/api/me/trips/${load1.tripId}/stops/${s1.id}/complete`).set(auth('d1')).send({ outcome: 'DELIVERED' }).expect(400);
    expect(missing.body.errors.map((e: { message: string }) => e.message)).toEqual(['Take at least one photo of the delivery', 'Enter the cash collected']);
    const photo = (await http().post('/api/files').set(auth('d1')).attach('file', PNG, { filename: 'pod.png', contentType: 'image/png' }).expect(201)).body.id;
    const otherPhoto = (await http().post('/api/files').set(auth('b')).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201)).body.id;
    await http()
      .post(`/api/me/trips/${load1.tripId}/stops/${s1.id}/complete`)
      .set(auth('d1'))
      .send({ outcome: 'DELIVERED', photoFileIds: [otherPhoto], codCollected: 1 })
      .expect(400); // another tenant's file
    const done = await http()
      .post(`/api/me/trips/${load1.tripId}/stops/${s1.id}/complete`)
      .set(auth('d1'))
      .send({ outcome: 'DELIVERED', photoFileIds: [photo], latitude: 16.83, longitude: 96.15, accuracyM: 8, codCollected: 45_000 })
      .expect(200);
    expect(done.body).toMatchObject({ podFlags: ['FAR_FROM_CUSTOMER', 'COD_SHORT'], podDistanceM: 2224, codCollected: '45000' });

    // Customer hands goods back at stop 1.
    const ret = await http()
      .post(`/api/me/trips/${load1.tripId}/stops/${s1.id}/returns`)
      .set(auth('d1'))
      .send({ orderId: ids.O1, sku: 'WATER', quantity: 2, uom: 'CTN', reason: 'Damaged cartons' })
      .expect(201);
    expect(ret.body).toMatchObject({ quantity: 2 });
    await http().post(`/api/logistics/stops/${s1.id}/returns`).set(auth('b')).send({ sku: 'X', quantity: 1, reason: 'test' }).expect(404);

    // Signature becomes mandatory.
    await http().patch('/api/company/settings').set(auth('a')).send({ pod: { requireSignature: true } }).expect(200);
    const stroke = [[0.1, 0.1], [0.5, 0.6], [0.9, 0.2]];
    await http()
      .post(`/api/me/trips/${load1.tripId}/stops/${s2.id}/complete`)
      .set(auth('d1'))
      .send({ outcome: 'PARTIAL', photoFileIds: [photo], latitude: 16.82, longitude: 96.15, deliveredLines: [{ orderId: s2.orders[0].id, lineNo: 1, quantity: 7 }] })
      .expect(400);
    const p = await http()
      .post(`/api/me/trips/${load1.tripId}/stops/${s2.id}/complete`)
      .set(auth('d1'))
      .send({ outcome: 'PARTIAL', photoFileIds: [photo], latitude: 16.82, longitude: 96.15, signature: { name: 'Daw Hla', strokes: [stroke] }, deliveredLines: [{ orderId: s2.orders[0].id, lineNo: 1, quantity: 7 }] })
      .expect(200);
    expect(p.body).toMatchObject({ podSignedBy: 'Daw Hla', podFlags: [], podDistanceM: 0 });
    await http().post(`/api/me/trips/${load1.tripId}/stops/${s3.id}/complete`).set(auth('d1')).send({ outcome: 'FAILED', reason: 'Customer closed' }).expect(200); // no evidence needed
    await http().post(`/api/me/trips/${load1.tripId}/complete`).set(auth('d1')).send({}).expect(200);

    const exc = await http().get(`/api/logistics/pod-exceptions?from=${D}&to=${D}`).set(auth('p')).expect(200);
    expect(exc.body.map((e: { name: string }) => e.name).sort()).toEqual(['Shop C1', 'Shop C3', 'Shop C4'].sort()); // C3 failed without GPS
  });

  it('checks goods and cash back into the depot', async () => {
    const exp = (await http().get(`/api/logistics/loads/${load1.tripId}/check-in`).set(auth('m')).expect(200)).body;
    expect(exp.cashExpected).toBe(45_000);
    expect(exp.expected.map((e: { kind: string; sku: string; expectedQty: number }) => [e.kind, e.expectedQty])).toEqual([
      ['UNDELIVERED', 3],
      ['UNDELIVERED', 10],
      ['CUSTOMER_RETURN', 2],
    ]);
    await http().post(`/api/logistics/loads/${load1.tripId}/check-in`).set(auth('d1')).send({ lines: [] }).expect(403);
    await http().post(`/api/logistics/loads/${load1.tripId}/check-in`).set(auth('m')).send({ lines: [{ key: 'nope', receivedQty: 1 }] }).expect(400);
    const lines = exp.expected.map((e: { key: string; expectedQty: number }, i: number) => ({ key: e.key, receivedQty: i === 1 ? 9 : e.expectedQty }));
    const r = await http().post(`/api/logistics/loads/${load1.tripId}/check-in`).set(auth('m')).send({ lines, cashReceived: 44_000 }).expect(200);
    expect(r.body.checkIn).toMatchObject({ ok: false, shortages: 1, overages: 0, cashDiff: -1000 });
    await http().post(`/api/logistics/loads/${load1.tripId}/check-in`).set(auth('m')).send({ lines }).expect(409);
    const notes = await http().get('/api/notifications').set(auth('a')).expect(200);
    expect(notes.body.some((n: { topic: string }) => n.topic === 'logistics.checkin_difference')).toBe(true);

    await app.get(WebhooksService).dispatchDue(100);
    const ev = (name: string) => events.filter((e) => e.event === name);
    expect(ev('return.collected')[0].body.data).toMatchObject({ sku: 'WATER', quantity: 2, reason: 'Damaged cartons', orderExternalRef: `${run}-O1` });
    expect(ev('load.checked_in')[0].body.data).toMatchObject({ ok: false, shortages: 1, cashDiff: -1000 });
    expect(ev('order.delivered').find((e) => e.body.data && (e.body.data as { externalRef: string }).externalRef === `${run}-O1`)!.body.data).toMatchObject({ pod: { photos: 1, codCollected: 45_000, flags: ['FAR_FROM_CUSTOMER', 'COD_SHORT'] } });
  });

  it('reports delivery KPIs', async () => {
    const k = await http().get(`/api/analytics/delivery?from=${D}&to=${D}&branchId=${depot}`).set(auth('p')).expect(200);
    expect(k.body.totals).toMatchObject({ trips: 2, attempted: 4, delivered: 2, partial: 1, failed: 1, successRatePct: 75, drops: 3 });
    const trip = k.body.trips.find((x: { tripId: string }) => x.tripId === load1.tripId);
    expect(trip).toMatchObject({ orders: 3, plannedKm: 12.3, sequencePct: 100, fillPct: 15 }); // 300 of 2000 kg
    expect(k.body.drivers).toHaveLength(2);
    expect(k.body.failureReasons ?? k.body.totals.failureReasons).toMatchObject({ 'Customer closed': 1 });
    const csv = await http().get(`/api/analytics/delivery.csv?from=${D}&to=${D}`).set(auth('p')).expect(200);
    expect(csv.text.split('\n')[0]).toContain('tripNo,vehicle,driver');
    expect((await http().get(`/api/analytics/delivery?from=${D}&to=${D}`).set(auth('b')).expect(200)).body.totals.trips).toBe(0);
    await http().get(`/api/analytics/delivery?from=${D}&to=${D}`).set(auth('d1')).expect(403);
  });
});
