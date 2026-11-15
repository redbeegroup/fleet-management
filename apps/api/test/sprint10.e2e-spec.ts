/**
 * Sprint 10: delivery planning — depots, capacity, loads, multi-stop trips, driver stop outcomes, manifests.
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
const run = `s10${Date.now().toString(36)}`;
const D = localDate(new Date(Date.now() + 86_400_000), 'Asia/Yangon'); // tomorrow, company-local

describe('Sprint 10 delivery planning (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let server: Server;
  const events: string[] = [];
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  let apiKey: string;
  let ygn: string;
  let mdy: string;
  let van1: string;
  let van2: string;
  let van3: string;
  const drivers: string[] = [];
  const ids: Record<string, string> = {}; // externalRef suffix → order id
  let loadId: string;

  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const put = (ref: string, body: Record<string, unknown>) => http().put(`/api/integrations/v1/orders/${run}-${ref}`).set('X-API-Key', apiKey).send(body);
  const order = (cust: string, township: string, lat: number, over: Record<string, unknown> = {}) => ({
    customer: { code: `${run}-${cust}`, name: `Shop ${cust}`, township, city: 'Yangon', latitude: lat, longitude: 96.13, phone: '+95 9 1' },
    depotCode: `Y${run}`,
    deliveryWindow: { start: `${D}T03:00:00Z`, end: `${D}T08:00:00Z` },
    codAmount: 10_000,
    lines: [
      { sku: 'WATER', quantity: 10, uom: 'CTN', weightKg: 100, volumeM3: 0.5, cases: 10, pallets: 0.5 },
      { sku: 'RICE', quantity: 4, uom: 'BAG', weightKg: 40, cases: 4 },
    ],
    ...over,
  });
  const dispatch = () => app.get(WebhooksService).dispatchDue(200);
  const getOrder = async (ref: string) => (await http().get(`/api/integrations/v1/orders/${run}-${ref}`).set('X-API-Key', apiKey).expect(200)).body;

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE = 'true';
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    resetEnvCache();
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        events.push(String(req.headers['x-fms-event']));
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S10 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      ygn = (await tx.branch.create({ data: { companyId: a, code: `Y${run}`, name: 'Yangon DC', latitude: 16.8, longitude: 96.13 } })).id;
      mdy = (await tx.branch.create({ data: { companyId: a, code: `M${run}`, name: 'Mandalay DC' } })).id;
      await tx.user.create({ data: { companyId: a, email: `p-${run}@e2e.local`, fullName: 'Dispatcher', passwordHash, roles: ['DISPATCHER'] } });
      for (const i of [1, 2, 3]) {
        const u = await tx.user.create({ data: { companyId: a, email: `d${i}-${run}@e2e.local`, fullName: `Driver ${i}`, passwordHash, roles: ['DRIVER'] } });
        drivers.push((await tx.driver.create({
          data: { companyId: a, employeeNo: `${run}-${i}`, fullName: `Driver ${i}`, userId: u.id, licenses: { create: { companyId: a, number: `L${i}`, licenseClass: 'E', expiresAt: new Date(Date.now() + 365 * 86_400_000) } } },
        })).id);
      }
      const vehicle = (plate: string, data: Record<string, unknown>) =>
        tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-${plate}`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', branchId: ygn, ...data } });
      van1 = (await vehicle('V1', { capacityKg: 1000, capacityM3: 5, capacityCases: 100, capacityPallets: 4, maxStops: 3 })).id;
      van2 = (await vehicle('V2', { capacityKg: 200 })).id;
      van3 = (await vehicle('V3', { capacityKg: 2000 })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'p', 'd1', 'd2', 'd3']) {
      t[k] = (await http().post('/api/auth/login').send({ email: `${k}-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
    }
    apiKey = (await http().post('/api/integrations/api-keys').set(auth('a')).send({ name: 'DMS', scopes: ['orders:write', 'orders:read'] }).expect(201)).body.key;
    // Proof-of-delivery evidence is covered in sprint11; here drivers record outcomes only.
    await http().patch('/api/company/settings').set(auth('a')).send({ pod: { requirePhoto: false, requireCodEntry: false } }).expect(200);
    await http()
      .post('/api/integrations/webhooks')
      .set(auth('a'))
      .send({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/h`, events: ['order.planned', 'order.dispatched', 'order.delivered', 'order.partially_delivered', 'order.failed'] })
      .expect(201);
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`UPDATE delivery_orders SET trip_id = NULL, stop_id = NULL WHERE company_id = $1::uuid`, companyId);
        for (const tbl of ['trip_stops', 'webhook_deliveries', 'webhook_endpoints', 'delivery_order_lines', 'delivery_orders', 'customers', 'api_keys', 'notifications', 'trip_status_events', 'trips',
          'vehicle_status_events', 'vehicles', 'driver_licenses', 'drivers', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    await new Promise((r) => server.close(r));
  });

  it('takes depot, delivery date, cases and pallets from the DMS', async () => {
    const r = await put('O1', order('C1', 'Kamayut', 16.82)).expect(201);
    expect(r.body.order).toMatchObject({ depotId: ygn, deliveryDate: D, totalWeightKg: 140, totalCases: 14, totalPallets: 0.5 });
    expect(r.body.order.lines[0]).toMatchObject({ cases: 10, pallets: 0.5 });
    await put('O2', order('C1', 'Kamayut', 16.82, { lines: [{ sku: 'OIL', quantity: 2, weightKg: 30, cases: 2 }] })).expect(201); // same customer
    await put('O3', order('C2', 'Sanchaung', 16.85)).expect(201);
    await put('O4', order('C3', 'Tamwe', 16.9, { priority: 'URGENT' })).expect(201);
    await put('O5', order('C4', 'Chanmyathazi', 21.9, { depotCode: `M${run}` })).expect(201);
    await put('O6', order('C5', 'Bahan', 16.81, { lines: [{ sku: 'X', quantity: 1, weightKg: 10 }] })).expect(201);
    const bad = await put('OX', order('C9', 'X', 16.8, { depotCode: 'NOPE' })).expect(400);
    expect(bad.body.errors[0]).toMatchObject({ path: 'depotCode' });
    for (const ref of ['O1', 'O2', 'O3', 'O4', 'O5', 'O6']) ids[ref] = (await getOrder(ref)).fmsId;
  });

  it('shows the planning board per depot and day', async () => {
    const p = await http().get(`/api/logistics/planning?date=${D}&branchId=${ygn}`).set(auth('p')).expect(200);
    expect(p.body.orders.map((o: { externalRef: string }) => o.externalRef).sort()).toEqual(['O1', 'O2', 'O3', 'O4', 'O6'].map((r) => `${run}-${r}`));
    expect(p.body.totals).toMatchObject({ kg: 460, stops: 4, orders: 5 });
    expect(p.body.vehicles.map((v: { id: string }) => v.id).sort()).toEqual([van1, van2, van3].sort());
    expect(p.body.depot).toMatchObject({ name: 'Yangon DC' });
    const m = await http().get(`/api/logistics/planning?date=${D}&branchId=${mdy}`).set(auth('p')).expect(200);
    expect(m.body.orders).toHaveLength(1);
    await http().get(`/api/logistics/planning?date=${D}&branchId=${ygn}`).set(auth('d1')).expect(403);
    await http().get(`/api/logistics/planning?date=${D}&branchId=${ygn}`).set(auth('b')).expect(400); // other tenant's depot
  });

  it('auto-fills loads within capacity without saving', async () => {
    const r = await http().post('/api/logistics/autofill').set(auth('p')).send({ date: D, branchId: ygn, vehicleIds: [van1, van2] }).expect(200);
    const placed = r.body.loads.flatMap((l: { orderIds: string[] }) => l.orderIds);
    expect(r.body.loads[0]).toMatchObject({ vehicleId: van1, check: { ok: true } });
    expect(r.body.loads[0].orderIds[0]).toBe(ids.O4); // urgent first
    expect(placed.length + r.body.unplaced.length).toBe(5);
    for (const l of r.body.loads) expect(l.check.ok).toBe(true);
    expect((await getOrder('O1')).status).toBe('RECEIVED'); // nothing saved
  });

  it('creates a load within capacity, grouped into stops', async () => {
    const tooBig = await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van2, driverId: drivers[1], orderIds: [ids.O1, ids.O3] }).expect(422);
    expect(tooBig.body.violations).toEqual([{ limit: 'kg', used: 280, capacity: 200 }]);
    const fourStops = await http()
      .post('/api/logistics/loads')
      .set(auth('p'))
      .send({ date: D, branchId: ygn, vehicleId: van1, driverId: drivers[0], orderIds: [ids.O1, ids.O2, ids.O3, ids.O4, ids.O6] })
      .expect(422);
    expect(fourStops.body.violations).toEqual([{ limit: 'stops', used: 4, capacity: 3 }]);
    await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van1, driverId: drivers[0], orderIds: [ids.O5] }).expect(400); // other depot

    const r = await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van1, driverId: drivers[0], orderIds: [ids.O1, ids.O2, ids.O3, ids.O4] }).expect(201);
    loadId = r.body.tripId;
    expect(r.body).toMatchObject({ status: 'ASSIGNED', totals: { kg: 450, cases: 44, stops: 3, orders: 4 }, cod: 40_000, check: { ok: true } });
    expect(r.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C1', 'Shop C2', 'Shop C3']); // nearest first from the depot
    expect(r.body.stops[0].orders.map((o: { externalRef: string }) => o.externalRef)).toEqual([`${run}-O1`, `${run}-O2`]);
    expect((await getOrder('O1'))).toMatchObject({ status: 'PLANNED', trip: { status: 'ASSIGNED' } });
    await put('O1', order('C1', 'Kamayut', 16.82, { notes: 'late change' })).expect(409);
    await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van3, driverId: drivers[2], orderIds: [ids.O1] }).expect(409); // already planned
  });

  it('lets only one of two concurrent loads take the same order', async () => {
    const [x, y] = await Promise.all([
      http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van2, driverId: drivers[1], orderIds: [ids.O6] }),
      http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van3, driverId: drivers[2], orderIds: [ids.O6] }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const winner = x.status === 201 ? x.body.tripId : y.body.tripId;
    await http().post(`/api/trips/${winner}/cancel`).set(auth('p')).send({ reason: 'test' }).expect(200);
    expect((await getOrder('O6'))).toMatchObject({ status: 'RECEIVED', trip: null }); // cancel releases orders
  });

  it('edits a planned load: reorder, remove, add back, capacity rechecked', async () => {
    const before = (await http().get(`/api/logistics/loads/${loadId}`).set(auth('p')).expect(200)).body;
    const reversed = [...before.stops].reverse().map((s: { id: string }) => s.id);
    const r1 = await http().patch(`/api/logistics/loads/${loadId}`).set(auth('p')).send({ stopIds: reversed }).expect(200);
    expect(r1.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C3', 'Shop C2', 'Shop C1']);
    const r2 = await http().patch(`/api/logistics/loads/${loadId}`).set(auth('p')).send({ removeOrderIds: [ids.O3] }).expect(200);
    expect(r2.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C3', 'Shop C1']);
    expect((await getOrder('O3')).status).toBe('RECEIVED');
    await http().patch(`/api/logistics/loads/${loadId}`).set(auth('p')).send({ addOrderIds: [ids.O3, ids.O6] }).expect(422); // 4 stops > 3
    const r3 = await http().patch(`/api/logistics/loads/${loadId}`).set(auth('p')).send({ addOrderIds: [ids.O3] }).expect(200);
    expect(r3.body.stops.map((s: { name: string }) => s.name)).toEqual(['Shop C3', 'Shop C1', 'Shop C2']); // new customer appended
    const list = await http().get(`/api/logistics/loads?date=${D}&branchId=${ygn}`).set(auth('p')).expect(200);
    expect(list.body.find((l: { tripId: string }) => l.tripId === loadId)).toMatchObject({ stops: { total: 3, done: 0 }, cod: 40_000 });
  });

  it('runs the trip stop by stop from the driver app', async () => {
    const stops = (await http().get(`/api/me/trips/${loadId}/stops`).set(auth('d1')).expect(200)).body;
    expect(stops.stops).toHaveLength(3);
    await http().get(`/api/me/trips/${loadId}/stops`).set(auth('d2')).expect(403);
    const [s1, s2, s3] = stops.stops;
    await http().post(`/api/me/trips/${loadId}/stops/${s1.id}/arrive`).set(auth('d1')).expect(403); // trip not started

    events.length = 0;
    await http().post(`/api/me/trips/${loadId}/start`).set(auth('d1')).send({}).expect(200);
    expect((await getOrder('O1')).status).toBe('DISPATCHED');

    await http().post(`/api/me/trips/${loadId}/stops/${s1.id}/arrive`).set(auth('d1')).expect(200);
    await http().post(`/api/me/trips/${loadId}/stops/${s1.id}/complete`).set(auth('d1')).send({ outcome: 'DELIVERED' }).expect(200);
    await http().post(`/api/me/trips/${loadId}/stops/${s1.id}/complete`).set(auth('d1')).send({ outcome: 'DELIVERED' }).expect(400); // already done
    expect((await getOrder('O4'))).toMatchObject({ status: 'DELIVERED' });

    // Partial: Shop C1 has O1 (2 lines) and O2 (1 line); 6 of 10 WATER delivered, the rest in full.
    await http().post(`/api/me/trips/${loadId}/stops/${s2.id}/complete`).set(auth('d1')).send({ outcome: 'PARTIAL' }).expect(400); // quantities required
    await http()
      .post(`/api/me/trips/${loadId}/stops/${s2.id}/complete`)
      .set(auth('d1'))
      .send({ outcome: 'PARTIAL', reason: 'Short stock on truck', deliveredLines: [{ orderId: ids.O1, lineNo: 1, quantity: 6 }] })
      .expect(200);
    const o1 = await getOrder('O1');
    expect(o1).toMatchObject({ status: 'PARTIAL' });
    expect(o1.lines.map((l: { deliveredQty: number }) => l.deliveredQty)).toEqual([6, 4]);
    expect((await getOrder('O2')).status).toBe('DELIVERED');

    await http().post(`/api/me/trips/${loadId}/complete`).set(auth('d1')).send({}).expect(409); // stop 3 open
    await http().post(`/api/me/trips/${loadId}/stops/${s3.id}/complete`).set(auth('d1')).send({ outcome: 'FAILED' }).expect(400); // reason required
    await http().post(`/api/me/trips/${loadId}/stops/${s3.id}/complete`).set(auth('d1')).send({ outcome: 'FAILED', reason: 'Customer closed' }).expect(200);
    expect((await getOrder('O3'))).toMatchObject({ status: 'FAILED', failureReason: 'Customer closed' });
    await http().post(`/api/me/trips/${loadId}/complete`).set(auth('d1')).send({}).expect(200);

    await dispatch();
    expect(events.filter((e) => e === 'order.dispatched')).toHaveLength(4);
    expect(events).toEqual(expect.arrayContaining(['order.delivered', 'order.partially_delivered', 'order.failed']));
  });

  it('re-plans failed orders and prints the manifest', async () => {
    const p = await http().get(`/api/logistics/planning?date=${D}&branchId=${ygn}`).set(auth('p')).expect(200);
    expect(p.body.orders.map((o: { externalRef: string }) => o.externalRef).sort()).toEqual([`${run}-O3`, `${run}-O6`]);
    const r = await http().post('/api/logistics/loads').set(auth('p')).send({ date: D, branchId: ygn, vehicleId: van3, driverId: drivers[2], orderIds: [ids.O3, ids.O6] }).expect(201);
    expect((await getOrder('O3'))).toMatchObject({ status: 'PLANNED', failureReason: null });
    const m = await http().get(`/api/logistics/loads/${r.body.tripId}/manifest`).set(auth('p')).expect(200);
    expect(m.body).toMatchObject({ depot: { name: 'Yangon DC' }, vehicle: { plateNumber: `${run}-V3` }, driver: { fullName: 'Driver 3' }, cod: 20_000, totals: { orders: 2, stops: 2 } });
    expect(m.body.stops[0].orders[0].lines.length).toBeGreaterThan(0);
    await http().get(`/api/logistics/loads/${r.body.tripId}`).set(auth('b')).expect(404);
  });

  it('edits customers and depots', async () => {
    const c = (await http().get(`/api/customers?search=${run}-C2`).set(auth('p')).expect(200)).body.items[0];
    await http().patch(`/api/customers/${c.id}`).set(auth('p')).send({ latitude: 16.851 }).expect(400);
    const u = await http().patch(`/api/customers/${c.id}`).set(auth('p')).send({ latitude: 16.851, longitude: 96.14, phone: '+95 9 2' }).expect(200);
    expect(u.body).toMatchObject({ latitude: 16.851, phone: '+95 9 2' });
    await http().patch(`/api/customers/${c.id}`).set(auth('b')).send({ phone: 'x' }).expect(404);
    const b = await http().patch(`/api/branches/${mdy}`).set(auth('a')).send({ latitude: 21.95, longitude: 96.08, address: 'Mandalay industrial zone' }).expect(200);
    expect(b.body).toMatchObject({ latitude: 21.95 });
    await http().patch(`/api/branches/${mdy}`).set(auth('p')).send({ address: 'x' }).expect(403);
  });
});
