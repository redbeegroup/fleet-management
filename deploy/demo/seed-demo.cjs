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
  console.log(`Seeding Phase 2 demo data into ${BASE} as ${EMAIL}`);

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

  console.log(`\nDone: ${out.filter((x) => x.includes('FAILED') || /HTTP \d/.test(x)).length} step(s) need attention.`);
})().catch((e) => {
  console.error(`Demo seed failed: ${e.message}`);
  process.exit(1);
});
