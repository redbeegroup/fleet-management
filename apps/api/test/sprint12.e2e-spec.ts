/**
 * Sprint 12: cost ledger (depreciation, lease, documents, shared costs by km), TCO, trip costs,
 * budgets vs actual and budget alerts.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { localDate } from '../src/common/time';
import { CostsService } from '../src/modules/costs/costs.service';
import { encodePolyline } from '../src/modules/routing/polyline';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s12${Date.now().toString(36)}`;
const TODAY = localDate(new Date(), 'Asia/Yangon');
const OCT = { from: '2026-10-01', to: '2026-10-31' };
// 12:00 Yangon on a given October day
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T05:30:00Z`);

describe('Sprint 12 costs, budgets, TCO (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S12 ${tag}`, settings: { logistics: { driverCostPerDay: 20_000 } } } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `m-${run}@e2e.local`, fullName: 'Manager', passwordHash, roles: ['FLEET_MANAGER'] } });
      await tx.user.create({ data: { companyId: a, email: `x-${run}@e2e.local`, fullName: 'Executive', passwordHash, roles: ['EXECUTIVE'] } });
      await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      id.Y = (await tx.branch.create({ data: { companyId: a, code: `Y${run}`, name: 'Yangon' } })).id;
      id.M = (await tx.branch.create({ data: { companyId: a, code: `M${run}`, name: 'Mandalay' } })).id;
      id.D1 = (await tx.department.create({ data: { companyId: a, code: `S${run}`, name: 'Sales' } })).id;
      const veh = (plate: string, data: Record<string, unknown>) => tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-${plate}`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', ...data } }).then((v) => v.id);
      // v1: owned, 3.1 M over 100 months → 31,000 / month
      id.v1 = await veh('V1', { branchId: id.Y, departmentId: id.D1, ownership: 'OWNED', purchasePrice: 3_100_000, residualValue: 0, usefulLifeMonths: 100, inServiceAt: new Date('2026-01-01') });
      // v2: leased 62,000 / month from 16 Oct → 16/31 of a month in October = 32,000
      id.v2 = await veh('V2', { branchId: id.Y, ownership: 'LEASED', monthlyLeaseCost: 62_000, inServiceAt: new Date('2026-10-16') });
      // v3: owned, no asset data, no km
      id.v3 = await veh('V3', { branchId: id.M, ownership: 'OWNED' });
      await tx.vehicleDailyStat.createMany({
        data: [
          { companyId: a, vehicleId: id.v1, day: new Date('2026-10-10'), distanceKm: 300 },
          { companyId: a, vehicleId: id.v2, day: new Date('2026-10-20'), distanceKm: 100 },
        ],
      });
      const fuel = { companyId: a, vehicleId: id.v1, odometerKm: 1000, litres: 40, unitPrice: 3000 };
      await tx.fuelRecord.create({ data: { ...fuel, filledAt: at(10), totalCost: 120_000 } });
      await tx.fuelRecord.create({ data: { ...fuel, filledAt: at(11), totalCost: 50_000, approvalStatus: 'PENDING' } }); // not counted
      await tx.workOrder.create({ data: { companyId: a, woNo: `${run}-WO1`, vehicleId: id.v2, type: 'CORRECTIVE', title: 'Brakes', status: 'COMPLETED', completedAt: at(21), totalCost: 80_000 } });
      const trip = await tx.trip.create({
        data: { companyId: a, tripNo: `${run}-T1`, vehicleId: id.v1, originName: 'A', destinationName: 'B', plannedStart: at(10), plannedEnd: at(10), actualStart: at(10), actualEnd: new Date(at(10).getTime() + 3_600_000), status: 'COMPLETED', gpsDistanceKm: 30 },
      });
      id.T1 = trip.id;
      await tx.vehicleExpense.createMany({
        data: [
          { companyId: a, vehicleId: id.v1, category: 'TOLL', incurredAt: at(12), amount: 10_000 },
          { companyId: a, vehicleId: id.v1, category: 'PARKING', incurredAt: at(10), amount: 5_000, tripId: trip.id },
        ],
      });
      // 365,000 for a year → 31 days of October = 31,000
      await tx.vehicleDocument.create({ data: { companyId: a, vehicleId: id.v1, type: 'INSURANCE', amount: 365_000, issuedAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01') } });

      // Control: v4 on a road-routed trip with a driver on duty; v5 assigned to a driver who is off duty.
      const drv = async (n: number) => {
        const u = await tx.user.create({ data: { companyId: a, email: `cd${n}-${run}@e2e.local`, fullName: `Driver ${n}`, passwordHash, roles: ['DRIVER'] } });
        return (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D${n}`, fullName: `Driver ${n}`, userId: u.id } })).id;
      };
      id.dr1 = await drv(1);
      id.dr2 = await drv(2);
      id.v4 = await veh('V4', { branchId: id.Y, gpsDeviceId: `${run}-A` });
      id.v5 = await veh('V5', { branchId: id.Y, gpsDeviceId: `${run}-B` });
      await tx.trip.create({
        data: {
          companyId: a, tripNo: `${run}-T2`, vehicleId: id.v4, driverId: id.dr1, originName: 'A', destinationName: 'B', plannedStart: new Date(), plannedEnd: new Date(), actualStart: new Date(), status: 'ONGOING',
          routeGeometry: encodePolyline([{ lat: 16.8, lng: 96.1 }, { lat: 16.8, lng: 96.2 }]), routingSource: 'osrm',
        },
      });
      await tx.dutySession.create({ data: { companyId: a, driverId: id.dr1, startedAt: new Date('2026-10-01') } });
      await tx.vehicleAssignment.create({ data: { companyId: a, vehicleId: id.v5, driverId: id.dr2, startAt: new Date('2026-10-01') } });
      id.fence = (await tx.geofence.create({ data: { companyId: a, name: 'Thilawa port', category: 'RESTRICTED', shape: 'CIRCLE', centerLat: 16.8, centerLng: 96.13, radiusM: 300 } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'm', 'x', 'd']) t[k] = (await http().post('/api/auth/login').send({ email: `${k}-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const tbl of ['approval_decisions', 'approval_requests', 'telemetry_events', 'vehicle_telemetry_state', 'vehicle_last_positions', 'vehicle_positions', 'geofences', 'duty_sessions', 'vehicle_assignments', 'drivers', 'budgets', 'shared_costs', 'notifications', 'fuel_records', 'work_orders', 'vehicle_expenses', 'vehicle_documents', 'vehicle_daily_stats', 'trip_status_events', 'trips',
          'vehicle_status_events', 'vehicles', 'departments', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('records shared costs and allocates them by km', async () => {
    await http().post('/api/costs/shared').set(auth('m')).send({ period: '2026-10', category: 'OTHER', description: 'Workshop overhead', amount: 40_000 }).expect(201);
    await http().post('/api/costs/shared').set(auth('m')).send({ period: '2026-10', branchId: id.M, category: 'INSURANCE', description: 'Mandalay fleet policy', amount: 5_000 }).expect(201);
    await http().post('/api/costs/shared').set(auth('m')).send({ period: '2026-10', branchId: id.Y, departmentId: id.D1, description: 'x', amount: 1 }).expect(400);
    await http().post('/api/costs/shared').set(auth('x')).send({ period: '2026-10', description: 'Nope', amount: 1 }).expect(403);
    const list = (await http().get('/api/costs/shared').query(OCT).set(auth('x')).expect(200)).body;
    expect(list).toHaveLength(2);
    expect((await http().get('/api/costs/shared').query(OCT).set(auth('b')).expect(200)).body).toHaveLength(0);
  });

  it('computes TCO per vehicle from the ledger', async () => {
    const r = (await http().get('/api/analytics/tco').query(OCT).set(auth('x')).expect(200)).body;
    const v = (vid: string) => r.vehicles.find((x: { id: string }) => x.id === vid);
    expect(v(id.v1).byCategory).toEqual({ DEPRECIATION: 31_000, FUEL: 120_000, TOLL: 10_000, PARKING: 5_000, INSURANCE: 31_000, OTHER: 30_000 });
    expect(v(id.v1)).toMatchObject({ total: 227_000, km: 300, perKm: 756.67, ownershipCost: 31_000, shared: 30_000, assetDataMissing: false, bookValue: 2_790_000 });
    expect(v(id.v2).byCategory).toEqual({ LEASE: 32_000, MAINTENANCE: 80_000, OTHER: 10_000 });
    expect(v(id.v2).total).toBe(122_000);
    expect(v(id.v3)).toMatchObject({ total: 0, assetDataMissing: true });
    expect(r.totals).toMatchObject({ total: 349_000, km: 400, unallocated: 5_000 });
    expect(r.unallocated).toEqual([expect.objectContaining({ description: 'Mandalay fleet policy', amount: 5_000 })]);
    // Branch filter: shared overhead still split over the whole company
    const y = (await http().get('/api/analytics/tco').query({ ...OCT, branchId: id.Y }).set(auth('x')).expect(200)).body;
    const yIds = y.vehicles.map((x: { id: string }) => x.id);
    expect(yIds).toEqual(expect.arrayContaining([id.v1, id.v2]));
    expect(yIds).not.toContain(id.v3);
    expect(y.totals.total).toBe(349_000);
    const csv = await http().get('/api/analytics/tco.csv').query(OCT).set(auth('x')).expect(200);
    expect(csv.text.split('\n')[0]).toContain('Per km');
    await http().get('/api/analytics/tco').query(OCT).set(auth('d')).expect(403);
    expect((await http().get('/api/analytics/tco').query(OCT).set(auth('b')).expect(200)).body.vehicles).toHaveLength(0);
  });

  it('costs trips with the full cost per km', async () => {
    const r = (await http().get('/api/analytics/trip-costs').query(OCT).set(auth('x')).expect(200)).body;
    const t1 = r.trips.find((x: { tripId: string }) => x.tripId === id.T1);
    // v1 cost without the trip's own parking: 222,000 / 300 km = 740 / km
    expect(t1).toMatchObject({ km: 30, ratePerKm: 740, running: 22_200, expenses: 5_000, driverCost: 20_000, total: 47_200 });
  });

  it('saves budgets and compares them with actuals', async () => {
    const lines = [
      { period: '2026-10', branchId: id.Y, category: 'FUEL', amount: 100_000 },
      { period: '2026-10', departmentId: id.D1, category: 'FUEL', amount: 200_000 },
      { period: '2026-10', category: 'MAINTENANCE', amount: 80_000 },
    ];
    expect((await http().put('/api/costs/budgets').set(auth('m')).send({ lines }).expect(200)).body).toEqual({ saved: 3, removed: 0 });
    await http().put('/api/costs/budgets').set(auth('m')).send({ lines: [{ period: '2026-10', branchId: id.Y, departmentId: id.D1, category: 'FUEL', amount: 1 }] }).expect(400);
    await http().put('/api/costs/budgets').set(auth('m')).send({ lines: [{ period: '2026-10', branchId: '00000000-0000-4000-8000-000000000000', category: 'FUEL', amount: 1 }] }).expect(400);
    await http().put('/api/costs/budgets').set(auth('x')).send({ lines }).expect(403);

    const br = (await http().get('/api/costs/budgets').query({ year: 2026, dimension: 'branch' }).set(auth('x')).expect(200)).body;
    const ygn = br.scopes.find((s: { id: string }) => s.id === id.Y);
    const fuelOct = ygn.lines.find((l: { category: string }) => l.category === 'FUEL').months[9];
    expect(fuelOct).toMatchObject({ period: '2026-10', budget: 100_000, actual: 120_000, variance: -20_000, status: 'OVER' });
    const dep = (await http().get('/api/costs/budgets').query({ year: 2026, dimension: 'department' }).set(auth('x')).expect(200)).body;
    const sales = dep.scopes.find((s: { id: string }) => s.id === id.D1).lines.find((l: { category: string }) => l.category === 'FUEL').months[9];
    expect(sales).toMatchObject({ budget: 200_000, actual: 120_000, usedPct: 60, status: 'OK' });
    const co = (await http().get('/api/costs/budgets').query({ year: 2026, dimension: 'company' }).set(auth('x')).expect(200)).body;
    expect(co.scopes[0].lines.find((l: { category: string }) => l.category === 'MAINTENANCE').months[9]).toMatchObject({ budget: 80_000, actual: 80_000, status: 'AT_RISK' });
    // Tenant B sees none of it
    const b = (await http().get('/api/costs/budgets').query({ year: 2026, dimension: 'company' }).set(auth('b')).expect(200)).body;
    expect(b.scopes[0].budget).toBe(0);

    // Copy to next year +10 %, then again without overwrite
    expect((await http().post('/api/costs/budgets/copy').set(auth('m')).send({ fromYear: 2026, toYear: 2027, changePct: 10 }).expect(201)).body).toEqual({ copied: 3, skipped: 0 });
    expect((await http().post('/api/costs/budgets/copy').set(auth('m')).send({ fromYear: 2026, toYear: 2027 }).expect(201)).body).toEqual({ copied: 0, skipped: 3 });
    const next = (await http().get('/api/costs/budgets').query({ year: 2027, dimension: 'company' }).set(auth('x')).expect(200)).body;
    expect(next.scopes[0].lines.find((l: { category: string }) => l.category === 'MAINTENANCE').months[9].budget).toBe(88_000);
    // amount 0 removes a line
    expect((await http().put('/api/costs/budgets').set(auth('m')).send({ lines: [{ period: '2027-10', category: 'MAINTENANCE', amount: 0 }] }).expect(200)).body).toEqual({ saved: 0, removed: 1 });
  });

  it('alerts managers once per budget level', async () => {
    const period = TODAY.slice(0, 7);
    await http().put('/api/costs/budgets').set(auth('m')).send({ lines: [{ period, branchId: id.M, category: 'FUEL', amount: 1000 }] }).expect(200);
    const fuel = (cost: number) =>
      admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.fuelRecord.create({ data: { companyId: companyIds[0], vehicleId: id.v3, filledAt: new Date(), odometerKm: 1, litres: 1, unitPrice: cost, totalCost: cost } });
      });
    const alerts = () => admin.notification.count({ where: { companyId: companyIds[0], topic: 'budget.alert' } });
    const costs = app.get(CostsService);
    await fuel(950);
    await costs.budgetAlerts();
    expect(await alerts()).toBe(2); // company admin + fleet manager, 90 %
    await costs.budgetAlerts();
    expect(await alerts()).toBe(2);
    await fuel(100);
    await costs.budgetAlerts();
    expect(await alerts()).toBe(4); // 100 %
    // Changing the amount re-arms the alerts
    await http().put('/api/costs/budgets').set(auth('m')).send({ lines: [{ period, branchId: id.M, category: 'FUEL', amount: 1100 }] }).expect(200);
    await costs.budgetAlerts();
    expect(await alerts()).toBe(6);
  });

  it('accepts cost-of-ownership fields on vehicles', async () => {
    const r = await http().patch(`/api/vehicles/${id.v3}`).set(auth('m')).send({ purchasePrice: 1_200_000, residualValue: 200_000, usefulLifeMonths: 60, inServiceAt: '2026-10-01' }).expect(200);
    expect(Number(r.body.purchasePrice)).toBe(1_200_000);
    const tco = (await http().get('/api/analytics/tco').query(OCT).set(auth('x')).expect(200)).body;
    const v3 = tco.vehicles.find((x: { id: string }) => x.id === id.v3);
    expect(v3).toMatchObject({ assetDataMissing: false, byCategory: { DEPRECIATION: 16_666.67 } });
  });

  it('validates control settings', async () => {
    await http().patch('/api/company/settings').set(auth('a')).send({ control: { workingHours: [null] } }).expect(400);
    const r = await http().patch('/api/company/settings').set(auth('a')).send({ control: { workingHoursEnabled: true, requireDriverOnDuty: true, movementWithoutTrip: true, offRouteMinutes: 5 } }).expect(200);
    expect(r.body.control).toMatchObject({ workingHoursEnabled: true, requireDriverOnDuty: true, offRouteMeters: 500, movementWithoutTrip: true });
  });

  it('raises off-route and unauthorised-use events from GPS', async () => {
    const telematics = app.get(TelematicsService);
    // Monday 2026-10-05 10:00 Yangon: v4 follows its route, leaves it ~1.1 km for 6 minutes, comes back.
    const mon = (m: number) => new Date(Date.parse('2026-10-05T03:30:00Z') + m * 60_000);
    const A = `${run}-A`;
    await telematics.ingest([
      { deviceId: A, recordedAt: mon(0), latitude: 16.8, longitude: 96.11, speedKmh: 40, ignition: true },
      { deviceId: A, recordedAt: mon(2), latitude: 16.81, longitude: 96.15, speedKmh: 40, ignition: true },
      { deviceId: A, recordedAt: mon(5), latitude: 16.81, longitude: 96.16, speedKmh: 40, ignition: true },
    ]);
    await telematics.ingest([
      { deviceId: A, recordedAt: mon(8), latitude: 16.81, longitude: 96.17, speedKmh: 40, ignition: true },
      { deviceId: A, recordedAt: mon(10), latitude: 16.8, longitude: 96.18, speedKmh: 40, ignition: true },
    ]);
    const ev = async (vehicleId: string) => (await http().get('/api/tracking/events').query({ vehicleId, pageSize: 50 }).set(auth('m')).expect(200)).body.items as { type: string; endedAt: string | null; data: Record<string, unknown> }[];
    const a = await ev(id.v4);
    expect(a.map((e) => e.type)).toEqual(['OFF_ROUTE']);
    expect(a[0]).toMatchObject({ endedAt: expect.any(String), data: expect.objectContaining({ tripNo: `${run}-T2`, maxDistanceM: expect.any(Number) }) });
    expect(a[0].data.maxDistanceM as number).toBeGreaterThan(1000);

    // Sunday 2026-10-04 09:00 Yangon: v5 drives ~2 km with no trip and its driver off duty, into the port, then parks.
    const sun = (m: number) => new Date(Date.parse('2026-10-04T02:30:00Z') + m * 60_000);
    const B = `${run}-B`;
    await telematics.ingest([
      { deviceId: B, recordedAt: sun(0), latitude: 16.8, longitude: 96.11, speedKmh: 30, ignition: true },
      { deviceId: B, recordedAt: sun(2), latitude: 16.8, longitude: 96.12, speedKmh: 30, ignition: true },
      { deviceId: B, recordedAt: sun(4), latitude: 16.8, longitude: 96.13, speedKmh: 30, ignition: true },
      { deviceId: B, recordedAt: sun(6), latitude: 16.8, longitude: 96.131, speedKmh: 0, ignition: false },
    ]);
    const b = await ev(id.v5);
    const types = b.map((e) => e.type).sort();
    expect(types).toEqual(['AFTER_HOURS', 'GEOFENCE_ENTER', 'NO_DRIVER', 'RESTRICTED_AREA', 'UNAUTHORISED_MOVEMENT']);
    for (const t of ['AFTER_HOURS', 'NO_DRIVER', 'UNAUTHORISED_MOVEMENT']) expect(b.find((e) => e.type === t)!.endedAt).not.toBeNull();
    expect(b.find((e) => e.type === 'NO_DRIVER')!.data).toMatchObject({ reason: 'driver not on duty' });
    // Managers were alerted
    const topics = (await admin.notification.findMany({ where: { companyId: companyIds[0], topic: { startsWith: 'telematics.' } }, select: { topic: true } })).map((n) => n.topic);
    expect(new Set(topics)).toEqual(new Set(['telematics.off_route', 'telematics.unauthorised_movement', 'telematics.after_hours', 'telematics.no_driver', 'telematics.restricted_area']));
  });

  it('replays driver actions with the same Idempotency-Key and keeps their real time', async () => {
    const tok = (await http().post('/api/auth/login').send({ email: `cd1-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
    const drv = { Authorization: `Bearer ${tok}` };
    const sessions = () => admin.dutySession.count({ where: { driverId: id.dr1 } });
    const end1 = await http().post('/api/me/duty/end').set(drv).set('Idempotency-Key', `${run}-end-0001`).send({}).expect(200);
    const end2 = await http().post('/api/me/duty/end').set(drv).set('Idempotency-Key', `${run}-end-0001`).send({}).expect(200);
    expect(end2.body).toEqual(end1.body);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const s1 = await http().post('/api/me/duty/start').set(drv).set('Idempotency-Key', `${run}-start-001`).send({ occurredAt: hourAgo.toISOString() }).expect(201);
    expect(new Date(s1.body.startedAt).getTime()).toBe(hourAgo.getTime());
    const s2 = await http().post('/api/me/duty/start').set(drv).set('Idempotency-Key', `${run}-start-001`).send({ occurredAt: hourAgo.toISOString() }).expect(201);
    expect(s2.body.id).toBe(s1.body.id);
    expect(await sessions()).toBe(2);
    // Same key, different request → 422; malformed key → 422
    await http().post('/api/me/duty/start').set(drv).set('Idempotency-Key', `${run}-start-001`).send({}).expect(422);
    await http().post('/api/me/duty/end').set(drv).set('Idempotency-Key', 'bad key!').send({}).expect(422);
    // Keys are per user: the same key from another user is a new request
    await http().post('/api/approvals/00000000-0000-4000-8000-000000000000/approve').set(auth('m')).set('Idempotency-Key', `${run}-start-001`).send({}).expect(404);
    // Client time bounds
    await http().post('/api/me/duty/end').set(drv).send({ occurredAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);
    await http().post('/api/me/duty/end').set(drv).send({ occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }).expect(400);
    // Without a key nothing changes: a second start is rejected as usual
    const again = await http().post('/api/me/duty/start').set(drv).send({});
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it('gives managers a mobile summary and approval details', async () => {
    await http().patch('/api/company/settings').set(auth('a')).send({ approvals: { expenseAbove: 1000 } }).expect(200);
    await http().post('/api/expenses').set(auth('m')).send({ vehicleId: id.v1, category: 'FINE', incurredAt: new Date().toISOString(), amount: 25_000, description: 'Parking fine Bahan' }).expect(201);
    const sum = (await http().get('/api/mobile/manager-summary').set(auth('a')).expect(200)).body;
    expect(sum.pendingApprovals).toBe(1);
    expect(sum.vehicles.AVAILABLE).toBeGreaterThanOrEqual(5);
    expect(sum.tripsOngoing).toBe(1);
    expect(sum.budgets).toEqual([expect.objectContaining({ scope: 'Mandalay', category: 'FUEL', status: 'AT_RISK' })]);
    await http().get('/api/mobile/manager-summary').set(auth('d')).expect(403);
    // The requester does not see their own request as pending
    expect((await http().get('/api/mobile/manager-summary').set(auth('m')).expect(200)).body.pendingApprovals).toBe(0);

    const list = (await http().get('/api/approvals').query({ scope: 'pending' }).set(auth('a')).expect(200)).body;
    const req = (Array.isArray(list) ? list : list.items)[0];
    const detail = (await http().get(`/api/approvals/${req.id}`).set(auth('a')).expect(200)).body;
    expect(detail.details.facts).toEqual(expect.arrayContaining([['Vehicle', `${run}-V1`], ['Category', 'FINE'], ['Description', 'Parking fine Bahan']]));
    expect(detail.details.fileIds).toEqual([]);
    // Approving twice from a phone with the same key decides once
    const key = `${run}-approve-1`;
    const one = await http().post(`/api/approvals/${req.id}/approve`).set(auth('a')).set('Idempotency-Key', key).send({ note: 'ok' }).expect(200);
    const two = await http().post(`/api/approvals/${req.id}/approve`).set(auth('a')).set('Idempotency-Key', key).send({ note: 'ok' }).expect(200);
    expect(two.body).toEqual(one.body);
    expect(await admin.approvalDecision.count({ where: { requestId: req.id } })).toBe(1);
  });
});

