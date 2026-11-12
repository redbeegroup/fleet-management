/**
 * Sprint 5: fuel (efficiency, anomalies, summary), maintenance plans, repair
 * requests, work orders (downtime, costs, plan reset), driver self-service.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';

const PASSWORD = 'E2ePassword123!';
const run = `s5${Date.now().toString(36)}`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe('Sprint 5 fuel & maintenance (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let token: string;
  let tokenB: string;
  let driverToken: string;
  let viewerToken: string;
  const companyIds: string[] = [];
  let truck: string;
  let other: string;
  let driverId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S5 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `v-${run}@e2e.local`, fullName: 'Viewer', passwordHash, roles: ['VIEWER'] } });
      const u = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-T`, make: 'Isuzu', model: 'FVR', vehicleClass: 'TRUCK', odometerKm: 10_000, tankCapacityL: 200 } })).id;
      other = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-O`, make: 'Toyota', model: 'Hilux', vehicleClass: 'PICKUP' } })).id;
      driverId = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver', userId: u.id } })).id;
      await tx.vehicleAssignment.create({ data: { companyId: a, vehicleId: truck, driverId } });
      await tx.vehicle.update({ where: { id: truck }, data: { status: 'ASSIGNED' } });
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
        for (const t of ['notifications', 'work_order_lines', 'repair_requests', 'work_orders', 'maintenance_plans', 'fuel_records', 'company_counters',
          'vehicle_status_events', 'vehicle_assignments', 'vehicles', 'drivers', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  describe('fuel', () => {
    const fill = (days: number, odometerKm: number, litres: number, extra: Record<string, unknown> = {}) =>
      http().post('/api/fuel/records').set(auth(token)).send({ vehicleId: truck, filledAt: ago(days), odometerKm, litres, unitPrice: 2500, ...extra });

    it('computes full-to-full efficiency, totals and updates the odometer', async () => {
      await fill(10, 10_000, 100).expect(201);
      await fill(8, 10_400, 40, { fullTank: false }).expect(201);
      const r = await fill(6, 10_800, 60).expect(201);
      expect(Number(r.body.totalCost)).toBe(150_000);
      expect(Number(r.body.kmPerLitre)).toBe(8); // 800 km / (40 + 60) L
      const v = await http().get(`/api/vehicles/${truck}`).set(auth(token));
      expect(Number(v.body.odometerKm)).toBe(10_800);
    });

    it('recomputes when a back-dated fill is inserted', async () => {
      await fill(7, 10_600, 30, { totalCost: 75_000, unitPrice: undefined }).expect(201); // between the two
      const list = await http().get(`/api/fuel/records?vehicleId=${truck}`).set(auth(token)).expect(200);
      const last = list.body.items.find((x: { odometerKm: string }) => Number(x.odometerKm) === 10_800);
      expect(Number(last.kmPerLitre)).toBe(Number((200 / 60).toFixed(2))); // 200 km / 60 L since the back-dated full fill
    });

    it('flags anomalies', async () => {
      const big = await fill(5, 11_200, 250).expect(201);
      expect(big.body.flags).toContain('OVER_TANK_CAPACITY');
      const back = await fill(4, 9_000, 50).expect(201);
      expect(back.body.flags).toContain('ODOMETER_BACKWARDS');
      const flagged = await http().get('/api/fuel/records?flagged=true').set(auth(token)).expect(200);
      expect(flagged.body.total).toBe(2);
      await fill(-1, 12_000, 10).expect(400); // future
      await http().post('/api/fuel/records').set(auth(token)).send({ vehicleId: truck, filledAt: ago(1), odometerKm: 1, litres: 5 }).expect(400); // no price
    });

    it('summarises per vehicle and isolates tenants', async () => {
      const s = await http().get(`/api/fuel/summary?from=${ago(30)}&to=${ago(-1)}`).set(auth(token)).expect(200);
      const t = s.body.vehicles.find((v: { id: string }) => v.id === truck);
      expect(t.fills).toBe(6);
      expect(t.flagged).toBe(2);
      expect(t.kmPerLitre).toBeGreaterThan(0);
      const b = await http().get(`/api/fuel/summary?from=${ago(30)}&to=${ago(-1)}`).set(auth(tokenB)).expect(200);
      expect(b.body.vehicles).toHaveLength(0);
      await http().post('/api/fuel/records').set(auth(viewerToken)).send({}).expect(403);
    });

    it('lets the driver record fuel for their own vehicle only', async () => {
      const ok = await http().post('/api/me/fuel').set(auth(driverToken)).send({ vehicleId: truck, filledAt: ago(0.5), odometerKm: 11_500, litres: 40, totalCost: 100_000 }).expect(201);
      expect(ok.body).toMatchObject({ source: 'app', driverId });
      await http().post('/api/me/fuel').set(auth(driverToken)).send({ vehicleId: other, filledAt: ago(0.5), odometerKm: 1, litres: 4, totalCost: 1 }).expect(403);
    });
  });

  describe('maintenance', () => {
    let planId: string;
    let woId: string;

    it('creates plans with a baseline and computes due status', async () => {
      const p = await http().post('/api/maintenance/plans').set(auth(token)).send({ vehicleId: truck, name: 'Engine oil', intervalKm: 5000, lastDoneOdometerKm: 7000 }).expect(201);
      planId = p.body.id;
      await http().post('/api/maintenance/plans').set(auth(token)).send({ vehicleId: truck, name: 'Nothing' }).expect(400);
      const bulk = await http().post('/api/maintenance/plans/bulk').set(auth(token)).send({ vehicleIds: [truck, other], name: 'Annual inspection', intervalDays: 365 }).expect(201);
      expect(bulk.body.created).toBe(2);
      const plans = await http().get(`/api/maintenance/plans?vehicleId=${truck}`).set(auth(token)).expect(200);
      const oil = plans.body.find((x: { id: string }) => x.id === planId);
      // odometer 11 500 vs due at 12 000 → 500 km left = due soon
      expect(oil.due).toMatchObject({ status: 'DUE_SOON', nextDueKm: 12_000, remainingKm: 500 });
    });

    it('sends due alerts once per cycle', async () => {
      const svc = app.get(MaintenanceService);
      expect(await svc.dueAlerts()).toBeGreaterThan(0);
      expect(await svc.dueAlerts()).toBe(0);
    });

    it('takes repair requests from the driver for their vehicle only', async () => {
      await http().post('/api/me/repair-requests').set(auth(driverToken)).send({ vehicleId: other, description: 'Brakes squeal' }).expect(400);
      const rr = await http().post('/api/me/repair-requests').set(auth(driverToken)).send({ vehicleId: truck, description: 'Brakes squeal loudly', severity: 'HIGH' }).expect(201);
      const mine = await http().get('/api/me/repair-requests').set(auth(driverToken)).expect(200);
      expect(mine.body.map((x: { id: string }) => x.id)).toEqual([rr.body.id]);
      const notes = await http().get('/api/notifications').set(auth(token));
      expect(notes.body.some((n: { topic: string; severity: string }) => n.topic === 'maintenance.repair_request' && n.severity === 'warning')).toBe(true);

      const wo = await http()
        .post('/api/maintenance/work-orders')
        .set(auth(token))
        .send({ vehicleId: truck, type: 'PREVENTIVE', title: 'Oil + brakes', planId, repairRequestIds: [rr.body.id] })
        .expect(201);
      woId = wo.body.id;
      expect(wo.body.woNo).toMatch(/^WO-\d{4}-000001$/);
      await http().post('/api/maintenance/work-orders').set(auth(token)).send({ vehicleId: truck, type: 'PREVENTIVE', title: 'dup', planId }).expect(409);
      const reqs = await http().get('/api/maintenance/repair-requests?status=CONVERTED').set(auth(token));
      expect(reqs.body[0].workOrder.woNo).toBe(wo.body.woNo);
    });

    it('runs a work order: downtime, cost lines, completion resets the plan', async () => {
      await http().post(`/api/maintenance/work-orders/${woId}/start`).set(auth(token)).expect(200);
      let v = await http().get(`/api/vehicles/${truck}`).set(auth(token));
      expect(v.body.status).toBe('UNDER_REPAIR');
      // Under repair → cannot be dispatched
      const trip = await http()
        .post('/api/trips')
        .set(auth(token))
        .send({ originName: 'A', destinationName: 'B', plannedStart: ago(-1), plannedEnd: ago(-1.1), vehicleId: truck, driverId })
        .expect(409);
      expect(trip.body.reasons).toContain('Vehicle is under repair');

      await http().post(`/api/maintenance/work-orders/${woId}/lines`).set(auth(token)).send({ kind: 'PART', description: 'Oil 15W-40', quantity: 8, unitCost: 12_000 }).expect(201);
      const l = await http().post(`/api/maintenance/work-orders/${woId}/lines`).set(auth(token)).send({ kind: 'LABOUR', description: 'Mechanic', quantity: 2, unitCost: 15_000 }).expect(201);
      expect(Number(l.body.totalCost)).toBe(126_000);
      const done = await http().post(`/api/maintenance/work-orders/${woId}/complete`).set(auth(token)).send({ resolution: 'Oil and pads replaced', odometerKm: 11_600 }).expect(200);
      expect(done.body.status).toBe('COMPLETED');
      await http().post(`/api/maintenance/work-orders/${woId}/lines`).set(auth(token)).send({ kind: 'OTHER', description: 'late', quantity: 1, unitCost: 1 }).expect(400);

      v = await http().get(`/api/vehicles/${truck}`).set(auth(token));
      expect(v.body.status).toBe('ASSIGNED'); // driver still holds it
      const plans = await http().get(`/api/maintenance/plans?vehicleId=${truck}`).set(auth(token));
      const oil = plans.body.find((x: { id: string }) => x.id === planId);
      expect(oil.due).toMatchObject({ status: 'OK', nextDueKm: 16_600 });

      const report = await http().get(`/api/maintenance/report?from=${ago(1)}&to=${ago(-1)}`).set(auth(token)).expect(200);
      const r = report.body.vehicles.find((x: { id: string }) => x.id === truck);
      expect(r).toMatchObject({ workOrders: 1, cost: 126_000, parts: 96_000, labour: 30_000 });
      expect(r.downtimeMinutes).toBeGreaterThanOrEqual(0);

      const hist = await http().get(`/api/vehicles/${truck}/history`).set(auth(token));
      const kinds = new Set(hist.body.map((e: { kind: string }) => e.kind));
      expect(kinds.has('fuel') && kinds.has('maintenance')).toBe(true);
    });

    it('cancelling reopens linked repair requests and releases the vehicle', async () => {
      const rr = await http().post('/api/maintenance/repair-requests').set(auth(token)).send({ vehicleId: other, description: 'Wiper broken' }).expect(201);
      const wo = await http().post('/api/maintenance/work-orders').set(auth(token)).send({ vehicleId: other, type: 'CORRECTIVE', title: 'Wiper', repairRequestIds: [rr.body.id] }).expect(201);
      await http().post(`/api/maintenance/work-orders/${wo.body.id}/start`).set(auth(token)).expect(200);
      await http().post(`/api/maintenance/work-orders/${wo.body.id}/cancel`).set(auth(token)).send({ reason: 'Parts unavailable' }).expect(200);
      const v = await http().get(`/api/vehicles/${other}`).set(auth(token));
      expect(v.body.status).toBe('AVAILABLE');
      const open = await http().get('/api/maintenance/repair-requests?status=OPEN').set(auth(token));
      expect(open.body.map((x: { id: string }) => x.id)).toContain(rr.body.id);
      await http().get(`/api/maintenance/work-orders/${wo.body.id}`).set(auth(tokenB)).expect(404);
    });
  });
});
