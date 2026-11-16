/**
 * Sprint 13: fuel GPS checks and variance, fuel cards (statement import, API sync, reconciliation, review),
 * fuel level sensor and engine diagnostics from device data, extended vehicle history.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { resetEnvCache } from '../src/common/config/env';
import { TelematicsService } from '../src/modules/telematics/telematics.service';

const PASSWORD = 'E2ePassword123!';
const run = `s13${Date.now().toString(36)}`;
const H = 3_600_000;
// Fills happen over the last days (rounded to a minute), all in the past.
const base = Math.floor((Date.now() - 5 * 24 * H) / 60_000) * 60_000;
const at = (h: number) => new Date(base + h * H);
// Yangon local "dd/mm/yyyy HH:MM" for a UTC instant (UTC+6:30)
const local = (d: Date) => {
  const l = new Date(d.getTime() + 390 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`;
};

describe('Sprint 13 fuel control, cards, sensors, diagnostics (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const sys = <T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
    admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    process.env.FUEL_CARD_API = 'mock';
    resetEnvCache();
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await sys(async (tx) => {
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`, name: `S13 ${tag}`, settings: { diagnostics: { autoRepairCodes: ['P03'] } } } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `x-${run}@e2e.local`, fullName: 'Executive', passwordHash, roles: ['EXECUTIVE'] } });
      const u = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      id.driver = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver', userId: u.id } })).id;
      const veh = (p: string, extra: Record<string, unknown> = {}) => tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-${p}`, make: 'Isuzu', model: 'Elf', vehicleClass: 'TRUCK', tankCapacityL: 120, ...extra } }).then((v) => v.id);
      id.v1 = await veh('V1', { gpsDeviceId: `${run}-G1` });
      id.v2 = await veh('V2', { gpsDeviceId: `${run}-G2` });
      await tx.vehicleAssignment.create({ data: { companyId: a, vehicleId: id.v1, driverId: id.driver, startAt: at(-200) } });
      // v1 GPS: parked at 16.80,96.10 around the first fill; then ~100 km of driving east-west; parked again.
      const pos: { vehicle_id: string; recorded_at: Date; latitude: number; longitude: number; speed_kmh: number }[] = [];
      for (let m = -10; m <= 10; m += 5) pos.push({ vehicle_id: id.v1, recorded_at: new Date(at(0).getTime() + m * 60_000), latitude: 16.8, longitude: 96.1, speed_kmh: 0 });
      for (let k = 1; k <= 20; k++) pos.push({ vehicle_id: id.v1, recorded_at: new Date(at(1).getTime() + k * 6 * 60_000), latitude: 16.8, longitude: 96.1 + (k % 2 ? 0.08 : 0), speed_kmh: 85 });
      for (let m = -10; m <= 10; m += 5) pos.push({ vehicle_id: id.v1, recorded_at: new Date(at(24).getTime() + m * 60_000), latitude: 16.8, longitude: 96.1, speed_kmh: 0 });
      for (const p of pos)
        await tx.$executeRaw`INSERT INTO vehicle_positions (company_id, vehicle_id, recorded_at, latitude, longitude, speed_kmh) VALUES (${a}::uuid, ${p.vehicle_id}::uuid, ${p.recorded_at}, ${p.latitude}, ${p.longitude}, ${p.speed_kmh})`;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'x', 'd']) t[k] = (await http().post('/api/auth/login').send({ email: `${k}-${run}@e2e.local`, password: PASSWORD }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await sys(async (tx) => {
      for (const companyId of companyIds) {
        for (const tbl of ['fuel_card_transactions', 'fuel_card_imports', 'fuel_cards', 'vehicle_diagnostics', 'telemetry_events', 'vehicle_telemetry_state', 'vehicle_last_positions', 'vehicle_positions', 'repair_requests', 'approval_requests',
          'fuel_records', 'notifications', 'vehicle_assignments', 'vehicle_status_events', 'vehicles', 'drivers', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    delete process.env.FUEL_CARD_API;
    resetEnvCache();
  });

  const fill = (k: string, body: Record<string, unknown>) => http().post(k === 'd' ? '/api/me/fuel' : '/api/fuel/records').set(auth(k)).send({ vehicleId: id.v1, fullTank: true, ...body }).expect(201);

  it('checks where a fill happened and the km since the previous one', async () => {
    // Phone next to the truck: no location flag
    const f1 = (await fill('d', { filledAt: at(0).toISOString(), odometerKm: 10_000, litres: 40, totalCost: 120_000, latitude: 16.8001, longitude: 96.1001 })).body;
    expect(f1).toMatchObject({ locationSource: 'phone', flags: [] });
    expect(f1.vehicleDistanceM).toBeLessThan(50);
    // Phone 5 km from the truck; odometer says 400 km but GPS ~100 km
    const f2 = (await fill('d', { filledAt: at(24).toISOString(), odometerKm: 10_400, litres: 50, totalCost: 150_000, latitude: 16.8, longitude: 96.147 })).body;
    const rec = await admin.fuelRecord.findUniqueOrThrow({ where: { id: f2.id } });
    expect(rec.flags).toEqual(expect.arrayContaining(['VEHICLE_ELSEWHERE', 'KM_MISMATCH']));
    expect(Number(rec.gpsKm)).toBeGreaterThan(150); // ~20 × 8.5 km
    expect(rec.vehicleDistanceM).toBeGreaterThan(4500);
    // Web entry without location: the vehicle's GPS position is used
    const f3 = (await fill('a', { filledAt: at(24.05).toISOString(), odometerKm: 10_401, litres: 2, totalCost: 6_000, fullTank: false })).body;
    expect(f3).toMatchObject({ locationSource: 'gps', latitude: 16.8 });
  });

  it('reports consumption variance', async () => {
    for (const [h, odo, l] of [[-144, 8_680, 40], [-120, 9_000, 40], [-96, 9_320, 40], [-72, 9_640, 40]] as const)
      await fill('a', { filledAt: at(h).toISOString(), odometerKm: odo, litres: l, totalCost: l * 3000 });
    const r = (await http().get('/api/fuel/variance').query({ from: at(-1).toISOString(), to: at(30).toISOString() }).set(auth('x')).expect(200)).body;
    const v = r.vehicles.find((x: { id: string }) => x.id === id.v1);
    // three earlier segments of 320 km / 40 L → expected 8 km/L
    expect(v).toMatchObject({ basis: 'vehicle', expectedKmPerL: 8 });
    expect(v.actualKmPerL).toBeGreaterThan(0);
    expect(r.method).toContain('Expected');
  });

  it('imports a card statement with a mapping and reconciles it', async () => {
    await http().post('/api/fuel/cards').set(auth('a')).send({ provider: 'mpt', number: '7083 0000 0000 1234', vehicleId: id.v1, label: 'Truck 1' }).expect(201);
    await http().post('/api/fuel/cards').set(auth('a')).send({ provider: 'mpt', number: '1234' }).expect(409);
    await http().post('/api/fuel/cards').set(auth('x')).send({ provider: 'mpt', number: '9999' }).expect(403);
    const csv = [
      'Txn ID;Date;Card;Product;Litres;Amount (MMK);Station',
      `T1;${local(at(0.1))};****1234;Diesel;40;120,000;Shwe Pyi`, // matches f1
      `T2;${local(at(24.1))};****1234;Diesel;50;165,000;Shwe Pyi`, // f2 but 10 % more expensive
      `T3;${local(at(60))};****1234;Diesel;30;90,000;Unknown`, // not recorded in FMS
      `T4;${local(at(60))};****1234;Car wash;;5,000;Shwe Pyi`, // not fuel
      `T5;bad date;****1234;Diesel;10;30,000;X`,
      `T6;${local(at(61))};****5678;Diesel;10;30,000;X`, // unknown card
    ].join('\n');
    const file = Buffer.from(csv);
    const mapping = { provider: 'MPT', columns: { externalId: 'Txn ID', occurredAt: 'Date', card: 'Card', product: 'Product', litres: 'Litres', amount: 'Amount (MMK)', station: 'Station' }, dateFormat: 'DMY' };
    const look = (await http().post('/api/fuel/card-statements').set(auth('a')).attach('file', file, 'statement.csv').expect(201)).body;
    expect(look.headers).toEqual(['Txn ID', 'Date', 'Card', 'Product', 'Litres', 'Amount (MMK)', 'Station']);
    const prev = (await http().post('/api/fuel/card-statements').set(auth('a')).field('mapping', JSON.stringify(mapping)).attach('file', file, 'statement.csv').expect(201)).body;
    expect(prev).toMatchObject({ total: 6, valid: 5, errors: [{ row: 6, message: expect.stringContaining('Unreadable date') }] });
    expect(prev.preview[0]).toMatchObject({ externalId: 'T1', card: '1234', amount: 120_000, litres: 40 });
    const done = (await http().post('/api/fuel/card-statements').set(auth('a')).field('mapping', JSON.stringify(mapping)).field('commit', 'true').attach('file', file, 'statement.csv').expect(201)).body;
    expect(done).toMatchObject({ imported: 5, duplicates: 0, status: { matched: 1, mismatched: 1, cardOnly: 2 } });
    // Same file again: nothing new
    expect((await http().post('/api/fuel/card-statements').set(auth('a')).field('mapping', JSON.stringify(mapping)).field('commit', 'true').attach('file', file, 'statement.csv').expect(201)).body).toMatchObject({ imported: 0, duplicates: 5 });
    const list = (await http().get('/api/fuel/card-transactions').set(auth('x')).expect(200)).body;
    const by = (ext: string) => list.items.find((i: { externalId: string }) => i.externalId === ext);
    expect(by('T1')).toMatchObject({ status: 'MATCHED', plateNumber: `${run}-V1` });
    expect(by('T2')).toMatchObject({ status: 'MISMATCH', differences: { amount: -15_000 } });
    expect(by('T3').status).toBe('CARD_ONLY');
    expect(by('T4').status).toBe('NON_FUEL');
    expect(by('T6')).toMatchObject({ status: 'CARD_ONLY', vehicleId: null });
    expect(list.summary.MISMATCH.count).toBe(1);
    const f2 = await admin.fuelRecord.findFirstOrThrow({ where: { vehicleId: id.v1, odometerKm: 10_400 } });
    expect(f2.flags).toContain('CARD_MISMATCH');
    expect(f2.paymentMethod).toBe('FUEL_CARD');
    // Mapping remembered
    const settings = (await http().get('/api/company/settings').set(auth('a')).expect(200)).body;
    expect(settings.fuelControl.cardMappings.MPT.columns.amount).toBe('Amount (MMK)');
    expect(await admin.notification.count({ where: { companyId: companyIds[0], topic: 'fuel.card_mismatch' } })).toBeGreaterThan(0);

    // Review: accept the mismatch, create a record from the unrecorded one, assign the unknown card
    await http().post(`/api/fuel/card-transactions/${by('T2').id}/review`).set(auth('a')).send({ action: 'accept', note: 'Price changed at the pump' }).expect(201);
    await http().post(`/api/fuel/card-transactions/${by('T1').id}/review`).set(auth('a')).send({ action: 'create_record', odometerKm: 1 }).expect(400);
    const cr = (await http().post(`/api/fuel/card-transactions/${by('T3').id}/review`).set(auth('a')).send({ action: 'create_record', odometerKm: 11_000 }).expect(201)).body;
    expect(cr).toMatchObject({ status: 'MATCHED', fuelRecordId: expect.any(String) });
    expect(await admin.fuelRecord.findUniqueOrThrow({ where: { id: cr.fuelRecordId } })).toMatchObject({ source: 'card', paymentMethod: 'FUEL_CARD', cardTxnId: by('T3').id });
    const c2 = (await http().post('/api/fuel/cards').set(auth('a')).send({ provider: 'MPT', number: '5678', vehicleId: id.v2 }).expect(201)).body;
    expect(c2.last4).toBe('5678');
    expect((await admin.fuelCardTransaction.findFirstOrThrow({ where: { externalId: 'T6', companyId: companyIds[0] } })).vehicleId).toBe(id.v2);
    // Tenant B sees nothing
    expect((await http().get('/api/fuel/card-transactions').set(auth('b')).expect(200)).body.total).toBe(0);
    expect((await http().get('/api/fuel/cards').set(auth('b')).expect(200)).body).toEqual([]);
  });

  it('imports an Excel statement', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transactions');
    ws.addRow(['Date', 'Card number', 'Amount', 'Litres']);
    ws.addRow([`${local(at(70))}`, '7083-xxxx-xxxx-1234', 60000, 20]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const mapping = { provider: 'MPT', columns: { occurredAt: 'Date', card: 'Card number', amount: 'Amount', litres: 'Litres' } };
    const r = (await http().post('/api/fuel/card-statements').set(auth('a')).field('mapping', JSON.stringify(mapping)).field('commit', 'true').attach('file', buf, 'march.xlsx').expect(201)).body;
    expect(r).toMatchObject({ total: 1, imported: 1 });
    await http().post('/api/fuel/card-statements').set(auth('a')).attach('file', Buffer.from('x'), 'notes.txt').expect(400);
  });

  it('syncs from the card provider API', async () => {
    await http().patch('/api/company/settings').set(auth('a')).send({ fuelControl: { cardSyncEnabled: true, cardSyncProvider: 'MPT' } }).expect(200);
    const r = (await http().post('/api/fuel/card-sync').set(auth('a')).expect(201)).body;
    // Mock: one transaction per recorded fill of v1 (already matched ones stay CARD_ONLY) + one unknown
    expect(r.imported).toBeGreaterThan(1);
    expect((await http().get('/api/fuel/card-imports').set(auth('a')).expect(200)).body[0]).toMatchObject({ source: 'api', provider: 'MPT' });
  });

  it('detects fuel drops, refills and engine faults from device data', async () => {
    const tel = app.get(TelematicsService);
    const G = `${run}-G2`;
    const t0 = Date.now() - 2 * H;
    const fix = (min: number, attrs: Record<string, unknown>, speed = 0, ign = false) => ({ deviceId: G, recordedAt: new Date(t0 + min * 60_000), latitude: 16.85, longitude: 96.12, speedKmh: speed, ignition: ign, attributes: attrs });
    const levels = [80, 80, 80, 80, 74, 66, 60, 60, 60, 60, 60, 75, 95, 110, 110, 110, 110];
    await tel.ingest(levels.map((l, i) => fix(i * 2, { fuelLevelL: l, batteryV: 12.5, coolantTempC: 85 })));
    await tel.ingest([fix(40, { fuelLevelL: 110, dtc: ['P0301'], mil: true }, 30, true), fix(42, { fuelLevelL: 110, dtc: ['P0301'], mil: true }, 30, true)]);
    const ev = (await http().get('/api/tracking/events').query({ vehicleId: id.v2, pageSize: 50 }).set(auth('a')).expect(200)).body.items as { type: string; data: Record<string, unknown> }[];
    const drop = ev.find((e) => e.type === 'FUEL_DROP')!;
    expect(drop.data).toMatchObject({ litres: 20 });
    const refill = ev.find((e) => e.type === 'FUEL_REFILL')!;
    expect(refill.data).toMatchObject({ litres: 50, verdict: 'NOT_RECORDED', recordedLitres: 0 });
    const faults = ev.filter((e) => e.type === 'ENGINE_FAULT');
    expect(faults).toHaveLength(1);
    expect(faults[0].data).toMatchObject({ kind: 'DTC', code: 'P0301', autoRepair: true });
    expect(await admin.repairRequest.count({ where: { vehicleId: id.v2, description: { contains: 'P0301' } } })).toBe(1);
    const diag = (await http().get(`/api/vehicles/${id.v2}/diagnostics`).set(auth('x')).expect(200)).body;
    expect(diag.latest).toMatchObject({ dtcCodes: ['P0301'], checkEngine: true, fuelLevelL: 110 });
    const topics = (await admin.notification.findMany({ where: { companyId: companyIds[0], topic: { in: ['telematics.fuel_drop', 'telematics.fuel_refill', 'telematics.engine_fault'] } }, select: { topic: true } })).map((n) => n.topic);
    expect(new Set(topics)).toEqual(new Set(['telematics.fuel_drop', 'telematics.fuel_refill', 'telematics.engine_fault']));
    await http().get(`/api/vehicles/${id.v2}/diagnostics`).set(auth('b')).expect(404);
  });

  it('shows the full vehicle history with filters', async () => {
    const all = (await http().get(`/api/vehicles/${id.v2}/history`).set(auth('x')).expect(200)).body as { kind: string; at: string }[];
    expect(new Set(all.map((e) => e.kind))).toEqual(new Set(['alert', 'repair']));
    const v1 = (await http().get(`/api/vehicles/${id.v1}/history`).query({ kinds: 'fuel,assignment' }).set(auth('x')).expect(200)).body as { kind: string; at: string }[];
    expect(new Set(v1.map((e) => e.kind))).toEqual(new Set(['fuel', 'assignment']));
    const page = (await http().get(`/api/vehicles/${id.v1}/history`).query({ kinds: 'fuel', limit: 2 }).set(auth('x')).expect(200)).body as { at: string }[];
    expect(page).toHaveLength(2);
    const next = (await http().get(`/api/vehicles/${id.v1}/history`).query({ kinds: 'fuel', limit: 2, before: page[1].at }).set(auth('x')).expect(200)).body as { at: string }[];
    expect(new Date(next[0].at).getTime()).toBeLessThan(new Date(page[1].at).getTime());
  });
});
