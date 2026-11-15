import { autofill } from './autofill';
import { checkLoad, LoadItem, loadTotals, VehicleCapacity } from './capacity';
import { routeKm, sequenceStops } from './sequence';
import { orderOutcome } from './status';

const item = (id: string, over: Partial<LoadItem> = {}): LoadItem => ({
  id,
  externalRef: id,
  customerId: `c-${id}`,
  priority: 'NORMAL',
  township: 'Kamayut',
  city: 'Yangon',
  lat: 16.82,
  lng: 96.13,
  weightKg: 100,
  volumeM3: 0.5,
  cases: 10,
  pallets: 0.5,
  ...over,
});
const van = (id: string, over: Partial<VehicleCapacity> = {}): VehicleCapacity => ({
  id,
  plateNumber: id,
  capacityKg: 1000,
  capacityM3: 5,
  capacityCases: 100,
  capacityPallets: 4,
  maxStops: null,
  ...over,
});

describe('capacity', () => {
  it('totals orders and counts stops per customer', () => {
    const t = loadTotals([item('a'), item('b', { customerId: 'c-a', weightKg: null })]);
    expect(t).toMatchObject({ kg: 100, m3: 1, cases: 20, pallets: 1, stops: 1, orders: 2, missingWeight: 1 });
  });
  it('flags every exceeded limit and warns about missing data', () => {
    const c = checkLoad(van('v', { capacityKg: 150, capacityCases: 15, maxStops: 1 }), loadTotals([item('a'), item('b', { weightKg: null })]), 30);
    expect(c.violations.map((v) => v.limit).sort()).toEqual(['cases', 'stops']);
    expect(c.warnings[0]).toMatch(/no weight/);
    expect(checkLoad(van('v', { capacityKg: null, capacityM3: null, capacityCases: null, capacityPallets: null }), loadTotals([item('a')]), null).ok).toBe(true);
    // Company default stop limit applies when the vehicle has none.
    expect(checkLoad(van('v'), loadTotals([item('a'), item('b'), item('c')]), 2).violations).toEqual([{ limit: 'stops', used: 3, capacity: 2 }]);
  });
});

describe('autofill', () => {
  it('puts urgent orders first, keeps areas together, respects every limit', () => {
    const items = [
      item('n1', { township: 'Tamwe' }),
      item('u1', { priority: 'URGENT', township: 'Tamwe' }),
      item('n2', { township: 'Kamayut' }),
      item('n3', { township: 'Tamwe', pallets: 2 }), // 0.5 × 3 + 2 = 3.5 of 4 pallets
      item('big', { weightKg: 5000 }),
    ];
    const r = autofill(items, [van('small', { capacityKg: 300, capacityPallets: 2 }), van('large')], null, 30);
    expect(r.loads[0]).toEqual({ vehicleId: 'large', orderIds: ['u1', 'n2', 'n1', 'n3'] });
    expect(r.unplaced).toEqual([{ orderId: 'big', externalRef: 'big', reason: 'Too large for any available vehicle (kg)' }]);
    expect(autofill(items, [van('small', { capacityKg: 300, capacityPallets: 2 }), van('large')], null, 30)).toEqual(r); // deterministic
  });
  it('spills to the next vehicle and reports what is left', () => {
    const items = ['a', 'b', 'c'].map((id) => item(id, { weightKg: 400 }));
    const r = autofill(items, [van('v1', { capacityKg: 500 }), van('v2', { capacityKg: 500 })], null, 30);
    expect(r.loads.map((l) => l.orderIds.length)).toEqual([1, 1]);
    expect(r.unplaced[0].reason).toBe('No capacity left on available vehicles');
    expect(autofill(items, [], null, 30).unplaced[0].reason).toBe('No vehicle available');
  });
});

describe('sequence', () => {
  it('visits the nearest stop next and puts unlocated stops last', () => {
    const depot = { lat: 16.8, lng: 96.1 };
    const s = sequenceStops(depot, [
      { id: 'far', lat: 16.9, lng: 96.1 },
      { id: 'nowhere', lat: null, lng: null },
      { id: 'near', lat: 16.81, lng: 96.1 },
      { id: 'mid', lat: 16.85, lng: 96.1 },
    ]);
    expect(s.map((x) => x.id)).toEqual(['near', 'mid', 'far', 'nowhere']);
    expect(routeKm(depot, s)).toBeCloseTo(22.2, 0); // 11.1 km out and back
  });
});

describe('order outcome', () => {
  it('derives the order status from the stop result and delivered quantities', () => {
    expect(orderOutcome('FAILED', [])).toBe('FAILED');
    expect(orderOutcome('DELIVERED', [{ quantity: 5, deliveredQty: 0 }])).toBe('DELIVERED');
    expect(orderOutcome('PARTIAL', [{ quantity: 5, deliveredQty: 3 }])).toBe('PARTIAL');
    expect(orderOutcome('PARTIAL', [{ quantity: 5, deliveredQty: 5 }])).toBe('DELIVERED');
    expect(orderOutcome('PARTIAL', [{ quantity: 5, deliveredQty: 0 }])).toBe('FAILED');
  });
});
