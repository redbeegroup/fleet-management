/**
 * Sprint 8: inspections (with the pre-trip gate), training & certifications, incentives & penalties.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { localDate } from '../src/common/time';
import { IncentivesService } from '../src/modules/incentives/incentives.service';
import { TrainingService } from '../src/modules/training/training.service';

const PASSWORD = 'E2ePassword123!';
const run = `s8${Date.now().toString(36)}`;
const today = localDate(new Date(), 'Asia/Yangon');
const daysFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('Sprint 8 inspections, training, incentives (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let token: string; // company admin
  let tokenB: string;
  let managerToken: string;
  let driverToken: string;
  let dispatcherToken: string;
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
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S8 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `m-${run}@e2e.local`, fullName: 'Manager', passwordHash, roles: ['FLEET_MANAGER'] } });
      await tx.user.create({ data: { companyId: a, email: `p-${run}@e2e.local`, fullName: 'Disp', passwordHash, roles: ['DISPATCHER'] } });
      const du = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver One', passwordHash, roles: ['DRIVER'] } });
      const exp = new Date(Date.now() + 365 * 86_400_000);
      driver = (await tx.driver.create({
        data: { companyId: a, employeeNo: `${run}-1`, fullName: 'Driver One', userId: du.id, licenses: { create: { companyId: a, number: 'L1', licenseClass: 'E', expiresAt: exp } } },
      })).id;
      other = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-2`, fullName: 'Driver Two' } })).id;
      truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-T`, make: 'Hino', model: '300', vehicleClass: 'TRUCK' } })).id;
      van = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN' } })).id;
      await tx.vehicleAssignment.create({ data: { companyId: a, vehicleId: truck, driverId: driver, startAt: new Date(Date.now() - 86_400_000) } });
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;
    token = await login(`a-${run}@e2e.local`);
    tokenB = await login(`b-${run}@e2e.local`);
    managerToken = await login(`m-${run}@e2e.local`);
    driverToken = await login(`d-${run}@e2e.local`);
    dispatcherToken = await login(`p-${run}@e2e.local`);
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        for (const t of ['driver_adjustments', 'driver_trainings', 'training_courses', 'inspections', 'inspection_templates', 'repair_requests', 'notifications', 'trip_status_events',
          'trips', 'vehicle_status_events', 'vehicle_assignments', 'vehicles', 'driver_licenses', 'drivers', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  describe('inspections', () => {
    let preTrip: { id: string; items: { key: string; critical: boolean }[] };

    it('seeds default checklists and lets managers edit them', async () => {
      const res = await http().get('/api/inspection-templates').set(auth(dispatcherToken)).expect(200);
      expect(res.body.map((t: { kind: string }) => t.kind).sort()).toEqual(['POST_TRIP', 'PRE_TRIP']);
      preTrip = res.body.find((t: { kind: string }) => t.kind === 'PRE_TRIP');
      // A van-only checklist is not offered for the truck.
      await http()
        .post('/api/inspection-templates')
        .set(auth(managerToken))
        .send({ name: 'Van check', kind: 'PERIODIC', vehicleClasses: ['van'], items: [{ key: 'doors', label: 'Sliding door' }] })
        .expect(201);
      await http().post('/api/inspection-templates').set(auth(managerToken)).send({ name: 'Dup', kind: 'PERIODIC', items: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] }).expect(400);
      await http().post('/api/inspection-templates').set(auth(dispatcherToken)).send({}).expect(403);
      const mine = await http().get(`/api/me/inspection-templates?vehicleId=${truck}`).set(auth(driverToken)).expect(200);
      expect(mine.body.map((t: { name: string }) => t.name)).not.toContain('Van check');
      await http().get(`/api/me/inspection-templates?vehicleId=${van}`).set(auth(driverToken)).expect(403);
      expect((await http().get('/api/inspection-templates').set(auth(tokenB)).expect(200)).body.some((t: { name: string }) => t.name === 'Van check')).toBe(false);
    });

    it('blocks trip start without a valid pre-trip inspection when required', async () => {
      await http().patch('/api/company/settings').set(auth(token)).send({ inspections: { requirePreTrip: true, preTripValidHours: 12 } }).expect(200);
      const start = new Date(Date.now() + 3_600_000).toISOString();
      const end = new Date(Date.now() + 5 * 3_600_000).toISOString();
      const trip = (await http().post('/api/trips').set(auth(token)).send({ originName: 'Yard', destinationName: 'Port', plannedStart: start, plannedEnd: end, vehicleId: truck, driverId: driver }).expect(201))
        .body;
      const blocked = await http().post(`/api/me/trips/${trip.id}/start`).set(auth(driverToken)).send({}).expect(400);
      expect(blocked.body.message).toMatch(/pre-trip inspection/);

      // Incomplete answers are rejected with item-level errors.
      const bad = await http().post('/api/me/inspections').set(auth(driverToken)).send({ vehicleId: truck, templateId: preTrip.id, answers: [{ key: 'brakes', ok: true }] }).expect(400);
      expect(bad.body.errors.length).toBeGreaterThan(0);

      // Critical defect → FAIL, repair request raised, managers alerted, trip still blocked.
      const answers = (failKey?: string) => preTrip.items.map((i) => (i.key === failKey ? { key: i.key, ok: false, note: 'Soft pedal' } : { key: i.key, ok: true }));
      const fail = await http().post('/api/me/inspections').set(auth(driverToken)).send({ vehicleId: truck, templateId: preTrip.id, answers: answers('brakes'), odometerKm: 1200 }).expect(201);
      expect(fail.body).toMatchObject({ result: 'FAIL', defects: 1, criticalDefects: 1, driverId: driver, kind: 'PRE_TRIP' });
      expect(fail.body.inspectionNo).toMatch(/^INS-\d{4}-000001$/);
      expect(fail.body.repairRequestId).toBeTruthy();
      const rr = await http().get('/api/maintenance/repair-requests').set(auth(managerToken)).expect(200);
      expect(rr.body.find((r: { id: string }) => r.id === fail.body.repairRequestId)).toMatchObject({ severity: 'HIGH' });
      const notes = await http().get('/api/notifications').set(auth(managerToken)).expect(200);
      expect(notes.body.some((n: { topic: string }) => n.topic === 'inspection.failed')).toBe(true);
      expect((await http().post(`/api/me/trips/${trip.id}/start`).set(auth(driverToken)).send({}).expect(400)).body.message).toMatch(/failed/);

      // Non-critical defect → DEFECTS, the trip may start.
      const ok = await http().post('/api/me/inspections').set(auth(driverToken)).send({ vehicleId: truck, templateId: preTrip.id, answers: answers('horn_wipers') }).expect(201);
      expect(ok.body.result).toBe('DEFECTS');
      await http().post(`/api/me/trips/${trip.id}/start`).set(auth(driverToken)).send({}).expect(200);

      await http().post('/api/me/inspections').set(auth(driverToken)).send({ vehicleId: van, templateId: preTrip.id, answers: answers() }).expect(400);
      const mine = await http().get('/api/me/inspections').set(auth(driverToken)).expect(200);
      expect(mine.body.total).toBe(2);
      const list = await http().get(`/api/inspections?vehicleId=${truck}&result=FAIL`).set(auth(dispatcherToken)).expect(200);
      expect(list.body.total).toBe(1);
      await http().get(`/api/inspections/${fail.body.id}`).set(auth(tokenB)).expect(404);
      await http().patch('/api/company/settings').set(auth(token)).send({ inspections: { requirePreTrip: false } }).expect(200);
    });
  });

  describe('training', () => {
    let course: string;

    it('tracks certificates, computes expiry and the compliance matrix', async () => {
      course = (await http().post('/api/training/courses').set(auth(managerToken)).send({ code: 'ddc', name: 'Defensive driving', validityMonths: 24, mandatory: true }).expect(201)).body.id;
      await http().post('/api/training/courses').set(auth(managerToken)).send({ code: 'DDC', name: 'Duplicate' }).expect(409);
      await http().post('/api/training/courses').set(auth(dispatcherToken)).send({ code: 'X', name: 'X course' }).expect(403);

      // Driver One: completed ~2 years ago → expires in 10 days (EXPIRING). Driver Two: none (MISSING).
      const completed = new Date(Date.parse(`${daysFrom(10)}T00:00:00Z`));
      completed.setUTCFullYear(completed.getUTCFullYear() - 2);
      const rec = await http()
        .post(`/api/drivers/${driver}/training`)
        .set(auth(managerToken))
        .send({ courseId: course, completedAt: completed.toISOString().slice(0, 10), provider: 'MMRSC', certificateNo: 'C-1' })
        .expect(201);
      expect(rec.body.expiresAt.slice(0, 10)).toBe(daysFrom(10));
      await http().post(`/api/drivers/${driver}/training`).set(auth(managerToken)).send({ courseId: course, completedAt: daysFrom(5) }).expect(400); // future
      await http().post(`/api/drivers/${driver}/training`).set(auth(tokenB)).send({ courseId: course, completedAt: today }).expect(404);

      const m = await http().get('/api/training/matrix').set(auth(dispatcherToken)).expect(200);
      const row = (id: string) => m.body.drivers.find((d: { id: string }) => d.id === id);
      expect(row(driver).cells[course]).toMatchObject({ status: 'EXPIRING' });
      expect(row(driver).compliant).toBe(true);
      expect(row(other)).toMatchObject({ compliant: false, cells: { [course]: { status: 'MISSING' } } });
      expect(m.body.summary).toMatchObject({ drivers: 2, compliant: 1 });

      const mine = await http().get('/api/me/training').set(auth(driverToken)).expect(200);
      expect(mine.body.status).toEqual([expect.objectContaining({ code: 'DDC', status: 'EXPIRING' })]);
    });

    it('alerts managers and the driver about expiring certificates once', async () => {
      const t = app.get(TrainingService);
      const first = await t.expiryAlerts();
      expect(first).toBeGreaterThanOrEqual(2);
      const notes = await http().get('/api/notifications').set(auth(driverToken)).expect(200);
      expect(notes.body.filter((n: { topic: string }) => n.topic === 'driver.training.expiring')).toHaveLength(1);
      const again = await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx.notification.count({ where: { companyId: companyIds[0], topic: 'driver.training.expiring' } });
      });
      await t.expiryAlerts();
      const after = await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx.notification.count({ where: { companyId: companyIds[0], topic: 'driver.training.expiring' } });
      });
      expect(after).toBe(again);
    });
  });

  describe('incentives & penalties', () => {
    const period = today.slice(0, 7);

    it('proposes, approves with segregation of duties, and summarizes', async () => {
      const bonus = (await http().post('/api/adjustments').set(auth(managerToken)).send({ driverId: driver, kind: 'INCENTIVE', category: 'ON_TIME', period, amount: 50_000, reason: 'All deliveries on time' }).expect(201)).body;
      const fine = (await http().post('/api/adjustments').set(auth(token)).send({ driverId: driver, kind: 'PENALTY', category: 'TRAFFIC_FINE', period, amount: 20_000, reason: 'Speeding ticket' }).expect(201)).body;
      await http().post('/api/adjustments').set(auth(managerToken)).send({ driverId: driver, kind: 'INCENTIVE', category: 'OTHER', period: '2026-13', amount: 1, reason: 'bad period' }).expect(400);
      await http().post('/api/adjustments').set(auth(tokenB)).send({ driverId: driver, kind: 'INCENTIVE', category: 'OTHER', period, amount: 1, reason: 'other tenant' }).expect(400);

      await http().post(`/api/adjustments/${bonus.id}/approve`).set(auth(managerToken)).send({}).expect(403); // managers cannot approve
      await http().post(`/api/adjustments/${fine.id}/approve`).set(auth(token)).send({}).expect(403); // own proposal
      await http().post(`/api/adjustments/${bonus.id}/reject`).set(auth(token)).send({}).expect(400); // reason required
      await http().patch(`/api/adjustments/${bonus.id}`).set(auth(managerToken)).send({ amount: 60_000 }).expect(200);
      await http().post(`/api/adjustments/${bonus.id}/approve`).set(auth(token)).send({ note: 'ok' }).expect(200);
      await http().patch(`/api/adjustments/${bonus.id}`).set(auth(managerToken)).send({ amount: 1 }).expect(400); // decided
      await http().post(`/api/adjustments/${bonus.id}/approve`).set(auth(token)).send({}).expect(400);

      const driverNotes = await http().get('/api/notifications').set(auth(driverToken)).expect(200);
      expect(driverNotes.body.some((n: { topic: string }) => n.topic === 'driver.adjustment')).toBe(true);

      const sum = await http().get(`/api/adjustments/summary?period=${period}`).set(auth(managerToken)).expect(200);
      expect(sum.body.drivers).toEqual([expect.objectContaining({ id: driver, incentives: 60_000, penalties: 0, net: 60_000, pending: 1 })]);
      const csv = await http().get(`/api/adjustments/export.csv?period=${period}`).set(auth(token)).expect(200);
      expect(csv.text.split('\n')[1]).toContain(`${period},${run}-1,Driver One,60000,0,60000,1,MMK`);
      expect((await http().get(`/api/adjustments/summary?period=${period}`).set(auth(tokenB)).expect(200)).body.drivers).toHaveLength(0);
      await http().get(`/api/adjustments?period=${period}`).set(auth(driverToken)).expect(403);
      const mine = await http().get('/api/me/adjustments').set(auth(driverToken)).expect(200);
      expect(mine.body.map((a: { status: string }) => a.status).sort()).toEqual(['APPROVED', 'PROPOSED']);
    });

    it('proposes safety bonuses automatically and idempotently', async () => {
      // Give Driver One a scored month: 100 km on the assigned truck, no events.
      const last = (await import('../src/modules/incentives/rules')).previousPeriod(today);
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.vehicleAssignment.updateMany({ where: { vehicleId: truck }, data: { startAt: new Date(`${last.from}T00:00:00Z`) } });
        await tx.vehicleDailyStat.create({ data: { companyId: companyIds[0], vehicleId: truck, day: new Date(last.to), distanceKm: 100, engineMinutes: 90, movingMinutes: 80, idleMinutes: 10, maxSpeedKmh: 60 } });
      });
      const svc = app.get(IncentivesService);
      expect(await svc.proposeMonthly(new Date(`${today}T06:00:00Z`))).toBe(0); // disabled by default
      await http().patch('/api/company/settings').set(auth(token)).send({ incentives: { safetyBonusEnabled: true, safetyBonusAmount: 25_000 } }).expect(200);
      expect(await svc.proposeMonthly(new Date(`${today}T06:00:00Z`))).toBe(1);
      expect(await svc.proposeMonthly(new Date(`${today}T06:00:00Z`))).toBe(0);
      const list = await http().get(`/api/adjustments?period=${last.period}`).set(auth(token)).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ driverId: driver, category: 'SAFETY_BONUS', source: 'auto:safety-bonus', amount: '25000', status: 'PROPOSED' })]);
      // Automatic proposals have no proposer, so an approver can decide them.
      await http().post(`/api/adjustments/${list.body[0].id}/approve`).set(auth(token)).send({}).expect(200);
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.vehicleDailyStat.deleteMany({ where: { vehicleId: truck } });
      });
    });
  });
});
