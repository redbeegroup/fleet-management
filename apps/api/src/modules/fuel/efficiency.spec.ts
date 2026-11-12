import { computeFuelChain, median } from './efficiency';

const d = (day: number) => new Date(Date.UTC(2026, 0, day));
const opts = { tankCapacityL: 100, lowEfficiencyRatio: 0.7 };

describe('computeFuelChain', () => {
  it('computes full-to-full efficiency including partial fills', () => {
    const r = computeFuelChain(
      [
        { id: 'a', filledAt: d(1), odometerKm: 1000, litres: 50, fullTank: true },
        { id: 'b', filledAt: d(2), odometerKm: 1200, litres: 20, fullTank: false },
        { id: 'c', filledAt: d(3), odometerKm: 1500, litres: 30, fullTank: true },
      ],
      opts,
    );
    expect(r.get('a')).toMatchObject({ kmPerLitre: null, distanceKm: null });
    expect(r.get('b')?.kmPerLitre).toBeNull();
    expect(r.get('c')).toMatchObject({ distanceKm: 500, segmentLitres: 50, kmPerLitre: 10 });
  });

  it('is order-independent (back-dated entries)', () => {
    const fills = [
      { id: 'c', filledAt: d(3), odometerKm: 1500, litres: 50, fullTank: true },
      { id: 'a', filledAt: d(1), odometerKm: 1000, litres: 50, fullTank: true },
    ];
    expect(computeFuelChain(fills, opts).get('c')?.kmPerLitre).toBe(10);
  });

  it('flags odometer going backwards and excludes it from the chain', () => {
    const r = computeFuelChain(
      [
        { id: 'a', filledAt: d(1), odometerKm: 1000, litres: 40, fullTank: true },
        { id: 'bad', filledAt: d(2), odometerKm: 900, litres: 40, fullTank: true },
        { id: 'c', filledAt: d(3), odometerKm: 1400, litres: 40, fullTank: true },
      ],
      opts,
    );
    expect(r.get('bad')?.flags).toEqual(['ODOMETER_BACKWARDS']);
    expect(r.get('c')?.kmPerLitre).toBe(10);
  });

  it('flags refills larger than the tank', () => {
    const r = computeFuelChain([{ id: 'a', filledAt: d(1), odometerKm: 0, litres: 140, fullTank: true }], opts);
    expect(r.get('a')?.flags).toContain('OVER_TANK_CAPACITY');
  });

  it('flags low efficiency against the vehicle median', () => {
    const fills = [0, 1, 2, 3, 4].map((i) => ({ id: `f${i}`, filledAt: d(i + 1), odometerKm: i * 500, litres: 50, fullTank: true }));
    fills.push({ id: 'thirsty', filledAt: d(10), odometerKm: 2500, litres: 100, fullTank: true }); // 5 km/L vs 10
    const r = computeFuelChain(fills, opts);
    expect(r.get('thirsty')?.flags).toContain('LOW_EFFICIENCY');
    expect(r.get('f3')?.flags).toEqual([]);
  });

  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
