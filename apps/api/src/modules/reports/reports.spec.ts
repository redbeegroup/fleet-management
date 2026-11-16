import { buildBudget, buildDelivery, buildFleet, buildSafety } from './builders';
import { change, csvText } from './model';
import { dueNow, isoWeekKey, lastPeriod, localClock } from './period';
import { renderHtml, renderPdf } from './render';

const ctx = { company: 'Acme <Fleet>', currency: 'MMK', scope: 'All branches', periodLabel: 'Oct 2026' };
const fleetK = (o: Partial<Record<string, number | null>> = {}) => ({ vehicles: 2, distanceKm: 1000, totalCost: 500000, costPerKm: 500, fuelCost: 300000, maintenanceCost: 150000, otherCost: 50000, fuelKmPerLitre: 8, utilizationPct: 70, availabilityPct: 98, tripsCompleted: 20, overspeedEvents: 3, ...o }) as never;

describe('report periods', () => {
  it('daily = yesterday; weekly = last Mon–Sun; monthly = last month', () => {
    expect(lastPeriod('DAILY', '2026-03-01')).toMatchObject({ key: '2026-02-28', from: '2026-02-28', to: '2026-02-28', endExclusive: '2026-03-01', prev: { from: '2026-02-27' } });
    // 2026-11-16 is a Monday
    expect(lastPeriod('WEEKLY', '2026-11-16')).toMatchObject({ key: '2026-W46', from: '2026-11-09', to: '2026-11-15', endExclusive: '2026-11-16', prev: { from: '2026-11-02', to: '2026-11-08' } });
    expect(lastPeriod('WEEKLY', '2026-11-18').from).toBe('2026-11-09');
    expect(lastPeriod('MONTHLY', '2026-01-01')).toMatchObject({ key: '2025-12', from: '2025-12-01', to: '2025-12-31', prev: { from: '2025-11-01', to: '2025-11-30' }, label: 'Dec 2025' });
    expect(lastPeriod('MONTHLY', '2024-03-15')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('ISO week keys across year ends', () => {
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01');
  });

  it('due from 07:00 local, never for periods that ended before the subscription existed', () => {
    expect(dueNow('DAILY', { date: '2026-11-16', hour: 6 }, '2026-11-01')).toBeNull();
    expect(dueNow('DAILY', { date: '2026-11-16', hour: 7 }, '2026-11-01')?.key).toBe('2026-11-15');
    expect(dueNow('DAILY', { date: '2026-11-16', hour: 9 }, '2026-11-16')).toBeNull();
    expect(dueNow('WEEKLY', { date: '2026-11-17', hour: 8 }, '2026-11-12')?.key).toBe('2026-W46');
    expect(dueNow('MONTHLY', { date: '2026-11-01', hour: 7 }, '2026-11-02')).toBeNull();
  });

  it('local clock in the company time zone', () => {
    expect(localClock(new Date('2026-11-16T00:45:00Z'), 'Asia/Yangon')).toEqual({ date: '2026-11-16', hour: 7 });
    expect(localClock(new Date('2026-11-16T00:45:00Z'), 'America/New_York')).toEqual({ date: '2026-11-15', hour: 19 });
  });
});

describe('report model', () => {
  it('changes vs previous with direction', () => {
    expect(change(110, 100, false)).toEqual({ text: '+10.0 % vs previous', good: false });
    expect(change(90, 100, false)).toEqual({ text: '-10.0 % vs previous', good: true });
    expect(change(92.5, 90, true, 'pts')).toEqual({ text: '+2.5 pts vs previous', good: true });
    expect(change(5, 0, null)).toBeUndefined();
    expect(change(null, 3, true)).toBeUndefined();
  });

  it('CSV quoting and formula neutralising', () => {
    expect(csvText({ columns: ['a', 'b'], rows: [['x,y', '=SUM(A1)'], [-5, null], ['say "hi"', 'ok']] })).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n-5,\r\n"say ""hi""",ok\r\n');
  });
});

describe('report builders and renderers', () => {
  const fleet = buildFleet(ctx, { fleet: fleetK(), vehicles: [{ plateNumber: 'YGN-1', branchName: 'Main', distanceKm: 600, totalCost: 400000, costPerKm: 666.7, fuelKmPerLitre: 7.5, utilizationPct: 80, downtimePct: 0 }, { plateNumber: 'YGN-2', branchName: null, distanceKm: 400, totalCost: 0, costPerKm: 0, fuelKmPerLitre: null, utilizationPct: 60, downtimePct: 2 }], branches: [] }, { fleet: fleetK({ totalCost: 400000, utilizationPct: 65 }), vehicles: [], branches: [] });

  it('fleet: KPIs with changes, only vehicles with cost in the top list', () => {
    expect(fleet.kpis[0]).toMatchObject({ label: 'Total cost', value: '500,000 MMK', change: { text: '+25.0 % vs previous', good: false } });
    expect(fleet.kpis[3].change).toEqual({ text: '+5.0 pts vs previous', good: true });
    expect(fleet.sections[0].bars!.map((b) => b.label)).toEqual(['YGN-1']);
    expect(fleet.csv[0].table.rows).toHaveLength(2);
  });

  it('budget, delivery and safety build without data', () => {
    const b = buildBudget({ ...ctx, month: '2026-10' }, [{ scope: 'Company', category: 'FUEL', budget: 100, actual: 120, usedPct: 120, forecast: 120, status: 'OVER' }, { scope: 'Main', category: 'MAINTENANCE', budget: 50, actual: 10, usedPct: 20, forecast: 30, status: 'OK' }], { totals: { total: 0, km: 0, perKm: null, byCategory: {}, unallocated: 0 }, vehicles: [] });
    expect(b.sections[0].table!.rows).toEqual([['Company', 'FUEL', '100', '120', '120.0 %', '120', 'Over budget']]);
    expect(b.kpis[3].value).toBe('1 / 0');
    const d = buildDelivery(ctx, { totals: { trips: 0, attempted: 0, otifPct: null, successRatePct: null, onTimeRatePct: null, costPerDrop: null, fillPct: null, avgEtaErrorMin: null, failureReasons: {} }, drivers: [] }, null, { totals: { loading: { visits: 0, avgMin: null, p90Min: null }, unloading: { visits: 0, avgMin: null, p90Min: null } }, sites: [] }, 0);
    expect(d.kpis[0].value).toBe('—');
    const s = buildSafety(ctx, { fleet: { drivers: 0, scoredDrivers: 0, averageScore: null, belowThreshold: 0, distanceKm: 0, events: { overspeed: 0, harshBrake: 0, harshAccel: 0, harshCorner: 0 } }, drivers: [], settings: { alertBelow: 70 } }, null, { incidents: 1, injuries: 1, claims: { open: 0, claimed: 0, paid: 0 }, inspections: { total: 0, failed: 0 }, alertsByType: {}, expiring: [] });
    expect(s.kpis[4].value).toBe('1 (1 with injuries)');
  });

  it('HTML escapes text and shows bars and empty sections', () => {
    const html = renderHtml(fleet, { app: 'https://fms.test' });
    expect(html).toContain('Acme &lt;Fleet&gt;');
    expect(html).not.toContain('<Fleet>');
    expect(html).toContain('#2a78d6');
    expect(html).toContain('https://fms.test');
  });

  it('PDF renders (A4, non-Latin text replaced)', async () => {
    const pdf = await renderPdf({ ...fleet, company: 'မြန်မာ Co' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
