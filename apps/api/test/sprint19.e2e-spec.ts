/**
 * Sprint 19: rate cards and trip revenue, profitability, SAP S/4HANA link against a fake SAP
 * (master data, monthly cost posting with retry and reversal, garage purchase orders, receipt check,
 * billing import), tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { resetEnvCache } from '../src/common/config/env';
import { SapService } from '../src/modules/sap/sap.service';

const PASSWORD = 'E2ePassword123!';
const run = `s19${Date.now().toString(36)}`;
const DAY = 86_400_000;

describe('Sprint 19 rate cards, profitability, SAP (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let sap: Server;
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const calls: { method: string; path: string; body: string }[] = [];
  let journalFailures = 1;
  let docNo = 100_000_000;
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });
  const local = (ms = Date.now()) => new Date(ms + 6.5 * 3_600_000).toISOString().slice(0, 10);
  const lastMonth = (() => {
    const d = new Date(`${local().slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const body = (req: IncomingMessage) => new Promise<string>((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c)).on('end', () => resolve(s));
  });
  const results = (rows: unknown[]) => JSON.stringify({ d: { results: rows } });

  beforeAll(async () => {
    sap = createServer(async (req, res) => {
      const b = await body(req);
      const path = decodeURIComponent(req.url ?? '');
      calls.push({ method: req.method ?? '', path, body: b });
      if (req.headers.authorization !== `Basic ${Buffer.from('FMS_COMM:s3cret').toString('base64')}`) return res.writeHead(401).end();
      const json = (s: string, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(s);
      if (path.includes('API_COSTCENTER_SRV/A_CostCenter'))
        return json(results([{ CostCenter: 'FL1000', ControllingArea: 'A000', to_Text: { results: [{ CostCenterName: 'Fleet Yangon' }] } }, { CostCenter: 'FL9000', ControllingArea: 'A000', to_Text: { results: [{ CostCenterName: 'Fleet admin' }] } }]));
      if (path.includes('A_Supplier')) return json(results([{ Supplier: '100001', SupplierName: 'Shwe Garage' }]));
      if (path.includes('A_Product')) return json(results([{ Product: `${run}-MAT`, BaseUnit: 'EA', to_Description: { results: [{ Language: 'EN', ProductDescription: 'Oil filter' }] } }]));
      if (path.includes('A_FixedAsset')) return json(results([{ MasterFixedAsset: '200001', FixedAsset: '0', FixedAssetDescription: `Truck ${run}-TR`, AcquisitionValue: '90000000' }]));
      if (path.includes('A_Customer')) return json(results([{ Customer: `${run}-C1`, CustomerName: 'Shop One' }]));
      if (path.includes('journalentrycreaterequestconfi')) {
        if (journalFailures-- > 0) return res.writeHead(500).end('<Fault>temporarily unavailable</Fault>');
        return res.writeHead(200, { 'content-type': 'text/xml' }).end(`<x><JournalEntryCreateConfirmation><AccountingDocument>${++docNo}</AccountingDocument></JournalEntryCreateConfirmation></x>`);
      }
      if (req.method === 'GET' && req.headers['x-csrf-token'] === 'fetch') return res.writeHead(200, { 'x-csrf-token': 'tok123', 'set-cookie': 'SAP_SESSIONID=abc; path=/' }).end();
      if (req.method === 'POST' && path.includes('A_PurchaseOrder')) {
        if (req.headers['x-csrf-token'] !== 'tok123' || !String(req.headers.cookie).includes('SAP_SESSIONID=abc')) return res.writeHead(403).end();
        return json(JSON.stringify({ d: { PurchaseOrder: '4500000001' } }), 201);
      }
      if (path.includes("A_PurchaseOrder('4500000099')"))
        return json(JSON.stringify({ d: { PurchaseOrder: '4500000099', Supplier: '100001', to_PurchaseOrderItem: { results: [{ PurchaseOrderItem: '10', Material: `${run}-MAT`, OrderQuantity: '10', NetPriceAmount: '1000' }] } } }));
      if (path.includes('A_PurchaseOrder(')) return res.writeHead(404).end();
      if (path.includes('A_BillingDocument'))
        return json(results([{ BillingDocument: '90000001', BillingDocumentDate: `/Date(${Date.now()})/`, SoldToParty: `${run}-C1`, TransactionCurrency: 'MMK', PurchaseOrderByCustomer: id.dTripNo, to_Item: { results: [{ BillingDocumentItem: '10', NetAmount: '30000' }] } }]));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => sap.listen(0, '127.0.0.1', () => r()));
    process.env.SAP_MODE = 'odata';
    process.env.SAP_ALLOW_INSECURE = 'true';
    resetEnvCache();

    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S19 ${tag}`, timezone: 'Asia/Yangon' } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const a = companyIds[0];
      id.branch = (await tx.branch.create({ data: { companyId: a, code: `B${run}`, name: 'Yangon', latitude: 16.8, longitude: 96.13 } })).id;
      id.dept = (await tx.department.create({ data: { companyId: a, code: `D${run}`, name: 'Fleet Yangon' } })).id;
      id.truck = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-TR`, make: 'Isuzu', model: 'FVR', vehicleClass: 'TRUCK', capacityKg: 10_000, branchId: id.branch, departmentId: id.dept } })).id;
      id.van = (await tx.vehicle.create({ data: { companyId: a, plateNumber: `${run}-VN`, make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN', branchId: id.branch } })).id;
      const u = await tx.user.create({ data: { companyId: a, email: `d-${run}@e2e.local`, fullName: 'Driver', passwordHash, roles: ['DRIVER'] } });
      id.driver = (await tx.driver.create({ data: { companyId: a, employeeNo: `${run}-D`, fullName: 'Driver', userId: u.id, licenses: { create: { companyId: a, number: 'L1', licenseClass: 'E', expiresAt: new Date(Date.now() + 365 * DAY) } } } })).id;
      id.c1 = (await tx.customer.create({ data: { companyId: a, code: `${run}-C1`, name: 'Shop One' } })).id;
      id.c2 = (await tx.customer.create({ data: { companyId: a, code: `${run}-C2`, name: 'Shop Two' } })).id;
      id.garage = (await tx.supplier.create({ data: { companyId: a, name: 'Shwe Garage', kinds: ['GARAGE'] } })).id;
      id.part = (await tx.part.create({ data: { companyId: a, partNo: `${run}-MAT`, name: 'Oil filter' } })).id;
      // A completed multi-drop delivery trip (one failed drop).
      const end = new Date(Date.now() - 2 * 3_600_000);
      const trip = await tx.trip.create({ data: { companyId: a, tripNo: `${run}-T1`, kind: 'DELIVERY', status: 'COMPLETED', vehicleId: id.truck, driverId: id.driver, branchId: id.branch, originName: 'Depot', destinationName: 'Route', plannedStart: new Date(end.getTime() - 5 * 3_600_000), plannedEnd: end, actualStart: new Date(end.getTime() - 5 * 3_600_000), actualEnd: end, plannedKm: 100 } });
      id.dTrip = trip.id;
      id.dTripNo = trip.tripNo;
      const stop = async (seq: number, customerId: string, status: 'DELIVERED' | 'FAILED', kg: number, waitMin: number) => {
        const s = await tx.tripStop.create({ data: { companyId: a, tripId: trip.id, seq, customerId, name: `Stop ${seq}`, status, arrivedAt: new Date(end.getTime() - 3_600_000), completedAt: new Date(end.getTime() - 3_600_000 + waitMin * 60_000) } });
        await tx.deliveryOrder.create({ data: { companyId: a, externalRef: `${run}-O${seq}`, customerId, branchId: id.branch, deliveryDate: end, totalWeightKg: kg, payloadHash: `h${seq}`, tripId: trip.id, stopId: s.id, status: status === 'FAILED' ? 'FAILED' : 'DELIVERED' } });
      };
      await stop(1, id.c1, 'DELIVERED', 2_000, 50);
      await stop(2, id.c2, 'DELIVERED', 3_000, 10);
      await stop(3, id.c2, 'FAILED', 500, 5);
      // Last month's costs for the SAP posting: the truck (cost centre via its department) and the van (default).
      const lm = new Date(`${lastMonth}-15T05:00:00Z`);
      await tx.workOrder.create({ data: { companyId: a, woNo: `${run}-W1`, vehicleId: id.truck, type: 'PREVENTIVE', status: 'COMPLETED', title: 'Service', openedAt: lm, completedAt: lm, totalCost: 300_000 } });
      await tx.workOrder.create({ data: { companyId: a, woNo: `${run}-W2`, vehicleId: id.van, type: 'PREVENTIVE', status: 'COMPLETED', title: 'Service', openedAt: lm, completedAt: lm, totalCost: 200_000 } });
      id.vb = (await tx.vehicle.create({ data: { companyId: companyIds[1], plateNumber: `${run}-VB`, make: 'X', model: 'Y', vehicleClass: 'TRUCK' } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
  });

  beforeEach(() => {
    const store = app.get<ThrottlerStorageService>(getStorageToken());
    store.storage.clear();
    (store as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    delete process.env.SAP_MODE;
    delete process.env.SAP_ALLOW_INSECURE;
    resetEnvCache();
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1::uuid)`, companyId);
        for (const tbl of ['sap_billing_items', 'sap_documents', 'cost_posting_lines', 'cost_postings', 'sap_sync_runs', 'integration_credentials', 'trip_revenues', 'rate_cards', 'stock_movements', 'part_stocks', 'parts', 'work_order_lines', 'work_orders', 'suppliers', 'delivery_orders', 'trip_stops', 'trip_status_events', 'trips', 'customers', 'driver_licenses', 'drivers', 'notifications', 'vehicle_status_events', 'vehicles', 'departments', 'branches', 'company_counters', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    await new Promise<void>((r) => sap.close(() => r()));
  });

  it('rate cards: a trip is rated on completion; delivery trips per customer; re-rate', async () => {
    const from = '2026-01-01';
    await http().post('/api/rate-cards').set(auth('a')).send({ name: 'Nothing', validFrom: from }).expect(400);
    const def = await http().post('/api/rate-cards').set(auth('a')).send({ name: 'Standard', validFrom: from, perKm: 1_000, perDrop: 5_000, minCharge: 50_000 }).expect(201);
    const truckCard = await http().post('/api/rate-cards').set(auth('a')).send({ name: 'Trucks general', vehicleClass: 'TRUCK', validFrom: from, perTrip: 100_000 }).expect(201);
    await http().post('/api/rate-cards').set(auth('a')).send({ name: 'Shop One', customerId: id.c1, validFrom: from, perTrip: 20_000, perKg: 10, fuelSurchargePct: 10 }).expect(201);
    expect((await http().post(`/api/rate-cards/${def.body.id}/preview`).set(auth('a')).send({ km: 20, drops: 1 }).expect(201)).body).toMatchObject({ amount: 50_000, breakdown: { km: 20_000, drops: 5_000, minimumTopUp: 25_000 } });
    // General trip through the API: rated by the truck card when it completes.
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const g = await http().post('/api/trips').set(auth('a')).send({ originName: 'Depot', destinationName: 'Bago', plannedStart: at(-1), plannedEnd: at(3), vehicleId: id.truck, driverId: id.driver }).expect(201);
    expect((await http().post(`/api/trips/${g.body.id}/start`).set(auth('a')).send({})).status).toBeLessThan(300);
    expect((await http().post(`/api/trips/${g.body.id}/complete`).set(auth('a')).send({})).status).toBeLessThan(300);
    const gr = await http().get(`/api/trips/${g.body.id}/revenue`).set(auth('a')).expect(200);
    expect(gr.body).toMatchObject({ total: 100_000, rows: [expect.objectContaining({ rateCardName: 'Trucks general', source: 'RATE_CARD' })] });
    // Delivery trip: Shop One 2,000 kg (share 0.4), Shop Two 3,000 kg (0.6); the failed drop is not charged.
    const d = await http().post(`/api/trips/${id.dTrip}/revenue/recompute`).set(auth('a')).expect(201);
    const by = (c: string) => d.body.rows.find((r: { customerId: string }) => r.customerId === c);
    expect(by(id.c1)).toMatchObject({ rateCardName: 'Shop One', amount: '30800', basis: { share: 0.4, kg: 2_000, drops: 1, km: 40, waitMinutes: 50 } });
    // No customer card for Shop Two: the truck class card is more specific than the standard card.
    expect(by(id.c2)).toMatchObject({ rateCardName: 'Trucks general', amount: '60000', basis: { share: 0.6, drops: 1, km: 60 } });
    expect(d.body.total).toBe(90_800);
    // A cheaper truck card: re-rating the period changes the general trip and Shop Two, not Shop One.
    await http().patch(`/api/rate-cards/${truckCard.body.id}`).set(auth('a')).send({ name: 'Trucks general', vehicleClass: 'TRUCK', validFrom: from, perTrip: 80_000 }).expect(200);
    const rr = await http().post('/api/rate-cards/rerate').set(auth('a')).send({ from: local(Date.now() - DAY), to: local() }).expect(201);
    expect(rr.body).toEqual({ trips: 2, revenue: 80_000 + 30_800 + 48_000 });
    await http().get(`/api/trips/${id.dTrip}/revenue`).set(auth('b')).expect(404);
    expect((await http().get('/api/rate-cards').set(auth('b')).expect(200)).body).toEqual([]);
  });

  it('profitability by trip, customer, vehicle and branch', async () => {
    const q = `from=${local(Date.now() - DAY)}&to=${local()}`;
    const trips = await http().get(`/api/analytics/profitability?${q}&groupBy=trip`).set(auth('a')).expect(200);
    expect(trips.body.totals).toMatchObject({ trips: 2, revenue: 158_800, unrated: 0 });
    for (const r of trips.body.rows) expect(r.margin).toBeCloseTo(r.revenue - r.cost, 2);
    const cust = await http().get(`/api/analytics/profitability?${q}&groupBy=customer`).set(auth('a')).expect(200);
    expect(cust.body.rows.find((r: { key: string }) => r.key === id.c1)).toMatchObject({ label: 'Shop One', revenue: 30_800, trips: 1 });
    expect(cust.body.rows.find((r: { key: string }) => r.key === 'none')).toMatchObject({ revenue: 80_000 });
    const veh = await http().get(`/api/analytics/profitability?${q}&groupBy=vehicle`).set(auth('a')).expect(200);
    expect(veh.body.rows.find((r: { key: string }) => r.key === id.truck)).toMatchObject({ revenue: 158_800, trips: 2, fullCost: expect.any(Number) });
    const csv = await http().get(`/api/analytics/profitability.csv?${q}&groupBy=branch`).set(auth('a')).expect(200);
    expect(csv.text.split('\n')[0]).toBe('name,detail,trips,revenue,cost,margin,margin_pct,billed');
    expect((await http().get(`/api/analytics/profitability?${q}`).set(auth('b')).expect(200)).body.totals.trips).toBe(0);
  });

  it('SAP: connection, master data, asset link', async () => {
    const base = `http://127.0.0.1:${(sap.address() as AddressInfo).port}`;
    await http().post('/api/sap/test').set(auth('a')).expect(400); // no connection yet
    await http().put('/api/sap/connection').set(auth('a')).send({ baseUrl: base, username: 'FMS_COMM' }).expect(400); // secret needed
    await http().put('/api/sap/connection').set(auth('a')).send({ baseUrl: base, username: 'FMS_COMM', secret: 's3cret', sapClient: '100' }).expect(200);
    const st = await http().get('/api/sap').set(auth('a')).expect(200);
    expect(st.body.connection).toMatchObject({ baseUrl: base, hasSecret: true });
    expect(JSON.stringify(st.body)).not.toContain('s3cret');
    expect((await http().post('/api/sap/test').set(auth('a')).expect(200)).body.ok).toBe(true);
    expect(calls.at(-1)!.path).toContain('sap-client=100');
    await http()
      .patch('/api/company/settings')
      .set(auth('a'))
      .send({ sap: { enabled: true, companyCode: '1000', controllingArea: 'A000', plant: 'P100', purchasingOrg: 'PO10', purchasingGroup: 'G01', glAccounts: { MAINTENANCE: '610200', default: '619900' }, offsetAccount: '219000', defaultCostCenter: 'FL9000', serviceGlAccount: '610300' } })
      .expect(200);
    const sync = await http().post('/api/sap/sync').set(auth('a')).expect(201);
    expect(sync.body).toMatchObject({ status: 'OK', errors: [] });
    expect(sync.body.stats).toMatchObject({ costCenters: { received: 2, matched: 1, created: 1 }, vendors: { matched: 1, created: 0 }, materials: { matched: 1 }, customers: { matched: 1 } });
    expect(sync.body.stats.assets.suggestions[0]).toMatchObject({ assetNo: '200001', vehicleId: id.truck, linked: false });
    const m = await http().post('/api/sap/assets/match').set(auth('a')).send({ vehicleId: id.truck, sapAssetNo: '200001' }).expect(200);
    expect(m.body).toMatchObject({ sapAssetNo: '200001', purchasePrice: '90000000' });
    const sup = await admin.$queryRawUnsafe<{ external_ref: string }[]>(`SELECT external_ref FROM suppliers WHERE id = $1::uuid`, id.garage);
    expect(sup[0].external_ref).toBe('100001');
    await http().post('/api/sap/assets/match').set(auth('b')).send({ vehicleId: id.truck, sapAssetNo: '200001' }).expect(404);
    expect((await http().get('/api/sap').set(auth('b')).expect(200)).body.connection).toBeNull();
  });

  it('SAP: month posting (retry after an error), re-posting reverses the previous document', async () => {
    await http().post('/api/sap/postings').set(auth('a')).send({ period: local().slice(0, 7) }).expect(400); // month not ended
    const pv = await http().get(`/api/sap/postings/preview?period=${lastMonth}`).set(auth('a')).expect(200);
    expect(pv.body.errors).toEqual([]);
    expect(pv.body.lines).toEqual([
      { costCenter: 'FL1000', glAccount: '610200', category: 'MAINTENANCE', vehicles: 1, amount: 300_000 },
      { costCenter: 'FL9000', glAccount: '610200', category: 'MAINTENANCE', vehicles: 1, amount: 200_000 },
    ]);
    const p1 = await http().post('/api/sap/postings').set(auth('a')).send({ period: lastMonth }).expect(201);
    expect(p1.body).toMatchObject({ version: 1, status: 'PENDING', total: '500000' });
    await http().post('/api/sap/postings').set(auth('a')).send({ period: lastMonth }).expect(409); // still being posted
    const svc = app.get(SapService);
    expect(await svc.dispatchDue()).toEqual({ sent: 0, failed: 1 });
    const doc = (await http().get('/api/sap/documents').set(auth('a')).expect(200)).body[0];
    expect(doc).toMatchObject({ kind: 'JOURNAL', status: 'PENDING', attempts: 1, lastError: expect.stringContaining('HTTP 500') });
    await admin.$executeRawUnsafe(`UPDATE sap_documents SET next_attempt_at = now() WHERE id = $1::uuid`, doc.id);
    expect(await svc.dispatchDue()).toEqual({ sent: 1, failed: 0 });
    const xml = calls.filter((c) => c.path.includes('journalentrycreaterequestconfi')).at(-1)!.body;
    expect(xml).toContain('<CostCenter>FL1000</CostCenter>');
    expect(xml).toContain('<GLAccount>219000</GLAccount>');
    expect(xml).toContain('<AmountInTransactionCurrency currencyCode="MMK">-500000.00</AmountInTransactionCurrency>');
    let list = (await http().get('/api/sap/postings').set(auth('a')).expect(200)).body;
    expect(list[0]).toMatchObject({ version: 1, status: 'POSTED', sapDocNo: '100000001' });
    // Re-post: the reversal goes first, then the new journal.
    await http().post('/api/sap/postings').set(auth('a')).send({ period: lastMonth }).expect(201);
    expect(await svc.dispatchDue()).toEqual({ sent: 2, failed: 0 });
    list = (await http().get('/api/sap/postings').set(auth('a')).expect(200)).body;
    expect(list.map((x: { version: number; status: string }) => `${x.version}:${x.status}`)).toEqual(['2:POSTED', '1:REVERSED']);
    const journals = calls.filter((c) => c.path.includes('journalentrycreaterequestconfi'));
    expect(journals.at(-2)!.body).toContain('<DocumentHeaderText>Reversal');
    expect(journals.at(-2)!.body).toContain('<AmountInTransactionCurrency currencyCode="MMK">-300000.00</AmountInTransactionCurrency>');
    expect((await http().get('/api/sap/postings').set(auth('b')).expect(200)).body).toEqual([]);
  });

  it('SAP: garage job purchase order and invoice check; parts receipt against a PO', async () => {
    const wo = await http().post('/api/maintenance/work-orders').set(auth('a')).send({ vehicleId: id.van, type: 'CORRECTIVE', title: 'Clutch', supplierId: id.garage, quoteAmount: 100_000, offRoad: false }).expect(201);
    expect((await http().post(`/api/maintenance/work-orders/${wo.body.id}/start`).set(auth('a')).send({})).status).toBeLessThan(300);
    const queued = await admin.$queryRawUnsafe<{ po_status: string }[]>(`SELECT po_status FROM work_orders WHERE id = $1::uuid`, wo.body.id);
    expect(queued[0].po_status).toBe('REQUESTED');
    expect(await app.get(SapService).dispatchDue()).toEqual({ sent: 1, failed: 0 });
    const poCall = calls.find((c) => c.method === 'POST' && c.path.includes('A_PurchaseOrder'))!;
    expect(JSON.parse(poCall.body)).toMatchObject({ Supplier: '100001', CompanyCode: '1000', to_PurchaseOrderItem: [{ NetPriceAmount: '100000.00', to_AccountAssignment: [{ GLAccount: '610300', CostCenter: 'FL9000' }] }] });
    expect((await http().post(`/api/maintenance/work-orders/${wo.body.id}/complete`).set(auth('a')).send({ resolution: 'Clutch replaced', invoiceNo: 'INV-9', invoiceAmount: 120_000 })).status).toBeLessThan(300);
    const done = await admin.$queryRawUnsafe<{ po_number: string; po_status: string }[]>(`SELECT po_number, po_status FROM work_orders WHERE id = $1::uuid`, wo.body.id);
    expect(done[0]).toEqual({ po_number: '4500000001', po_status: 'INVOICE_MISMATCH' });
    // Receipt of 12 against PO 4500000099 (10 ordered at 1,000).
    await http().post('/api/inventory/receipts').set(auth('a')).send({ branchId: id.branch, supplierId: id.garage, poNumber: '4500000099', lines: [{ partId: id.part, qty: 12, unitCost: 1_000 }] }).expect(201);
    expect(await app.get(SapService).checkReceipts()).toBe(1);
    const rc = await http().get('/api/sap/receipts').set(auth('a')).expect(200);
    expect(rc.body[0]).toMatchObject({ poNumber: '4500000099', poCheck: { ok: false, issues: [expect.objectContaining({ issue: 'QTY_OVER' })] } });
    expect((await http().get('/api/sap/receipts').set(auth('b')).expect(200)).body).toEqual([]);
  });

  it('SAP: billing import and billed vs rated', async () => {
    const r = await http().post('/api/sap/billing/import').set(auth('a')).expect(201);
    expect(r.body).toMatchObject({ status: 'OK', stats: { received: 1, imported: 1, unmatched: 0 } });
    await http().post('/api/sap/billing/import').set(auth('a')).expect(201); // idempotent
    const rev = await http().get(`/api/trips/${id.dTrip}/revenue`).set(auth('a')).expect(200);
    expect(rev.body).toMatchObject({ total: 78_800, billed: 30_000 });
    const b = await http().get(`/api/sap/billing?from=${local(Date.now() - DAY)}&to=${local(Date.now() + DAY)}`).set(auth('a')).expect(200);
    expect(b.body.items).toHaveLength(1);
    expect(b.body.compare[0]).toMatchObject({ tripNo: id.dTripNo, billed: 30_000, rated: 78_800, diff: -48_800 });
    expect((await http().get(`/api/sap/billing?from=${local(Date.now() - DAY)}&to=${local(Date.now() + DAY)}`).set(auth('b')).expect(200)).body.items).toEqual([]);
  });
});
