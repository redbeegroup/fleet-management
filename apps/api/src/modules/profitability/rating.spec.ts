import { CardLike, pickCard, rate, splitTrip } from './rating';

const card = (o: Partial<CardLike>): CardLike => ({
  id: 'c',
  customerId: null,
  vehicleClass: null,
  branchId: null,
  validFrom: new Date('2026-01-01'),
  validTo: null,
  active: true,
  priority: 0,
  perTrip: 0,
  perKm: 0,
  perKg: 0,
  perDrop: 0,
  perPallet: 0,
  minCharge: 0,
  fuelSurchargePct: 0,
  waitingPerHour: 0,
  freeWaitMinutes: 0,
  ...o,
});

describe('pickCard', () => {
  const cards = [
    card({ id: 'default' }),
    card({ id: 'truck', vehicleClass: 'TRUCK' }),
    card({ id: 'cust', customerId: 'C1' }),
    card({ id: 'cust-truck', customerId: 'C1', vehicleClass: 'TRUCK' }),
    card({ id: 'old', customerId: 'C1', vehicleClass: 'TRUCK', validTo: new Date('2026-03-31'), priority: 9 }),
    card({ id: 'off', customerId: 'C2', active: false }),
  ];
  const q = (customerId: string | null, vehicleClass: string | null, date = '2026-06-01') => pickCard(cards, { customerId, vehicleClass, branchId: null, date: new Date(date) })?.id;
  it('prefers customer + class, then customer, then class, then default', () => {
    expect(q('C1', 'TRUCK')).toBe('cust-truck');
    expect(q('C1', 'VAN')).toBe('cust');
    expect(q('C9', 'TRUCK')).toBe('truck');
    expect(q('C2', 'VAN')).toBe('default'); // inactive customer card ignored
  });
  it('respects validity and priority', () => {
    expect(q('C1', 'TRUCK', '2026-02-01')).toBe('old');
    expect(pickCard([card({ validFrom: new Date('2027-01-01') })], { customerId: null, vehicleClass: null, branchId: null, date: new Date('2026-06-01') })).toBeNull();
  });
});

describe('rate', () => {
  it('adds charges, waiting above the free time, fuel surcharge', () => {
    const r = rate(card({ perTrip: 20_000, perKm: 1_000, perKg: 5, perDrop: 3_000, waitingPerHour: 10_000, freeWaitMinutes: 30, fuelSurchargePct: 10 }), { km: 120, kg: 4_000, drops: 3, pallets: 0, waitMinutes: 90, share: 1 });
    expect(r.breakdown).toMatchObject({ trip: 20_000, km: 120_000, kg: 20_000, drops: 9_000, waiting: 10_000, surcharge: 17_900, minimumTopUp: 0 });
    expect(r.amount).toBe(196_900);
  });
  it('tops up to the minimum charge, in proportion to the share', () => {
    const r = rate(card({ perKm: 500, minCharge: 50_000 }), { km: 20, kg: 0, drops: 1, pallets: 0, waitMinutes: 0, share: 0.5 });
    expect(r).toEqual({ amount: 25_000, breakdown: expect.objectContaining({ km: 10_000, minimumTopUp: 15_000 }) });
  });
});

describe('splitTrip', () => {
  it('splits by weight and the shares add up to 1', () => {
    const s = splitTrip(
      [
        { customerId: 'A', kg: 1_000, pallets: 1, waitMinutes: 10 },
        { customerId: 'B', kg: 2_000, pallets: 2, waitMinutes: 5 },
        { customerId: 'A', kg: 0, pallets: 0, waitMinutes: 20 },
      ],
      90,
    );
    expect(s).toEqual([
      { customerId: 'A', kg: 1_000, drops: 2, pallets: 1, waitMinutes: 30, share: 0.3333, km: 30 },
      { customerId: 'B', kg: 2_000, drops: 1, pallets: 2, waitMinutes: 5, share: 0.6667, km: 60 },
    ]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 6);
  });
  it('uses the drop share when nothing was weighed', () => {
    expect(splitTrip([{ customerId: 'A', kg: 0, pallets: 0, waitMinutes: 0 }, { customerId: 'B', kg: 0, pallets: 0, waitMinutes: 0 }], 10).map((x) => x.share)).toEqual([0.5, 0.5]);
  });
});
