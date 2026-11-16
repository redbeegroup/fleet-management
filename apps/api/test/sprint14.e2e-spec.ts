/**
 * Sprint 14: site visits (geofences + GPS arrival at delivery stops), loading/unloading report,
 * user administration with e-mail invitations and password reset, group company administration.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { localDate } from '../src/common/time';
import { AccountMailer } from '../src/modules/iam/accounts.service';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s14${Date.now().toString(36)}`;

describe('Sprint 14 site visits, accounts, group admin (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let mailer: AccountMailer;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });
  const lastLink = (to: string) => {
    const m = [...mailer.recent].reverse().find((x) => x.to === to);
    return m ? /set-password\?token=([\w-]+)/.exec(m.text)![1] : null;
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S14 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `s-${run}@e2e.local`, fullName: 'Super', passwordHash, roles: ['SUPER_ADMIN'] } });
      await tx.user.create({ data: { companyId: a, email: `m-${run}@e2e.local`, fullName: 'Manager', passwordHash, roles: ['FLEET_MANAGER'] } });
      id.depot = (await tx.branch.create({ data: { companyId: a, code: `D${run}`, name: 'Depot' } })).id;
      await tx.geofence.create({ data: { companyId: a, name: 'Main depot', category: 'BRANCH', shape: 'CIRCLE', centerLat: 16.8, centerLng: 96.1, radiusM: 200 } });
      const u = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      id.driver = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver', userId: u.id } })).id;
      id.v = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', gpsDeviceId: `${run}-G` } })).id;
      const c1 = await tx.customer.create({ data: { companyId: a, code: `${run}-C1`, name: 'Shop One', latitude: 16.82, longitude: 96.12 } });
      const c2 = await tx.customer.create({ data: { companyId: a, code: `${run}-C2`, name: 'Shop Two', latitude: 16.84, longitude: 96.12 } });
      const trip = await tx.trip.create({ data: { companyId: a, tripNo: `${run}-T`, kind: 'DELIVERY', vehicleId: id.v, driverId: id.driver, originName: 'Depot', destinationName: 'Depot', plannedStart: new Date(), plannedEnd: new Date(), actualStart: new Date(), status: 'ONGOING' } });
      id.trip = trip.id;
      id.s1 = (await tx.tripStop.create({ data: { companyId: a, tripId: trip.id, seq: 1, customerId: c1.id, name: 'Shop One', latitude: 16.82, longitude: 96.12 } })).id;
      id.s2 = (await tx.tripStop.create({ data: { companyId: a, tripId: trip.id, seq: 2, customerId: c2.id, name: 'Shop Two', latitude: 16.84, longitude: 96.12, status: 'ARRIVED', arrivedAt: new Date(Date.now() - 3 * 3_600_000) } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    mailer = app.get(AccountMailer);
    for (const k of ['a', 'b', 's', 'm', 'd']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
  });

  // Every request here comes from one IP; the login limit (10/min) is real but would block this suite.
  beforeEach(() => {
    const store = app.get<ThrottlerStorageService>(getStorageToken());
    store.storage.clear();
    (store as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const extra = (await tx.company.findMany({ where: { code: { startsWith: `G${run}`.toUpperCase() } }, select: { id: true } })).map((c) => c.id);
      for (const companyId of [...companyIds, ...extra]) {
        for (const tbl of ['site_visits', 'auth_tokens', 'refresh_tokens', 'telemetry_events', 'vehicle_telemetry_state', 'vehicle_last_positions', 'vehicle_positions', 'notifications', 'trip_stops', 'trips', 'customers', 'geofences',
          'vehicle_status_events', 'vehicles', 'drivers', 'branches', 'company_counters', 'audit_logs', 'users']) {
          const col = tbl === 'refresh_tokens' ? 'user_id IN (SELECT id FROM users WHERE company_id = $1::uuid)' : 'company_id = $1::uuid';
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE ${col}`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('records depot and customer visits from GPS and arrives at stops', async () => {
    const tel = app.get(TelematicsService);
    const t0 = Date.now() - 2 * 3_600_000;
    const at = (min: number) => new Date(t0 + min * 60_000);
    const G = `${run}-G`;
    const fix = (min: number, lat: number, lng: number, speed: number) => ({ deviceId: G, recordedAt: at(min), latitude: lat, longitude: lng, speedKmh: speed, ignition: true });
    await tel.ingest([
      fix(0, 16.81, 96.1, 30), // outside the depot (first fix: no ENTER flood)
      fix(2, 16.8, 96.1, 5), // into the depot
      fix(27, 16.8, 96.1, 0),
      fix(32, 16.81, 96.1, 40), // left the depot after 30 min
      fix(40, 16.8201, 96.12, 3), // stopped at Shop One (11 m away)
      fix(55, 16.8202, 96.1201, 0),
      fix(62, 16.83, 96.12, 35), // left Shop One (~1.1 km)
      fix(70, 16.8401, 96.12, 2), // at Shop Two, already arrived manually
      fix(80, 16.86, 96.12, 40),
    ]);
    const s1 = await admin.tripStop.findUniqueOrThrow({ where: { id: id.s1 } });
    expect(s1).toMatchObject({ status: 'ARRIVED', arrivalSource: 'gps' });
    expect(s1.arrivedAt!.getTime()).toBe(at(40).getTime());
    const s2 = await admin.tripStop.findUniqueOrThrow({ where: { id: id.s2 } });
    expect(s2.arrivalSource).toBeNull(); // manual arrival is kept
    const visits = await admin.siteVisit.findMany({ where: { vehicleId: id.v }, orderBy: { enteredAt: 'asc' } });
    expect(visits.map((v) => [v.kind, v.siteName, v.durationMin])).toEqual([
      ['GEOFENCE', 'Main depot', 30],
      ['STOP', 'Shop One', 22],
      ['STOP', 'Shop Two', 10],
    ]);
    expect(visits[1]).toMatchObject({ tripId: id.trip, driverId: id.driver, category: 'CUSTOMER' });

    const day = localDate(new Date(), 'Asia/Yangon');
    const r = (await http().get('/api/analytics/site-visits').query({ from: localDate(at(0), 'Asia/Yangon'), to: day }).set(auth('m')).expect(200)).body;
    expect(r.totals.loading).toMatchObject({ visits: 1, avgMin: 30 });
    expect(r.totals.unloading).toMatchObject({ visits: 2, avgMin: 16, p90Min: 22 });
    expect(r.vehicles[0]).toMatchObject({ name: `${run}-V`, unloading: { visits: 2 } });
    expect(r.sites.map((s: { name: string }) => s.name).sort()).toEqual(['Main depot', 'Shop One', 'Shop Two']);
    expect((await http().get('/api/analytics/site-visits').query({ from: day, to: day }).set(auth('b')).expect(200)).body.totals.all.visits).toBe(0);
    await http().get('/api/analytics/site-visits').query({ from: day, to: day }).set(auth('d')).expect(403);
    // Turning auto-arrive off is a setting
    const st = (await http().patch('/api/company/settings').set(auth('a')).send({ logistics: { arrivalRadiusM: null } }).expect(200)).body;
    expect(st.logistics.arrivalRadiusM).toBeNull();
  });

  it('invites a user who sets a password from the e-mail link', async () => {
    const email = `new-${run}@e2e.local`;
    const u = (await http().post('/api/users/invite').set(auth('a')).send({ email, fullName: 'New Dispatcher', roles: ['DISPATCHER'] }).expect(201)).body;
    expect(u).toMatchObject({ email, invitedAt: expect.any(String), passwordSetAt: null });
    await http().post('/api/users/invite').set(auth('a')).send({ email, fullName: 'Again', roles: ['DISPATCHER'] }).expect(400);
    await http().post('/api/users/invite').set(auth('a')).send({ email: `x-${run}@e2e.local`, fullName: 'X', roles: ['SUPER_ADMIN'] }).expect(403);
    await http().post('/api/users/invite').set(auth('m')).send({ email: `y-${run}@e2e.local`, fullName: 'Y', roles: ['VIEWER'] }).expect(403);
    const token = lastLink(email)!;
    expect(token).toBeTruthy();
    await login(email, 'whatever123').expect(401);
    expect((await http().get('/api/auth/token-info').query({ token }).expect(200)).body).toEqual({ kind: 'INVITE', email, fullName: 'New Dispatcher' });
    await http().post('/api/auth/set-password').send({ token, password: 'short1' }).expect(400);
    await http().post('/api/auth/set-password').send({ token, password: 'onlyletterslong' }).expect(400);
    await http().post('/api/auth/set-password').send({ token, password: 'NewPassword123' }).expect(204);
    await http().post('/api/auth/set-password').send({ token, password: 'NewPassword456' }).expect(400); // single use
    await http().get('/api/auth/token-info').query({ token }).expect(400);
    const s = (await login(email, 'NewPassword123').expect(200)).body;
    expect(s.user.roles).toEqual(['DISPATCHER']);
    // Resending an invite once the password is set is refused
    await http().post(`/api/users/${u.id}/resend-invite`).set(auth('a')).expect(400);
    id.newUser = u.id;
    id.newRefresh = s.refreshToken;
  });

  it('resets a forgotten password without revealing which e-mails exist', async () => {
    const email = `new-${run}@e2e.local`;
    const known = await http().post('/api/auth/forgot-password').send({ email }).expect(202);
    const unknown = await http().post('/api/auth/forgot-password').send({ email: `nobody-${run}@e2e.local` }).expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(lastLink(`nobody-${run}@e2e.local`)).toBeNull();
    const token = lastLink(email)!;
    expect((await http().get('/api/auth/token-info').query({ token }).expect(200)).body.kind).toBe('RESET');
    // An expired link is refused
    await admin.authToken.updateMany({ where: { userId: id.newUser, kind: 'RESET', usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/api/auth/set-password').send({ token, password: 'Another123456' }).expect(400);
    // An admin sends a fresh one
    await http().post(`/api/users/${id.newUser}/reset-password`).set(auth('a')).expect(201);
    const t2 = lastLink(email)!;
    expect(t2).not.toBe(token);
    await http().post('/api/auth/set-password').send({ token: t2, password: 'Another123456' }).expect(204);
    // Setting a password signs out existing sessions
    await http().post('/api/auth/refresh').send({ refreshToken: id.newRefresh }).expect(401);
    await login(email, 'NewPassword123').expect(401);
    await login(email, 'Another123456').expect(200);
  });

  it('edits and deactivates users', async () => {
    const email = `new-${run}@e2e.local`;
    const s = (await login(email, 'Another123456').expect(200)).body;
    const upd = (await http().patch(`/api/users/${id.newUser}`).set(auth('a')).send({ roles: ['DISPATCHER', 'VIEWER'], branchId: id.depot }).expect(200)).body;
    expect(upd).toMatchObject({ roles: ['DISPATCHER', 'VIEWER'], branchId: id.depot });
    await http().patch(`/api/users/${id.newUser}`).set(auth('a')).send({ active: false }).expect(200);
    await login(email, 'Another123456').expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    await http().post('/api/auth/forgot-password').send({ email }).expect(202);
    // Guard rails
    const me = (await http().get('/api/users').set(auth('a')).expect(200)).body.find((u: { email: string }) => u.email === `a-${run}@e2e.local`);
    await http().patch(`/api/users/${me.id}`).set(auth('a')).send({ active: false }).expect(403);
    const sup = (await http().get('/api/users').set(auth('a')).expect(200)).body.find((u: { email: string }) => u.email === `s-${run}@e2e.local`);
    await http().patch(`/api/users/${sup.id}`).set(auth('a')).send({ active: false }).expect(403);
    // Other company's users are invisible
    await http().patch(`/api/users/${id.newUser}`).set(auth('b')).send({ active: true }).expect(404);
  });

  it('lets super admins create and deactivate group companies', async () => {
    await http().get('/api/admin/companies').set(auth('a')).expect(403);
    const code = `G${run}`.toUpperCase();
    const c = (await http().post('/api/admin/companies').set(auth('s')).send({ code, name: 'Group Co', timezone: 'Asia/Yangon', currency: 'mmk', admin: { email: `g-${run}@e2e.local`, fullName: 'Group Admin' } }).expect(201)).body;
    expect(c).toMatchObject({ code, currency: 'MMK', admin: { roles: ['COMPANY_ADMIN'] } });
    await http().post('/api/admin/companies').set(auth('s')).send({ code, name: 'Dup', admin: { email: `g2-${run}@e2e.local`, fullName: 'X' } }).expect(400);
    await http().post('/api/admin/companies').set(auth('s')).send({ code: `${code}X`, name: 'Bad tz', timezone: 'Mars/Base', admin: { email: `g3-${run}@e2e.local`, fullName: 'X' } }).expect(400);
    const token = lastLink(`g-${run}@e2e.local`)!;
    await http().post('/api/auth/set-password').send({ token, password: 'GroupAdmin123' }).expect(204);
    const g = (await login(`g-${run}@e2e.local`, 'GroupAdmin123').expect(200)).body;
    const list = (await http().get('/api/admin/companies').set(auth('s')).expect(200)).body;
    expect(list.find((x: { code: string }) => x.code === code)).toMatchObject({ users: 1, vehicles: 0, active: true });
    // The new admin sees only their company
    expect((await http().get('/api/users').set({ Authorization: `Bearer ${g.accessToken}` }).expect(200)).body).toHaveLength(1);
    await http().patch(`/api/admin/companies/${companyIds[0]}`).set(auth('s')).send({ active: false }).expect(403); // own company
    await http().patch(`/api/admin/companies/${c.id}`).set(auth('s')).send({ active: false }).expect(200);
    await login(`g-${run}@e2e.local`, 'GroupAdmin123').expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: g.refreshToken }).expect(401);
  });
});
