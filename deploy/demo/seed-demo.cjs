#!/usr/bin/env node
/**
 * Phase 2 demo data for UAT, loaded through the public API (so every business rule applies).
 * Idempotent: run it again any time; existing items are kept and only what is missing is added.
 *
 *   FMS_URL=https://fms.example.com/api FMS_EMAIL=admin@fms.local FMS_PASSWORD=... node deploy/demo/seed-demo.cjs
 *
 * Needs a company admin of the demo company (the standard seed: admin@fms.local) with vehicles and drivers.
 */
const BASE = (process.env.FMS_URL || 'http://localhost:8080/api').replace(/\/$/, '');
const EMAIL = process.env.FMS_EMAIL || 'admin@fms.local';
const PASSWORD = process.env.FMS_PASSWORD || process.env.PW;
const TAG = '[demo]';
let H = {};
const out = [];
const note = (step, result) => {
  out.push(`${step}: ${result}`);
  console.log(`- ${step}: ${result}`);
};

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { s: res.status, b: body };
}
const send = (path, body, method = 'POST') => j(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ok = (r) => r.s >= 200 && r.s < 300;
const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000 + 6.5 * 3_600_000); // Asia/Yangon calendar day
  return d.toISOString().slice(0, 10);
};

async function step(name, fn) {
  try {
    note(name, await fn());
  } catch (e) {
    note(name, `FAILED ${e.message}`);
  }
}

