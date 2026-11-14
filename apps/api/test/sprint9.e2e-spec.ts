/**
 * Sprint 9: API keys, DMS order API, outbound webhooks, approval workflows.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { resetEnvCache } from '../src/common/config/env';
import { localDate } from '../src/common/time';
import { WebhooksService } from '../src/modules/integrations/webhooks.service';

const PASSWORD = 'E2ePassword123!';
const run = `s9${Date.now().toString(36)}`;
const today = localDate(new Date(), 'Asia/Yangon');

interface Hit {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('Sprint 9 integrations & approvals (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let server: Server;
  let hookUrl: string;
  const hits: Hit[] = [];
  const replies: number[] = []; // status codes to answer with (default 200)
  const companyIds: string[] = [];
  const t: Record<string, string> = {}; // tokens
  let van: string;
  let driver: string;
  let incident: string;

  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const key = (k: string) => ({ 'X-API-Key': k });
  const dispatch = async (at = new Date()) => app.get(WebhooksService).dispatchDue(50, at);
  const order = (over: Record<string, unknown> = {}) => ({
    customer: { code: `OUT-${run}`, name: 'Shwe Mart Hledan', phone: '+95 9 123', address: 'No. 5, Pyay Rd', township: 'Kamayut', city: 'Yangon', latitude: 16.82, longitude: 96.13 },
    priority: 'HIGH',
    deliveryWindow: { start: '2026-12-01T02:30:00Z', end: '2026-12-01T06:30:00Z' },
    codAmount: 125000,
    lines: [
      { sku: 'WATER-1L', description: 'Water 1 L x12', quantity: 20, uom: 'CTN', weightKg: 240, volumeM3: 0.4 },
      { sku: 'RICE-5KG', quantity: 10, uom: 'BAG', weightKg: 50 },
    ],
    ...over,
  });

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE = 'true';
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    resetEnvCache();
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hits.push({ headers: req.headers, body });
        res.statusCode = replies.shift() ?? 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S9 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      const users: [string, string, string][] = [
        ['a2', 'Second admin', 'COMPANY_ADMIN'],
        ['m', 'Manager', 'FLEET_MANAGER'],
        ['p', 'Dispatcher', 'DISPATCHER'],
        ['r', 'Staff Requester', 'REQUESTER'],
      ];
      for (const [k, name, role] of users) await tx.user.create({ data: { companyId: a, email: `${k}-${run}@e2e.local`, fullName: name, passwordHash, roles: [role] } });
      driver = (await tx.driver.create({
        data: { companyId: a, employeeNo: `${run}-1`, fullName: 'Van Driver', licenses: { create: { companyId: a, number: 'L1', licenseClass: 'E', expiresAt: new Date(Date.now() + 365 * 86_400_000) } } },
      })).id;
      van = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN' } })).id;
      incident = (await tx.incident.create({ data: { companyId: a, incidentNo: `INC-${run}`, vehicleId: van, type: 'COLLISION', occurredAt: new Date(), description: 'Bumper' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'a2', 'm', 'p', 'r']) {
      t[k] = (await http().post('/api/auth/login').send({ email: `${k}-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
    }
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const tbl of ['approval_decisions', 'approval_requests', 'vehicle_requests', 'webhook_deliveries', 'webhook_endpoints', 'delivery_order_lines', 'delivery_orders', 'customers',
          'api_keys', 'insurance_claims', 'incidents', 'fuel_records', 'vehicle_expenses', 'work_order_lines', 'work_orders', 'notifications', 'trip_status_events', 'trips',
          'vehicle_status_events', 'vehicle_assignments', 'vehicles', 'driver_licenses', 'drivers', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    await new Promise((r) => server.close(r));
  });

  let keyA: string;
  let keyB: string;

  describe('API keys', () => {
    it('issues keys shown once, scoped, revocable, never valid on user routes', async () => {
      await http().post('/api/integrations/api-keys').set(auth('m')).send({ name: 'DMS', scopes: ['orders:write'] }).expect(403);
      const created = await http().post('/api/integrations/api-keys').set(auth('a')).send({ name: 'DMS prod', scopes: ['orders:write', 'orders:read', 'vehicles:read'] }).expect(201);
      keyA = created.body.key;
      expect(keyA).toMatch(/^fms_[a-z0-9]{12}_/);
      const listed = await http().get('/api/integrations/api-keys').set(auth('a')).expect(200);
      expect(listed.body[0]).not.toHaveProperty('key');
      expect(listed.body[0]).not.toHaveProperty('keyHash');
      keyB = (await http().post('/api/integrations/api-keys').set(auth('b')).send({ name: 'B key', scopes: ['orders:read'] }).expect(201)).body.key;

      await http().get('/api/integrations/v1/vehicles').set(key(keyA)).expect(200);
      await http().get('/api/integrations/v1/vehicles/positions').set(key(keyA)).expect(403); // no tracking:read
      await http().get('/api/integrations/v1/vehicles').expect(401);
      await http().get('/api/integrations/v1/vehicles').set(auth('a')).expect(401); // JWT not accepted
      await http().get('/api/vehicles').set(key(keyA)).expect(401); // key not accepted on user routes
      await http().get('/api/integrations/v1/vehicles').set(key(`${keyA.slice(0, -2)}xx`)).expect(401);

      const tmp = (await http().post('/api/integrations/api-keys').set(auth('a')).send({ name: 'tmp', scopes: ['vehicles:read'] }).expect(201)).body;
      await http().post(`/api/integrations/api-keys/${tmp.id}/revoke`).set(auth('a')).expect(200);
      await http().get('/api/integrations/v1/vehicles').set(key(tmp.key)).expect(401);
      const expired = (await http().post('/api/integrations/api-keys').set(auth('a')).send({ name: 'old', scopes: ['vehicles:read'], expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(201)).body;
      await http().get('/api/integrations/v1/vehicles').set(key(expired.key)).expect(401);
      await http().post(`/api/integrations/api-keys/${tmp.id}/revoke`).set(auth('b')).expect(404);
    });
  });

  describe('webhooks + order API', () => {
    let endpoint: { id: string; secret: string };

    it('registers endpoints with a signing secret', async () => {
      await http().post('/api/integrations/webhooks').set(auth('a')).send({ url: hookUrl, events: ['nope'] }).expect(400);
      endpoint = (await http()
        .post('/api/integrations/webhooks')
        .set(auth('a'))
        .send({ url: hookUrl, events: ['order.received', 'order.updated', 'order.cancelled', 'trip.assigned', 'approval.requested', 'approval.approved'] })
        .expect(201)).body;
      expect(endpoint.secret).toMatch(/^whsec_/);
      expect((await http().get('/api/integrations/webhooks').set(auth('a')).expect(200)).body[0]).not.toHaveProperty('secret');
    });

    it('refuses private targets unless allowed', async () => {
      process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
      resetEnvCache();
      const res = await http().post('/api/integrations/webhooks').set(auth('a')).send({ url: 'http://127.0.0.1:9/x', events: ['order.received'] }).expect(400);
      expect(res.body.errors[0].message).toMatch(/private/);
      process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
      resetEnvCache();
    });

    it('upserts orders idempotently and emits signed webhooks', async () => {
      const ref = `SO-${run}-1`;
      const c = await http().put(`/api/integrations/v1/orders/${ref}`).set(key(keyA)).send(order()).expect(201);
      expect(c.body).toMatchObject({ result: 'created', order: { externalRef: ref, status: 'RECEIVED', version: 1, totalWeightKg: 290, totalVolumeM3: 0.4, codAmount: 125000 } });
      expect(c.body.order.lines).toHaveLength(2);
      const same = await http().put(`/api/integrations/v1/orders/${ref}`).set(key(keyA)).send(order()).expect(200);
      expect(same.body.result).toBe('unchanged');
      const upd = await http().put(`/api/integrations/v1/orders/${ref}`).set(key(keyA)).send(order({ notes: 'Call before arrival' })).expect(200);
      expect(upd.body).toMatchObject({ result: 'updated', order: { version: 2, notes: 'Call before arrival' } });
      const bad = await http().put(`/api/integrations/v1/orders/${ref}`).set(key(keyA)).send(order({ lines: [{ sku: '', quantity: -1 }] })).expect(400);
      expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['lines.0.sku', 'lines.0.quantity']));
      await http().put(`/api/integrations/v1/orders/bad%20ref`).set(key(keyA)).send(order()).expect(400);

      // Tenant isolation: company B's key cannot see A's orders.
      await http().get(`/api/integrations/v1/orders/${ref}`).set(key(keyB)).expect(404);
      await http().put(`/api/integrations/v1/orders/${ref}`).set(key(keyB)).send(order()).expect(403); // read-only key

      const r = await dispatch();
      expect(r.sent).toBe(2);
      expect(hits.map((h) => h.headers['x-fms-event'])).toEqual(['order.received', 'order.updated']);
      const h = hits[0];
      const [ts, sig] = String(h.headers['x-fms-signature']).split(',');
      expect(sig.slice(3)).toBe(createHmac('sha256', endpoint.secret).update(`${ts.slice(2)}.${h.body}`).digest('hex'));
      expect(JSON.parse(h.body)).toMatchObject({ event: 'order.received', data: { externalRef: ref, customer: { code: `OUT-${run}` } } });
    });

    it('serves a changes feed with a cursor and a batch endpoint', async () => {
      const since = new Date(Date.now() - 60_000).toISOString();
      const batch = await http()
        .post('/api/integrations/v1/orders/batch')
        .set(key(keyA))
        .set('Idempotency-Key', `batch-${run}-0001`)
        .send({ orders: [{ externalRef: `SO-${run}-2`, order: order() }, { externalRef: `SO-${run}-3`, order: order({ lines: [] }) }, { externalRef: `SO-${run}-4`, order: order() }] })
        .expect(200);
      expect(batch.body.results.map((x: { result: string }) => x.result)).toEqual(['created', 'error', 'created']);
      // Same key + same body → same response, nothing re-created; different body → 422.
      const again = await http()
        .post('/api/integrations/v1/orders/batch')
        .set(key(keyA))
        .set('Idempotency-Key', `batch-${run}-0001`)
        .send({ orders: [{ externalRef: `SO-${run}-2`, order: order() }, { externalRef: `SO-${run}-3`, order: order({ lines: [] }) }, { externalRef: `SO-${run}-4`, order: order() }] })
        .expect(200);
      expect(again.body).toEqual(batch.body);
      await http().post('/api/integrations/v1/orders/batch').set(key(keyA)).set('Idempotency-Key', `batch-${run}-0001`).send({ orders: [{ externalRef: 'X', order: order() }] }).expect(422);

      const p1 = await http().get(`/api/integrations/v1/orders?updatedSince=${since}&limit=2`).set(key(keyA)).expect(200);
      expect(p1.body.items).toHaveLength(2);
      const p2 = await http().get(`/api/integrations/v1/orders?updatedSince=${since}&limit=2&cursor=${p1.body.nextCursor}`).set(key(keyA)).expect(200);
      expect(p2.body.items).toHaveLength(1);
      expect(p2.body.nextCursor).toBeNull();
      expect(new Set([...p1.body.items, ...p2.body.items].map((o: { externalRef: string }) => o.externalRef)).size).toBe(3);
    });

    it('cancels while received, refuses changes once planned', async () => {
      const c1 = await http().post(`/api/integrations/v1/orders/SO-${run}-2/cancel`).set(key(keyA)).send({ reason: 'Customer closed' }).expect(200);
      expect(c1.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer closed' });
      await http().post(`/api/integrations/v1/orders/SO-${run}-2/cancel`).set(key(keyA)).send({}).expect(200); // idempotent
      await admin.$executeRawUnsafe(`UPDATE delivery_orders SET status = 'PLANNED' WHERE external_ref = $1`, `SO-${run}-4`);
      await http().put(`/api/integrations/v1/orders/SO-${run}-4`).set(key(keyA)).send(order({ notes: 'late change' })).expect(409);
      await http().post(`/api/integrations/v1/orders/SO-${run}-4/cancel`).set(key(keyA)).send({}).expect(409);
      await http().get('/api/integrations/v1/orders/NOPE').set(key(keyA)).expect(404);
      const web = await http().get('/api/orders?search=Shwe').set(auth('p')).expect(200);
      expect(web.body.total).toBe(3);
      await http().get('/api/orders').set(auth('r')).expect(403);
    });

    it('retries failed deliveries with backoff and supports redelivery', async () => {
      await dispatch(); // drain deliveries queued by earlier tests
      hits.length = 0;
      replies.push(500);
      await http().put(`/api/integrations/v1/orders/SO-${run}-5`).set(key(keyA)).send(order()).expect(201);
      expect(await dispatch()).toEqual({ sent: 0, failed: 1 });
      const [d] = (await http().get(`/api/integrations/webhook-deliveries?endpointId=${endpoint.id}&take=1`).set(auth('a')).expect(200)).body;
      expect(d).toMatchObject({ status: 'PENDING', attempts: 1, responseStatus: 500, lastError: 'HTTP 500' });
      expect(await dispatch()).toEqual({ sent: 0, failed: 0 }); // not due yet
      expect(await dispatch(new Date(Date.now() + 61_000))).toEqual({ sent: 1, failed: 0 });
      await http().post(`/api/integrations/webhook-deliveries/${d.id}/redeliver`).set(auth('a')).expect(200);
      expect((await dispatch()).sent).toBe(1);
      expect(hits.map((h) => h.headers['x-fms-delivery'])).toEqual([d.id, d.id, d.id]);
      await http().post(`/api/integrations/webhooks/${endpoint.id}/test`).set(auth('a')).expect(201);
      await dispatch();
      expect(hits.at(-1)!.headers['x-fms-event']).toBe('ping');
    });
  });

  describe('approvals', () => {
    beforeAll(async () => {
      await http()
        .patch('/api/company/settings')
        .set(auth('a'))
        .send({ approvals: { workOrderAbove: 500_000, expenseAbove: 100_000, fuelAbove: 200_000, claimAbove: 1_000_000, secondApproverAbove: 2_000_000 } })
        .expect(200);
    });

    it('holds expensive work orders until approved; no self-approval', async () => {
      const wo = (await http().post('/api/maintenance/work-orders').set(auth('m')).send({ vehicleId: van, type: 'CORRECTIVE', title: 'Gearbox overhaul', estimatedCost: 600_000, offRoad: false }).expect(201)).body;
      expect(wo.status).toBe('AWAITING_APPROVAL');
      await http().post(`/api/maintenance/work-orders/${wo.id}/start`).set(auth('m')).expect(409);
      const inbox = await http().get('/api/approvals?scope=pending').set(auth('a')).expect(200);
      const req = inbox.body.find((x: { entityId: string }) => x.entityId === wo.id);
      expect(req).toMatchObject({ kind: 'WORK_ORDER', amount: '600000', requiredApprovals: 1, status: 'PENDING' });
      expect((await http().get('/api/approvals?scope=pending').set(auth('m')).expect(200)).body.some((x: { id: string }) => x.id === req.id)).toBe(false); // own request
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('m')).send({}).expect(403); // own request
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('p')).send({}).expect(403); // no permission
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('b')).send({}).expect(404); // other tenant
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('a')).send({ note: 'OK' }).expect(200);
      await http().post(`/api/maintenance/work-orders/${wo.id}/start`).set(auth('m')).expect(200);

      // Lines pushing an un-estimated work order over the limit block completion until approved; rejection cancels it.
      const wo2 = (await http().post('/api/maintenance/work-orders').set(auth('m')).send({ vehicleId: van, type: 'CORRECTIVE', title: 'Body work' }).expect(201)).body;
      expect(wo2.status).toBe('OPEN');
      await http().post(`/api/maintenance/work-orders/${wo2.id}/lines`).set(auth('m')).send({ kind: 'EXTERNAL', description: 'Panel shop', quantity: 1, unitCost: 700_000 }).expect(201);
      await http().post(`/api/maintenance/work-orders/${wo2.id}/complete`).set(auth('m')).send({ resolution: 'Done' }).expect(409);
      const asked = await http().post(`/api/maintenance/work-orders/${wo2.id}/request-approval`).set(auth('m')).expect(200);
      expect(asked.body.status).toBe('AWAITING_APPROVAL');
      const req2 = (await http().get('/api/approvals?scope=pending&kind=WORK_ORDER').set(auth('a')).expect(200)).body.find((x: { entityId: string }) => x.entityId === wo2.id);
      await http().post(`/api/approvals/${req2.id}/reject`).set(auth('a')).send({}).expect(400); // reason required
      await http().post(`/api/approvals/${req2.id}/reject`).set(auth('a')).send({ note: 'Get a second quote' }).expect(200);
      const after = await http().get(`/api/maintenance/work-orders/${wo2.id}`).set(auth('m')).expect(200);
      expect(after.body).toMatchObject({ status: 'CANCELLED', resolution: 'Approval rejected: Get a second quote' });
      const notes = await http().get('/api/notifications').set(auth('m')).expect(200);
      expect(notes.body.some((n: { topic: string }) => n.topic === 'approval.rejected')).toBe(true);
    });

    it('keeps large expenses and fuel out of reports until approved', async () => {
      const exp = (await http().post('/api/expenses').set(auth('m')).send({ vehicleId: van, category: 'TOLL', incurredAt: new Date().toISOString(), amount: 150_000 }).expect(201)).body;
      expect(exp.approvalStatus).toBe('PENDING');
      const small = (await http().post('/api/expenses').set(auth('m')).send({ vehicleId: van, category: 'PARKING', incurredAt: new Date().toISOString(), amount: 5_000 }).expect(201)).body;
      expect(small.approvalStatus).toBe('APPROVED');
      const fuel = (await http().post('/api/fuel/records').set(auth('m')).send({ vehicleId: van, filledAt: new Date().toISOString(), odometerKm: 100, litres: 100, unitPrice: 2500 }).expect(201)).body;
      expect(fuel.approvalStatus).toBe('PENDING');

      let ov = (await http().get(`/api/analytics/overview?from=${today}&to=${today}`).set(auth('a')).expect(200)).body;
      expect(ov.fleet).toMatchObject({ otherCost: 5_000, fuelCost: 0 });
      expect(ov.pendingApproval).toEqual({ fuelCost: 250_000, fuelRecords: 1, otherCost: 150_000, expenses: 1 });

      const pend = (await http().get('/api/approvals?scope=pending').set(auth('a')).expect(200)).body;
      await http().post(`/api/approvals/${pend.find((x: { entityId: string }) => x.entityId === exp.id).id}/approve`).set(auth('a')).send({}).expect(200);
      await http().post(`/api/approvals/${pend.find((x: { entityId: string }) => x.entityId === fuel.id).id}/reject`).set(auth('a')).send({ note: 'Receipt unreadable' }).expect(200);
      ov = (await http().get(`/api/analytics/overview?from=${today}&to=${today}`).set(auth('a')).expect(200)).body;
      expect(ov.fleet).toMatchObject({ otherCost: 155_000, fuelCost: 0 });
      expect(ov.pendingApproval).toEqual({ fuelCost: 0, fuelRecords: 0, otherCost: 0, expenses: 0 });
    });

    it('needs two different approvers for large claims', async () => {
      const claim = (await http().post(`/api/incidents/${incident}/claims`).set(auth('m')).send({ amountClaimed: 2_500_000, insurer: 'Myanma Insurance' }).expect(201)).body;
      expect(claim.status).toBe('PENDING_APPROVAL');
      await http().patch(`/api/claims/${claim.id}`).set(auth('m')).send({ status: 'APPROVED', amountApproved: 1 }).expect(400);
      const req = (await http().get('/api/approvals?scope=pending&kind=CLAIM').set(auth('a')).expect(200)).body[0];
      expect(req.requiredApprovals).toBe(2);
      const first = await http().post(`/api/approvals/${req.id}/approve`).set(auth('a')).send({}).expect(200);
      expect(first.body.status).toBe('PENDING');
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('a')).send({}).expect(400); // same approver again
      const second = await http().post(`/api/approvals/${req.id}/approve`).set(auth('a2')).send({}).expect(200);
      expect(second.body.status).toBe('APPROVED');
      const claims = (await http().get('/api/claims').set(auth('m')).expect(200)).body;
      expect(claims.find((c: { id: string }) => c.id === claim.id).status).toBe('SUBMITTED');
    });

    it('runs vehicle booking requests from request to scheduled trip', async () => {
      const start = new Date(Date.now() + 2 * 86_400_000);
      const vr = (await http()
        .post('/api/vehicle-requests')
        .set(auth('r'))
        .send({ purpose: 'Client visit — Bago branch', originName: 'Head office', destinationName: 'Bago', plannedStart: start.toISOString(), plannedEnd: new Date(start.getTime() + 8 * 3_600_000).toISOString(), passengers: 3 })
        .expect(201)).body;
      expect(vr).toMatchObject({ status: 'PENDING', requestNo: expect.stringMatching(/^VR-\d{4}-000001$/) });
      await http().post('/api/vehicle-requests').set(auth('r')).send({ purpose: 'x', originName: 'a', destinationName: 'b', plannedStart: start.toISOString(), plannedEnd: start.toISOString() }).expect(400);
      await http().get('/api/vehicles').set(auth('r')).expect(403); // requesters see nothing else
      expect((await http().get('/api/vehicle-requests').set(auth('r')).expect(200)).body.total).toBe(1);
      expect((await http().get('/api/approvals').set(auth('r')).expect(200)).body).toHaveLength(1); // their own only
      await http().post(`/api/vehicle-requests/${vr.id}/schedule`).set(auth('p')).send({ vehicleId: van, driverId: driver }).expect(400); // not approved yet

      const req = (await http().get('/api/approvals?scope=pending&kind=VEHICLE_REQUEST').set(auth('m')).expect(200)).body[0];
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('r')).send({}).expect(403);
      await http().post(`/api/approvals/${req.id}/approve`).set(auth('m')).send({}).expect(200);
      const sch = await http().post(`/api/vehicle-requests/${vr.id}/schedule`).set(auth('p')).send({ vehicleId: van, driverId: driver }).expect(200);
      expect(sch.body).toMatchObject({ status: 'SCHEDULED', trip: { tripNo: expect.any(String) } });
      const mine = (await http().get(`/api/vehicle-requests/${vr.id}`).set(auth('r')).expect(200)).body;
      expect(mine.trip).toMatchObject({ status: 'ASSIGNED', vehicle: { plateNumber: `${run}-V` }, driver: { fullName: 'Van Driver' } });
      const notes = await http().get('/api/notifications').set(auth('r')).expect(200);
      expect(notes.body.map((n: { topic: string }) => n.topic)).toEqual(expect.arrayContaining(['approval.approved', 'vehicle_request.scheduled']));
      await http().post(`/api/vehicle-requests/${vr.id}/cancel`).set(auth('r')).expect(400); // already scheduled

      // Webhooks for the approval and the assigned trip.
      hits.length = 0;
      await dispatch();
      expect(hits.map((h) => h.headers['x-fms-event'])).toEqual(expect.arrayContaining(['approval.requested', 'approval.approved', 'trip.assigned']));
    });
  });
});
