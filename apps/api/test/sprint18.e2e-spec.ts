/**
 * Sprint 18: trailers and equipment (asset kinds, meter readings, hour-based maintenance, trip trailers,
 * couplings, combined and legal load limits), the Myanmar compliance pack (status, dispatch blocking),
 * safety audits with corrective actions, tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';

const PASSWORD = 'E2ePassword123!';
const run = `s18${Date.now().toString(36)}`;
const DAY = 86_400_000;

describe('Sprint 18 trailers & equipment, compliance, safety audits (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const tomorrow = new Date(Date.now() + DAY + 6.5 * 3_600_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S18 ${tag}`, timezone: 'Asia/Yangon' } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const a = companyIds[0];
      id.owner = (await tx.user.create({ data: { companyId: a, email: `o-${run}@e2e.local`, fullName: 'Depot supervisor', passwordHash, roles: ['DISPATCHER'] } })).id;
      id.branch = (await tx.branch.create({ data: { companyId: a, code: `D${run}`, name: 'Thilawa depot', latitude: 16.66, longitude: 96.26 } })).id;
      id.tractor = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-TR`, make: 'Hino', model: '700', vehicleClass: 'TRACTOR', capacityKg: 0, branchId: id.branch, odometerKm: 100_000 } })).id;
      id.trailer = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-TL`, make: 'CIMC', model: 'Flatbed', vehicleClass: 'TRAILER', assetKind: 'TRAILER', meterType: 'KM', capacityKg: 30_000, branchId: id.branch, odometerKm: 5_000 } })).id;
      id.gen = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-GEN`, make: 'Cummins', model: 'C150', vehicleClass: 'MACHINERY', assetKind: 'GENERATOR', meterType: 'HOURS', hourMeter: 1_000, branchId: id.branch } })).id;
      const u = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      id.driver = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver', userId: u.id, licenses: { create: { companyId: a, number: 'L1', licenseClass: 'TR', expiresAt: new Date(Date.now() + 365 * DAY) } } } })).id;
      const cust = await tx.customer.create({ data: { companyId: a, code: `${run}-C`, name: 'Warehouse', latitude: 16.8, longitude: 96.15 } });
      for (const [ref, kg] of [['O1', 8_000], ['O2', 6_000]] as [string, number][]) {
        id[ref] = (await tx.deliveryOrder.create({ data: { companyId: a, externalRef: `${run}-${ref}`, customerId: cust.id, branchId: id.branch, deliveryDate: new Date(tomorrow), totalWeightKg: kg, payloadHash: ref, latitude: 16.8, longitude: 96.15 } })).id;
      }
      id.vb = (await tx.vehicle.create({ data: { companyId: companyIds[1], plateNumber: `${run}-VB`, make: 'X', model: 'Y', vehicleClass: 'TRUCK' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'o', 'd']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
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
        for (const tbl of ['corrective_actions', 'safety_audits', 'audit_templates', 'repair_requests', 'trailer_couplings', 'meter_readings', 'maintenance_plans', 'delivery_orders', 'trip_stops', 'trip_status_events', 'trips', 'customers', 'vehicle_documents', 'driver_licenses', 'drivers', 'notifications', 'vehicle_status_events', 'vehicles', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('equipment: hour meter readings and hour-based maintenance', async () => {
    await http().post(`/api/vehicles/${id.gen}/meter-readings`).set(auth('a')).send({ kind: 'HOURS', value: 900 }).expect(400);
    await http().post(`/api/maintenance/plans`).set(auth('a')).send({ vehicleId: id.gen, name: 'Generator 250 h service', intervalHours: 250 }).expect(201);
    await http().post(`/api/vehicles/${id.gen}/meter-readings`).set(auth('a')).send({ kind: 'HOURS', value: 1_230, note: 'Weekly reading' }).expect(201);
    const plans = await http().get('/api/maintenance/plans').set(auth('a')).expect(200);
    const p = plans.body.find((x: { vehicleId: string }) => x.vehicleId === id.gen);
    expect(p.due).toMatchObject({ status: 'DUE_SOON', nextDueHours: 1_250, remainingHours: 20 });
    expect((await http().get(`/api/vehicles/${id.gen}/meter-readings`).set(auth('a')).expect(200)).body[0]).toMatchObject({ kind: 'HOURS', value: '1230' });
    await http().get(`/api/vehicles/${id.gen}/meter-readings`).set(auth('b')).expect(404);
  });

  it('trailers cannot be driven; the dispatcher couples one to a delivery load; combined and legal limits', async () => {
    // A trailer is not a vehicle that can be assigned to a trip.
    const bad = await http().post('/api/logistics/loads').set(auth('a')).send({ date: tomorrow, branchId: id.branch, vehicleId: id.trailer, driverId: id.driver, orderIds: [id.O1] });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    // The tractor alone has no payload: the load is refused…
    await http().post('/api/logistics/loads').set(auth('a')).send({ date: tomorrow, branchId: id.branch, vehicleId: id.tractor, driverId: id.driver, orderIds: [id.O1] }).expect(422);
    // …so plan it with the tractor's capacity raised temporarily, then rely on the trailer.
    await admin.$executeRawUnsafe(`UPDATE vehicles SET capacity_kg = 10000 WHERE id = $1::uuid`, id.tractor);
    const load = await http().post('/api/logistics/loads').set(auth('a')).send({ date: tomorrow, branchId: id.branch, vehicleId: id.tractor, driverId: id.driver, orderIds: [id.O1] }).expect(201);
    id.trip = load.body.tripId ?? load.body.id;
    await http().patch(`/api/logistics/loads/${id.trip}`).set(auth('a')).send({ addOrderIds: [id.O2] }).expect(422); // 14,000 > 10,000
    await http().patch(`/api/trips/${id.trip}/trailer`).set(auth('a')).send({ trailerId: id.gen }).expect(400); // not a trailer
    await http().patch(`/api/trips/${id.trip}/trailer`).set(auth('a')).send({ trailerId: id.trailer }).expect(200);
    await http().patch(`/api/logistics/loads/${id.trip}`).set(auth('a')).send({ addOrderIds: [id.O2] }).expect(200); // 14,000 ≤ 40,000
    // Legal payload limits cap the combination: 2,000 (tractor) + 10,000 (trailer) < 14,000 loaded.
    await http().patch('/api/company/settings').set(auth('a')).send({ compliance: { maxPayloadKg: { TRACTOR: 2_000, TRAILER: 10_000 } } }).expect(200);
    const over = await http().patch(`/api/trips/${id.trip}/trailer`).set(auth('a')).send({ trailerId: id.trailer }).expect(422);
    expect(over.body.message).toMatch(/exceed/);
    await http().patch('/api/company/settings').set(auth('a')).send({ compliance: { maxPayloadKg: { TRACTOR: 2_000, TRAILER: 20_000 } } }).expect(200);
    // Removing the trailer would leave 14,000 kg on a 10,000 kg (2,000 legal) tractor.
    await http().patch(`/api/trips/${id.trip}/trailer`).set(auth('a')).send({ trailerId: null }).expect(422);
    const trailers = await http().get('/api/trailers').set(auth('a')).expect(200);
    expect(trailers.body.find((x: { id: string }) => x.id === id.trailer).trips.map((x: { id: string }) => x.id)).toEqual([id.trip]);
    await http().patch(`/api/trips/${id.trip}/trailer`).set(auth('b')).send({ trailerId: null }).expect(404);
  });

  it('compliance pack: status per vehicle; dispatch blocked only when enforcement is on', async () => {
    const c = await http().get('/api/compliance').set(auth('a')).expect(200);
    expect(c.body.settings.country).toBe('MM');
    const tractor = c.body.vehicles.find((x: { vehicle: { id: string } }) => x.vehicle.id === id.tractor);
    expect(tractor.requirements.map((r: { type: string; status: string }) => `${r.type}:${r.status}`)).toEqual(['REGISTRATION:MISSING', 'INSURANCE:MISSING', 'INSPECTION:MISSING', 'PERMIT:MISSING']);
    expect(tractor.blocked).toBe(false);
    const gen = c.body.vehicles.find((x: { vehicle: { id: string } }) => x.vehicle.id === id.gen);
    expect(gen.requirements).toEqual([]); // equipment: not on the road
    // Enforce: the trip cannot start while required documents are missing (tractor and trailer).
    await http().patch('/api/company/settings').set(auth('a')).send({ compliance: { enforceDispatch: true } }).expect(200);
    const start = await http().post(`/api/trips/${id.trip}/start`).set(auth('a')).send({}).expect(409);
    expect(start.body.reasons).toEqual(expect.arrayContaining([`${run}-TR: Vehicle licence (RTAD registration, annual renewal) is missing`, `${run}-TL: Roadworthiness inspection is missing`]));
    // Record the documents (registration, insurance, inspection for both; permit does not block).
    const today = new Date().toISOString().slice(0, 10);
    const next = new Date(Date.now() + 300 * DAY).toISOString().slice(0, 10);
    for (const [vid, types] of [[id.tractor, ['REGISTRATION', 'INSURANCE', 'INSPECTION']], [id.trailer, ['REGISTRATION', 'INSPECTION']]] as [string, string[]][]) {
      for (const type of types) await http().post(`/api/vehicles/${vid}/documents`).set(auth('a')).send({ type, number: `${type}-1`, issuedAt: today, expiresAt: next }).expect(201);
    }
    const v = await http().get(`/api/vehicles/${id.tractor}/compliance`).set(auth('a')).expect(200);
    expect(v.body).toMatchObject({ status: 'MISSING', blocked: false }); // permit missing, not blocking
    const started = await http().post(`/api/trips/${id.trip}/start`).set(auth('a')).send({});
    expect(started.status).toBe(200);
    const couplings = await http().get(`/api/vehicles/${id.trailer}/couplings`).set(auth('a')).expect(200);
    expect(couplings.body[0]).toMatchObject({ tractorId: id.tractor, tripId: id.trip, uncoupledAt: null, tractor: `${run}-TR` });
    // Manual uncouple in the yard.
    await http().post(`/api/vehicles/${id.trailer}/couple`).set(auth('a')).send({ tractorId: null }).expect(201);
    expect((await http().get(`/api/vehicles/${id.trailer}/couplings`).set(auth('a')).expect(200)).body[0].uncoupledAt).toBeTruthy();
    await http().patch('/api/company/settings').set(auth('a')).send({ compliance: { enforceDispatch: false } }).expect(200);
    expect((await http().get('/api/compliance').set(auth('b')).expect(200)).body.vehicles.map((x: { vehicle: { id: string } }) => x.vehicle.id)).toEqual([id.vb]);
  });

  it('safety audits: starter templates, scoring, corrective actions owned and verified', async () => {
    const tpls = await http().get('/api/audit-templates').set(auth('a')).expect(200);
    const depot = tpls.body.find((x: { target: string }) => x.target === 'BRANCH');
    const vehicleTpl = tpls.body.find((x: { target: string }) => x.target === 'VEHICLE');
    expect(depot.questions.length).toBeGreaterThan(5);
    const answers = depot.questions.map((q: { key: string }) => ({ key: q.key, result: q.key === 'spill_kit' ? 'FAIL' : q.key === 'lifting' ? 'NA' : 'PASS', note: q.key === 'spill_kit' ? 'No spill kit at the fuel bay' : null }));
    const due = new Date(Date.now() - DAY).toISOString().slice(0, 10); // already overdue, for the alert test
    await http().post('/api/safety-audits').set(auth('a')).send({ templateId: depot.id, vehicleId: id.tractor, answers }).expect(400); // branch audit needs a branch
    const a = await http().post('/api/safety-audits').set(auth('a')).send({ templateId: depot.id, branchId: id.branch, answers, actions: [{ questionKey: 'spill_kit', description: 'Buy and place a spill kit at the fuel bay', ownerUserId: id.owner, dueDate: due }] }).expect(201);
    expect(a.body).toMatchObject({ result: 'PASS', subject: 'Thilawa depot' });
    expect(Number(a.body.score)).toBeGreaterThan(90);
    expect(a.body.actions).toHaveLength(1);
    const actionId = a.body.actions[0].id;
    // The owner (a dispatcher without audit rights) sees and closes their own action; others cannot verify it themselves.
    await http().get('/api/corrective-actions').set(auth('o')).expect(403);
    expect((await http().get('/api/corrective-actions?mine=true').set(auth('o')).expect(200)).body).toEqual([expect.objectContaining({ id: actionId, overdue: true })]);
    await http().patch(`/api/corrective-actions/${actionId}`).set(auth('o')).send({ action: 'DONE' }).expect(400);
    await http().patch(`/api/corrective-actions/${actionId}`).set(auth('o')).send({ action: 'VERIFY' }).expect(403);
    await http().patch(`/api/corrective-actions/${actionId}`).set(auth('o')).send({ action: 'DONE', closureNote: 'Spill kit placed' }).expect(200);
    await http().patch(`/api/corrective-actions/${actionId}`).set(auth('a')).send({ action: 'VERIFY' }).expect(200);
    // A failed critical item on a vehicle audit fails it and raises a repair request.
    const va = vehicleTpl.questions.map((q: { key: string }) => ({ key: q.key, result: q.key === 'brakes' ? 'FAIL' : 'PASS', note: q.key === 'brakes' ? 'Parking brake weak' : null }));
    const v = await http().post('/api/safety-audits').set(auth('a')).send({ templateId: vehicleTpl.id, vehicleId: id.tractor, answers: va }).expect(201);
    expect(v.body.result).toBe('FAIL');
    const rr = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM repair_requests WHERE vehicle_id = $1::uuid AND description LIKE $2`, id.tractor, `${v.body.auditNo}%`);
    expect(rr[0].n).toBe(1);
    const trend = await http().get('/api/safety-audits/trend').set(auth('a')).expect(200);
    expect(trend.body.find((x: { branchId: string }) => x.branchId === id.branch)).toMatchObject({ audits: 2, failed: 1, openActions: 0 });
    expect((await http().get('/api/safety-audits').set(auth('b')).expect(200)).body).toEqual([]);
    await http().get(`/api/safety-audits/${a.body.id}`).set(auth('b')).expect(404);
    await http().patch(`/api/corrective-actions/${actionId}`).set(auth('b')).send({ action: 'REOPEN' }).expect(404);
  });
});
