/**
 * Sprint 16: suppliers and outside garages, spare parts stock per branch store (moving average),
 * tires per vehicle position (changes, rotation, checks, inspections), warranty coverage and claims,
 * cost ledger (TIRES, warranty credit), storekeeper role, tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { TiresService } from '../src/modules/tires/tires.service';

const PASSWORD = 'E2ePassword123!';
const run = `s16${Date.now().toString(36)}`;

describe('Sprint 16 workshop: garages, parts, tires, warranty (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const stockOf = async (branchId: string) => {
    const r = await http().get(`/api/inventory/stock?branchId=${branchId}`).set(auth('a')).expect(200);
    return r.body.items.find((x: { part: { id: string } }) => x.part.id === id.part);
  };
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S16 ${tag}`, timezone: 'Asia/Yangon' } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a, b] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `k-${run}@e2e.local`, fullName: 'Store keeper', passwordHash, roles: ['STOREKEEPER'] } });
      id.d1 = (await tx.branch.create({ data: { companyId: a, code: `D1${run}`, name: 'Depot 1' } })).id;
      id.d2 = (await tx.branch.create({ data: { companyId: a, code: `D2${run}`, name: 'Depot 2' } })).id;
      id.v = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-V1`, make: 'Isuzu', model: 'FVR', vehicleClass: 'TRUCK', odometerKm: 50_000, branchId: id.d1 } })).id;
      id.vb = (await tx.vehicle.create({ data: { companyId: b, plateNumber: `${run}-VB`, make: 'Isuzu', model: 'FVR', vehicleClass: 'TRUCK' } })).id;
      id.bBranch = (await tx.branch.create({ data: { companyId: b, code: `DB${run}`, name: 'B depot' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 'k']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
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
        for (const tbl of ['tire_checks', 'tire_changes', 'warranty_claims', 'vehicle_warranties', 'stock_movements', 'part_stocks', 'approval_decisions', 'approval_requests', 'repair_requests', 'work_order_lines', 'work_orders', 'parts', 'suppliers', 'inspections', 'inspection_templates', 'notifications', 'vehicle_status_events', 'vehicles', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
  });

  it('suppliers and parts catalogue; storekeeper permissions', async () => {
    const g = await http().post('/api/suppliers').set(auth('k')).send({ name: 'Golden Garage', kinds: ['GARAGE', 'PARTS'], externalRef: 'V1000' }).expect(201);
    id.garage = g.body.id;
    const p = await http().post('/api/inventory/parts').set(auth('k')).send({ partNo: `ALT-${run}`, name: 'Alternator 24V', unit: 'pcs', supplierId: id.garage, minQty: 5, reorderQty: 10, warrantyMonths: 12, warrantyKm: 30_000 }).expect(201);
    id.part = p.body.id;
    await http().post('/api/inventory/parts').set(auth('k')).send({ partNo: `ALT-${run}`, name: 'dup' }).expect(409);
    const imp = await http().post('/api/inventory/parts/import').set(auth('a')).send({ parts: [{ partNo: `ALT-${run}`, name: 'Alternator 24V (Denso)', minQty: 5, reorderQty: 10, warrantyMonths: 12, warrantyKm: 30_000 }, { partNo: `OF-${run}`, name: 'Oil filter' }] }).expect(201);
    expect(imp.body).toEqual({ created: 1, updated: 1 });
    // Storekeepers do not manage work orders; other companies see nothing.
    await http().post('/api/maintenance/work-orders').set(auth('k')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'x' }).expect(403);
    expect((await http().get('/api/suppliers').set(auth('b')).expect(200)).body).toEqual([]);
    expect((await http().get('/api/inventory/parts').set(auth('b')).expect(200)).body).toEqual([]);
  });

  it('receive at moving average, transfer, count; CSV export', async () => {
    await http().post('/api/inventory/receipts').set(auth('k')).send({ branchId: id.d1, supplierId: id.garage, reference: 'INV-1', lines: [{ partId: id.part, qty: 10, unitCost: 100 }] }).expect(201);
    await http().post('/api/inventory/receipts').set(auth('k')).send({ branchId: id.d1, reference: 'INV-2', lines: [{ partId: id.part, qty: 10, unitCost: 130 }] }).expect(201);
    expect(await stockOf(id.d1)).toMatchObject({ qtyOnHand: 20, avgCost: 115, value: 2300 });
    await http().post('/api/inventory/transfers').set(auth('k')).send({ fromBranchId: id.d1, toBranchId: id.d2, lines: [{ partId: id.part, qty: 5 }] }).expect(201);
    await http().post('/api/inventory/transfers').set(auth('k')).send({ fromBranchId: id.d1, toBranchId: id.d2, lines: [{ partId: id.part, qty: 500 }] }).expect(409);
    expect(await stockOf(id.d2)).toMatchObject({ qtyOnHand: 5, avgCost: 115 });
    const c = await http().post('/api/inventory/counts').set(auth('k')).send({ branchId: id.d1, reason: 'Monthly count', lines: [{ partId: id.part, countedQty: 13 }] }).expect(201);
    expect(c.body).toEqual({ changed: 1, value: -230 });
    expect(await stockOf(id.d1)).toMatchObject({ qtyOnHand: 13 });
    const csv = await http().get('/api/inventory/movements.csv').set(auth('a')).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n').filter((l) => l.includes(`ALT-${run}`)).length).toBe(5); // 2 receipts, transfer out/in, adjust
    // Another company cannot move this stock.
    await http().post('/api/inventory/receipts').set(auth('b')).send({ branchId: id.bBranch, lines: [{ partId: id.part, qty: 1, unitCost: 1 }] }).expect(400);
  });

  it('issue parts to a work order at average cost; no overdraw; removing the line returns stock', async () => {
    const wo = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'Alternator not charging', offRoad: false }).expect(201);
    id.wo1 = wo.body.id;
    const r = await http().post(`/api/maintenance/work-orders/${id.wo1}/parts`).set(auth('k')).send({ partId: id.part, branchId: id.d1, qty: 3 }).expect(201);
    const line = r.body.lines.find((l: { kind: string }) => l.kind === 'PART');
    expect(line).toMatchObject({ unitCost: '115', total: '345', partId: id.part, branchId: id.d1 });
    expect(line.warrantyUntil).toBeTruthy();
    expect(Number(line.warrantyKmUntil)).toBe(80_000);
    expect(Number(r.body.totalCost)).toBe(345);
    expect(await stockOf(id.d1)).toMatchObject({ qtyOnHand: 10 });
    await http().post(`/api/maintenance/work-orders/${id.wo1}/parts`).set(auth('k')).send({ partId: id.part, branchId: id.d1, qty: 50 }).expect(409);
    // Two issues at once cannot take more than is on hand.
    const both = await Promise.all([6, 6].map((qty) => http().post(`/api/maintenance/work-orders/${id.wo1}/parts`).set(auth('k')).send({ partId: id.part, branchId: id.d1, qty })));
    expect(both.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await stockOf(id.d1)).toMatchObject({ qtyOnHand: 4 });
    const lines = (await http().get(`/api/maintenance/work-orders/${id.wo1}`).set(auth('a')).expect(200)).body.lines;
    const six = lines.find((l: { quantity: string }) => Number(l.quantity) === 6);
    await http().delete(`/api/maintenance/work-orders/${id.wo1}/lines/${six.id}`).set(auth('a')).expect(200);
    expect(await stockOf(id.d1)).toMatchObject({ qtyOnHand: 10, avgCost: 115 });
    await http().post(`/api/maintenance/work-orders/${id.wo1}/complete`).set(auth('a')).send({ resolution: 'Alternator replaced' }).expect(200);
    // Another company's work order cannot take this part.
    const wob = await http().post('/api/maintenance/work-orders').set(auth('b')).send({ vehicleId: id.vb, type: 'CORRECTIVE', title: 'x', offRoad: false }).expect(201);
    await http().post(`/api/maintenance/work-orders/${wob.body.id}/parts`).set(auth('b')).send({ partId: id.part, branchId: id.bBranch, qty: 1 }).expect(400);
  });

  it('outside garage: quote above the limit needs approval; the invoice closes the job', async () => {
    await http().patch('/api/company/settings').set(auth('a')).send({ approvals: { workOrderAbove: 100_000 } }).expect(200);
    const big = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'Gearbox overhaul', supplierId: id.garage, quoteAmount: 900_000, offRoad: false }).expect(201);
    expect(big.body.status).toBe('AWAITING_APPROVAL');
    expect(Number(big.body.estimatedCost)).toBe(900_000);
    const small = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'Brake pads', supplierId: id.garage, quoteAmount: 80_000, offRoad: false }).expect(201);
    id.wo2 = small.body.id;
    expect(small.body.status).toBe('OPEN');
    await http().post(`/api/maintenance/work-orders/${id.wo2}/complete`).set(auth('a')).send({ resolution: 'Done' }).expect(400);
    const done = await http().post(`/api/maintenance/work-orders/${id.wo2}/complete`).set(auth('a')).send({ resolution: 'Pads replaced', invoiceNo: 'GG-77', invoiceAmount: 88_000 }).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(Number(done.body.totalCost)).toBe(88_000);
    expect(done.body.invoiceNo).toBe('GG-77');
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const perf = await http().get(`/api/maintenance/garages?from=${from}&to=${to}`).set(auth('a')).expect(200);
    expect(perf.body.find((g: { supplierId: string }) => g.supplierId === id.garage)).toMatchObject({ name: 'Golden Garage', jobs: 1, cost: 88_000, invoiceVsQuotePct: 10 });
  });

  it('tires: fit, rotate, checks, inspection readings, status and alerts', async () => {
    const sheet0 = await http().get(`/api/vehicles/${id.v}/tires`).set(auth('a')).expect(200);
    expect(sheet0.body.layout).toBe('4x2-6');
    expect(sheet0.body.positions).toHaveLength(7);
    await http().post(`/api/vehicles/${id.v}/tires/changes`).set(auth('a')).send({ position: '9X', reason: 'NEW_FIT' }).expect(400);
    await http().post(`/api/vehicles/${id.v}/tires/changes`).set(auth('a')).send({ position: '1L', reason: 'NEW_FIT', brand: 'Bridgestone', size: '8.25R16', cost: 400_000, odometerKm: 40_000, changedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), warrantyMonths: 12 }).expect(201);
    await http().post(`/api/vehicles/${id.v}/tires/changes`).set(auth('a')).send({ position: '1R', reason: 'NEW_FIT', brand: 'Maxxis', size: '8.25R16', cost: 300_000, odometerKm: 40_000, changedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }).expect(201);
    await http().post(`/api/vehicles/${id.v}/tires/rotate`).set(auth('a')).send({ a: '1L', b: '1R' }).expect(201);
    // A tire fitted inside a work order becomes a TIRE line of it.
    const wo = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'Puncture 2LO', offRoad: false }).expect(201);
    await http().post(`/api/vehicles/${id.v}/tires/changes`).set(auth('a')).send({ position: '2LO', reason: 'PUNCTURE', condition: 'RETREAD', cost: 90_000, workOrderId: wo.body.id }).expect(201);
    const woAfter = await http().get(`/api/maintenance/work-orders/${wo.body.id}`).set(auth('a')).expect(200);
    expect(woAfter.body.lines).toEqual([expect.objectContaining({ kind: 'TIRE', total: '90000' })]);
    await http().post(`/api/maintenance/work-orders/${wo.body.id}/complete`).set(auth('a')).send({ resolution: 'Fixed' }).expect(200);
    await http().patch('/api/company/settings').set(auth('a')).send({ tires: { pressureTargets: { TRUCK: 100 } } }).expect(200);
    await http().post(`/api/vehicles/${id.v}/tires/checks`).set(auth('a')).send({ readings: [{ position: '1R', treadMm: 2, pressure: 98 }, { position: '1L', treadMm: 9, pressure: 80 }] }).expect(201);
    const sheet = await http().get(`/api/vehicles/${id.v}/tires`).set(auth('a')).expect(200);
    const pos = (p: string) => sheet.body.positions.find((x: { position: string }) => x.position === p);
    expect(pos('1R')).toMatchObject({ treadStatus: 'REPLACE', pressureStatus: 'OK', level: 'critical', tire: expect.objectContaining({ brand: 'Bridgestone' }), warrantyActive: true });
    expect(pos('1L')).toMatchObject({ treadStatus: 'OK', pressureStatus: 'LOW', tire: expect.objectContaining({ brand: 'Maxxis' }) });
    expect(pos('2LO').tire).toMatchObject({ condition: 'RETREAD' });

    // Inspection checklist with tire readings feeds tire checks; out-of-limit tread fails it.
    const tpl = await http().post('/api/inspection-templates/tires').set(auth('a')).send({ layout: '4x2-6', vehicleClasses: ['TRUCK'] }).expect(201);
    expect(tpl.body.items).toHaveLength(14);
    const answers = tpl.body.items.map((i: { key: string; measure: string; tirePosition: string }) => ({ key: i.key, ok: true, value: i.measure === 'TREAD' ? (i.tirePosition === '2RO' ? 1.5 : 8) : 100 }));
    const ins = await http().post('/api/inspections').set(auth('a')).send({ vehicleId: id.v, templateId: tpl.body.id, odometerKm: 50_500, answers }).expect(201);
    expect(ins.body.result).toBe('FAIL');
    const checks = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM tire_checks WHERE inspection_id = $1::uuid`, ins.body.id);
    expect(checks[0].n).toBe(7);
    const fleet = await http().get('/api/tires').set(auth('a')).expect(200);
    expect(fleet.body.totals.critical).toBeGreaterThanOrEqual(1);
    expect(fleet.body.attention.some((x: { position: string }) => x.position === '2RO')).toBe(true);
    expect(await app.get(TiresService).alerts()).toBeGreaterThanOrEqual(1);
    await http().get(`/api/vehicles/${id.v}/tires`).set(auth('b')).expect(404);
    expect((await http().get('/api/tires').set(auth('b')).expect(200)).body.attention).toEqual([]);
  });

  it('warranty: coverage hints, claims and the recovered credit in the cost ledger', async () => {
    await http().post(`/api/vehicles/${id.v}/warranties`).set(auth('a')).send({ component: 'ENGINE', startDate: '2025-01-01', endKm: 200_000, supplierId: id.garage }).expect(201);
    await http().post(`/api/vehicles/${id.v}/warranties`).set(auth('a')).send({ component: 'BODY', startDate: '2025-01-01' }).expect(400);
    const wo = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.v, type: 'CORRECTIVE', title: 'Engine overheating; alternator noise', offRoad: false }).expect(201);
    const cov = await http().get(`/api/maintenance/work-orders/${wo.body.id}/warranty`).set(auth('a')).expect(200);
    const relevant = cov.body.items.filter((i: { relevant: boolean }) => i.relevant).map((i: { basis: string; label: string }) => `${i.basis}:${i.label}`);
    expect(relevant).toEqual(expect.arrayContaining(['VEHICLE:Engine', expect.stringMatching(/^PART:Alternator 24V/)]));
    const notes = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM notifications WHERE company_id = $1::uuid AND topic = 'warranty.possible'`, companyIds[0]);
    expect(notes[0].n).toBeGreaterThan(0);
    const partCov = cov.body.items.find((i: { basis: string }) => i.basis === 'PART');

    const claim = await http().post('/api/warranty-claims').set(auth('a')).send({ vehicleId: id.v, workOrderId: wo.body.id, supplierId: id.garage, basis: 'PART', basisRef: partCov.ref, description: 'Alternator failed within warranty', amountClaimed: 120_000 }).expect(201);
    expect(claim.body.claimNo).toMatch(/^WCL-\d{4}-00001$/);
    await http().patch(`/api/warranty-claims/${claim.body.id}`).set(auth('a')).send({ action: 'RECOVER' }).expect(400);
    await http().patch(`/api/warranty-claims/${claim.body.id}`).set(auth('a')).send({ action: 'SUBMIT' }).expect(200);
    await http().patch(`/api/warranty-claims/${claim.body.id}`).set(auth('a')).send({ action: 'APPROVE', amountApproved: 100_000 }).expect(200);
    const rec = await http().patch(`/api/warranty-claims/${claim.body.id}`).set(auth('a')).send({ action: 'RECOVER' }).expect(200);
    expect(rec.body).toMatchObject({ status: 'RECOVERED', amountRecovered: '100000' });
    const list = await http().get('/api/warranty-claims').set(auth('a')).expect(200);
    expect(list.body.totals.recoveredThisYear).toBe(100_000);
    expect((await http().get('/api/warranty-claims').set(auth('b')).expect(200)).body.items).toEqual([]);
    await http().patch(`/api/warranty-claims/${claim.body.id}`).set(auth('b')).send({ action: 'EDIT' }).expect(404);

    // Ledger / TCO: maintenance 345 (parts) + 88,000 (garage) − 100,000 recovered; tires 400,000 + 300,000 + 90,000.
    const tco = await http().get(`/api/analytics/tco?from=${monthStart}&to=${today}`).set(auth('a')).expect(200);
    expect(tco.body.totals.byCategory.MAINTENANCE).toBe(345 + 88_000 - 100_000);
    expect(tco.body.totals.byCategory.TIRES).toBe(790_000);
  });

  it('low stock alerts and stock.low', async () => {
    await http().post('/api/inventory/counts').set(auth('k')).send({ branchId: id.d2, reason: 'Count', lines: [{ partId: id.part, countedQty: 2 }] }).expect(201);
    expect(await app.get(InventoryService).lowStockAlerts()).toBeGreaterThanOrEqual(1);
    const reorder = await http().get(`/api/inventory/stock?branchId=${id.d2}&belowMin=true`).set(auth('k')).expect(200);
    expect(reorder.body.items).toEqual([expect.objectContaining({ qtyOnHand: 2, belowMin: true, suggestedOrder: 10 })]);
    // Alerted once a week, not every run.
    expect(await app.get(InventoryService).lowStockAlerts()).toBe(0);
  });
});