(async () => {
  if (!PASSWORD) throw new Error('Set FMS_PASSWORD');
  const login = await send('/auth/login', { email: EMAIL, password: PASSWORD });
  if (!ok(login)) throw new Error(`Login failed (${login.s})`);
  H = { authorization: `Bearer ${login.b.accessToken}` };
  console.log(`Seeding demo data into ${BASE} as ${EMAIL}`);

  const branches = (await j('/branches')).b;
  const depot = branches.find((b) => b.code === 'YGN') || branches[0];
  const vehicles = (await j('/vehicles?pageSize=100')).b.items || [];
  const departments = (await j('/departments')).b || [];
  const month = day(0).slice(0, 7);
  const year = Number(month.slice(0, 4));

  await step('Settings (approval limits, control rules, POD, depot, fuel checks)', async () => {
    const r = await send(
      '/company/settings',
      {
        approvals: { expenseAbove: 200_000, fuelAbove: 400_000, workOrderAbove: 1_000_000 },
        control: { workingHoursEnabled: true, requireDriverOnDuty: false, movementWithoutTrip: false },
        pod: { requirePhoto: true, requireSignature: false, requireCodEntry: true, maxDistanceM: 300 },
        logistics: { defaultBranchId: depot.id, arrivalRadiusM: 150, driverCostPerDay: 35_000 },
        fuelControl: { cardSyncEnabled: false },
        diagnostics: { autoRepairCodes: ['P03'] },
      },
      'PATCH',
    );
    return ok(r) ? 'updated' : `HTTP ${r.s}`;
  });

  await step('Depot location', async () => {
    if (depot.latitude != null) return 'already set';
    const r = await send(`/branches/${depot.id}`, { latitude: 16.8726, longitude: 96.0607, address: 'Hlaing Tharyar Industrial Zone 3, Yangon' }, 'PATCH');
    return ok(r) ? 'set' : `HTTP ${r.s}`;
  });

  await step('Geofences (depot for loading time, restricted area)', async () => {
    const have = new Set(((await j('/geofences')).b || []).map((g) => g.name));
    const want = [
      { name: 'Yangon depot yard', category: 'BRANCH', shape: 'CIRCLE', centerLat: depot.latitude ?? 16.8726, centerLng: depot.longitude ?? 96.0607, radiusM: 250 },
      { name: 'Thilawa port (restricted)', category: 'RESTRICTED', shape: 'CIRCLE', centerLat: 16.6555, centerLng: 96.2678, radiusM: 1500, alertOnEnter: true },
    ];
    let n = 0;
    for (const g of want) if (!have.has(g.name) && ok(await send('/geofences', g))) n++;
    return `${n} added`;
  });

  await step('Vehicle cost of ownership and departments', async () => {
    const assets = [
      { ownership: 'OWNED', purchasePrice: 95_000_000, residualValue: 15_000_000, usefulLifeMonths: 96, inServiceAt: '2024-03-01' },
      { ownership: 'OWNED', purchasePrice: 62_000_000, residualValue: 10_000_000, usefulLifeMonths: 84, inServiceAt: '2025-01-15' },
      { ownership: 'LEASED', monthlyLeaseCost: 1_850_000, inServiceAt: '2025-06-01' },
      { ownership: 'OWNED', purchasePrice: 48_000_000, residualValue: 8_000_000, usefulLifeMonths: 72, inServiceAt: '2023-09-01' },
    ];
    let n = 0;
    for (const [i, v] of vehicles.slice(0, 4).entries()) {
      if (v.purchasePrice != null || v.monthlyLeaseCost != null) continue;
      if (ok(await send(`/vehicles/${v.id}`, { ...assets[i], departmentId: departments[i % Math.max(1, departments.length)]?.id ?? null }, 'PATCH'))) n++;
    }
    return `${n} updated`;
  });

  await step(`Budgets ${year} (depot branch)`, async () => {
    const lines = [];
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, '0')}`;
      for (const [category, amount] of [['FUEL', 1_200_000], ['MAINTENANCE', 600_000], ['DEPRECIATION', 1_700_000], ['LEASE', 1_850_000], ['TOLL', 80_000]]) lines.push({ period, branchId: depot.id, category, amount });
    }
    const r = await send('/costs/budgets', { lines }, 'PUT');
    return ok(r) ? `${r.b.saved} lines` : `HTTP ${r.s}`;
  });

  await step('Shared cost this month', async () => {
    const list = (await j(`/costs/shared?from=${month}-01&to=${day(0)}`)).b || [];
    if (list.some((c) => c.description.includes(TAG))) return 'already there';
    const r = await send('/costs/shared', { period: month, category: 'OTHER', description: `Workshop rent & tools ${TAG}`, amount: 900_000 });
    return ok(r) ? 'added' : `HTTP ${r.s}`;
  });

  await step('DMS orders for tomorrow (API key, created and revoked)', async () => {
    const key = await send('/integrations/api-keys', { name: `Demo seed ${TAG}`, scopes: ['orders:write', 'orders:read'] });
    if (!ok(key)) return `API key HTTP ${key.s}`;
    const d = day(1);
    const shops = [
      ['YGN-1101', 'Shwe Mart Ahlone', 16.784, 96.118], ['YGN-1102', 'City Express Lanmadaw', 16.776, 96.145], ['YGN-1103', 'Ocean Mini Pabedan', 16.781, 96.163],
      ['YGN-1104', 'Golden Lotus Mingalar Taung Nyunt', 16.792, 96.178], ['YGN-1105', 'Family Store Yankin', 16.832, 96.165], ['YGN-1106', 'Happy Mart Kamayut', 16.838, 96.128],
      ['YGN-1107', 'Diamond Store Hlaing', 16.851, 96.112], ['YGN-1108', 'Yadanar Minimart Bahan', 16.812, 96.152],
    ];
    let created = 0;
    for (const [i, [code, name, lat, lng]] of shops.entries()) {
      const r = await j(`/integrations/v1/orders/DEMO-${d}-${i + 1}`, {
        method: 'PUT',
        headers: { 'x-api-key': key.b.key, 'content-type': 'application/json', authorization: '' },
        body: JSON.stringify({
          customer: { code, name, city: 'Yangon', latitude: lat, longitude: lng, phone: `+95 9 450 11${10 + i}` },
          depotCode: depot.code,
          deliveryDate: d,
          codAmount: 45_000 + i * 12_500,
          lines: [
            { sku: 'WATER-1L', description: 'Drinking water 1 L x12', quantity: 20 + i * 3, uom: 'CTN', weightKg: (20 + i * 3) * 12.5, volumeM3: (20 + i * 3) * 0.018, cases: 20 + i * 3 },
            { sku: 'NOODLE-CUP', description: 'Cup noodles x24', quantity: 6, uom: 'CTN', weightKg: 18, volumeM3: 0.25, cases: 6 },
          ],
        }),
      });
      if (r.s === 201) created++;
    }
    await send(`/integrations/api-keys/${key.b.id}/revoke`, {});
    return `${created} new of ${shops.length}`;
  });

  await step('Delivery load for tomorrow (road routing when available)', async () => {
    const d = day(1);
    const plan = (await j(`/logistics/planning?date=${d}&branchId=${depot.id}`)).b;
    const ids = (plan.orders || []).filter((o) => o.externalRef.startsWith(`DEMO-${d}`)).map((o) => o.id);
    // Seeded before: the demo orders that fitted are on a load already (the rest stay to plan by hand).
    if (!ids.length || ids.length < 8) return `already planned (${(plan.loads || []).map((l) => l.tripNo).join(', ') || 'none'}); ${ids.length} order(s) left to plan`;
    for (const v of plan.vehicles || [])
      for (const dr of plan.drivers || []) {
        for (let n = ids.length; n >= 3; n--) {
          const r = await send('/logistics/loads', { date: d, branchId: depot.id, vehicleId: v.id, driverId: dr.id, orderIds: ids.slice(0, n), departAt: `${d}T01:30:00Z` });
          if (ok(r)) return `${r.b.tripNo}: ${n} orders, ${r.b.plannedKm} km (${r.b.routingSource})`;
          if (!r.b.violations) break;
        }
      }
    return 'no free vehicle/driver';
  });

  await step('Incident with an insurance claim', async () => {
    const list = (await j('/incidents?pageSize=50')).b;
    if ((list.items || list || []).some((i) => (i.description || '').includes(TAG))) return 'already there';
    const v = vehicles[0];
    const r = await send('/incidents', { vehicleId: v?.id ?? null, type: 'COLLISION', severity: 'MEDIUM', occurredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), location: 'Pyay Road, Kamayut', description: `Rear bumper hit at a traffic light ${TAG}`, injuries: false, thirdParty: 'Taxi 5K-1234', estimatedCost: 450_000 });
    if (!ok(r)) return `HTTP ${r.s}`;
    const c = await send(`/incidents/${r.b.id}/claims`, { insurer: 'Myanma Insurance', policyNo: 'MI-DEMO-001', amountClaimed: 450_000 });
    return ok(c) ? 'added with claim' : `incident added; claim HTTP ${c.s}`;
  });

  await step('Expense waiting for approval', async () => {
    const list = (await j('/expenses?pageSize=100')).b;
    if ((list.items || list || []).some((e) => (e.description || '').includes(TAG))) return 'already there';
    const r = await send('/expenses', { vehicleId: vehicles[1]?.id ?? vehicles[0].id, category: 'FINE', incurredAt: new Date(Date.now() - 86_400_000).toISOString(), amount: 250_000, description: `Overweight fine, Yangon-Mandalay expressway ${TAG}` });
    return ok(r) ? `added (${r.b.approvalStatus})` : `HTTP ${r.s}`;
  });

  await step('Fuel card and statement', async () => {
    const recs = ((await j('/fuel/records?pageSize=100')).b.items || []).filter((f) => f.approvalStatus !== 'REJECTED');
    const by = {};
    for (const f of recs) (by[f.vehicleId] ||= []).push(f);
    const top = Object.entries(by).sort((a, b) => b[1].length - a[1].length)[0];
    if (!top) return 'no fuel records to match';
    const [vehicleId, fills] = top;
    const cards = (await j('/fuel/cards')).b || [];
    if (!cards.some((c) => c.provider === 'MAX' && c.last4 === '7788')) await send('/fuel/cards', { provider: 'MAX', number: '6011 2233 4455 7788', vehicleId, label: 'Demo card' });
    const local = (iso) => {
      const l = new Date(Date.parse(iso) + 390 * 60_000);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`;
    };
    const rows = ['Reference,Transaction date,Card,Site,Product,Qty (L),Amount'];
    fills.slice(0, 6).forEach((f, i) => rows.push(`MX-${f.id.slice(0, 8)},${local(f.filledAt)},6011********7788,Max Energy Hlaing,Diesel,${Number(f.litres)},"${Math.round(Number(f.totalCost) * (i === 1 ? 1.12 : 1))}"`));
    rows.push(`MX-EXTRA-${month},${local(new Date(Date.now() - 3 * 86_400_000).toISOString())},6011********7788,Max Energy Thaketa,Diesel,45,"148500"`);
    rows.push(`MX-WASH-${month},${local(new Date(Date.now() - 2 * 86_400_000).toISOString())},6011********7788,Max Energy Thaketa,Car wash,,"8000"`);
    const fd = new FormData();
    fd.append('file', new Blob([rows.join('\n')], { type: 'text/csv' }), 'max-demo-statement.csv');
    fd.append('mapping', JSON.stringify({ provider: 'MAX', columns: { externalId: 'Reference', occurredAt: 'Transaction date', card: 'Card', station: 'Site', product: 'Product', litres: 'Qty (L)', amount: 'Amount' }, dateFormat: 'DMY' }));
    fd.append('commit', 'true');
    const r = await j('/fuel/card-statements', { method: 'POST', body: fd });
    return ok(r) ? `${r.b.imported} new transactions (${r.b.duplicates} already imported)` : `HTTP ${r.s}`;
  });

  await step('Workshop (S16): suppliers, parts stock in two depots, tires, warranty and a claim', async () => {
    const branches = (await j('/branches')).b || [];
    const vehicles = ((await j('/vehicles?pageSize=50')).b || {}).items || [];
    const truck = vehicles.find((v) => v.vehicleClass === 'TRUCK') || vehicles[0];
    if (!branches.length || !truck) return 'skipped: no branch or vehicle';
    const [d1, d2] = [branches[0].id, (branches[1] || branches[0]).id];
    let sups = (await j('/suppliers')).b || [];
    for (const s of [
      { name: 'Shwe Auto Garage', kinds: ['GARAGE'], phone: '+95 9 450 112233', paymentTermsDays: 30 },
      { name: 'Yangon Truck Parts', kinds: ['PARTS'], paymentTermsDays: 30 },
      { name: 'Golden Tyre Co.', kinds: ['TIRES'], paymentTermsDays: 14 },
    ]) if (!sups.some((x) => x.name === s.name)) await send('/suppliers', { ...s, notes: TAG });
    sups = (await j('/suppliers')).b || [];
    const sup = (n) => sups.find((x) => x.name === n).id;
    await send('/inventory/parts/import', { parts: [
      { partNo: 'ALT-24V-80A', name: 'Alternator 24V 80A', category: 'Electrical', minQty: 2, reorderQty: 4, warrantyMonths: 12, warrantyKm: 50000 },
      { partNo: 'OF-ISZ-01', name: 'Oil filter Isuzu', category: 'Filters', minQty: 10, reorderQty: 24 },
      { partNo: 'BP-FR-02', name: 'Brake pads front (set)', category: 'Brakes', minQty: 4, reorderQty: 8, warrantyMonths: 6, warrantyKm: 20000 },
      { partNo: 'BAT-12V-100', name: 'Battery 12V 100Ah', category: 'Electrical', minQty: 2, reorderQty: 4, warrantyMonths: 18 },
    ] });
    const parts = Object.fromEntries(((await j('/inventory/parts')).b || []).map((x) => [x.partNo, x.id]));
    const stock = ((await j('/inventory/stock')).b || { items: [] }).items;
    const done = [];
    if (!stock.length) {
      await send('/inventory/receipts', { branchId: d1, supplierId: sup('Yangon Truck Parts'), reference: 'DEMO-GRN-1', lines: [
        { partId: parts['ALT-24V-80A'], qty: 4, unitCost: 420000 }, { partId: parts['OF-ISZ-01'], qty: 30, unitCost: 18000 },
        { partId: parts['BP-FR-02'], qty: 6, unitCost: 95000 }, { partId: parts['BAT-12V-100'], qty: 3, unitCost: 265000 } ] });
      if (d2 !== d1) await send('/inventory/transfers', { fromBranchId: d1, toBranchId: d2, lines: [{ partId: parts['OF-ISZ-01'], qty: 12 }, { partId: parts['BP-FR-02'], qty: 3 }] });
      done.push('stock received');
    }
    const sheet = (await j(`/vehicles/${truck.id}/tires`)).b;
    if (sheet && !sheet.totals.changes) {
      const odo = Number(truck.odometerKm || 0);
      const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
      for (const [pos, brand, d] of [['1L', 'Bridgestone', 200], ['1R', 'Bridgestone', 200], ['2LO', 'Maxxis', 300], ['2LI', 'Maxxis', 300], ['2RI', 'Maxxis', 300], ['2RO', 'Maxxis', 300]])
        await send(`/vehicles/${truck.id}/tires/changes`, { position: pos, reason: 'NEW_FIT', brand, size: '8.25R16', cost: brand === 'Maxxis' ? 360000 : 420000, supplierId: sup('Golden Tyre Co.'), odometerKm: Math.max(0, odo - d * 60), changedAt: ago(d), warrantyMonths: 12, notes: TAG });
      await send(`/vehicles/${truck.id}/tires/checks`, { readings: [{ position: '1L', treadMm: 7.5 }, { position: '1R', treadMm: 7.2 }, { position: '2LO', treadMm: 3.6 }, { position: '2LI', treadMm: 4.8 }, { position: '2RI', treadMm: 5.1 }, { position: '2RO', treadMm: 2.4 }] });
      done.push('tires fitted and checked');
    }
    const warranties = (await j(`/warranties?vehicleId=${truck.id}`)).b || [];
    if (!warranties.length) {
      await send(`/vehicles/${truck.id}/warranties`, { component: 'ENGINE', label: 'Powertrain', startDate: day(-600), endDate: day(500), endKm: 200000, supplierId: sup('Shwe Auto Garage'), terms: TAG });
      done.push('engine warranty');
    }
    const claims = ((await j('/warranty-claims')).b || { items: [] }).items;
    if (!claims.length) {
      const wo1 = (await send('/maintenance/work-orders', { vehicleId: truck.id, type: 'CORRECTIVE', title: `${TAG} Battery not charging`, offRoad: false })).b;
      await send(`/maintenance/work-orders/${wo1.id}/parts`, { partId: parts['ALT-24V-80A'], branchId: d1, qty: 1 });
      await send(`/maintenance/work-orders/${wo1.id}/complete`, { resolution: 'Alternator replaced' });
      const wo2 = (await send('/maintenance/work-orders', { vehicleId: truck.id, type: 'CORRECTIVE', title: `${TAG} Alternator noise again`, supplierId: sup('Shwe Auto Garage'), quoteAmount: 60000, offRoad: false })).b;
      const cov = (await j(`/maintenance/work-orders/${wo2.id}/warranty`)).b;
      const part = cov && cov.items.find((i) => i.basis === 'PART');
      if (part) {
        const c = (await send('/warranty-claims', { vehicleId: truck.id, workOrderId: wo2.id, supplierId: sup('Yangon Truck Parts'), basis: 'PART', basisRef: part.ref, description: 'Alternator bearing failed within warranty', amountClaimed: 420000 })).b;
        await send(`/warranty-claims/${c.id}`, { action: 'SUBMIT' }, 'PATCH');
        await send(`/warranty-claims/${c.id}`, { action: 'APPROVE', amountApproved: 420000 }, 'PATCH');
        await send(`/warranty-claims/${c.id}`, { action: 'RECOVER', amountRecovered: 420000 }, 'PATCH');
      }
      done.push('garage job, repeat repair and a recovered warranty claim');
    }
    return done.length ? done.join(', ') : 'already loaded';
  });

  console.log(`\nDone: ${out.filter((x) => x.includes('FAILED') || /HTTP \d/.test(x)).length} step(s) need attention.`);
})().catch((e) => {
  console.error(`Demo seed failed: ${e.message}`);
  process.exit(1);
});
