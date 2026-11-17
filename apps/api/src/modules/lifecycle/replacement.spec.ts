import { advise, economicLife, median } from './replacement';

const L = { maxAgeYears: 10, maxKm: 600_000, maxDowntimePct: 15, costAboveClassPct: 30, planWithinMonths: 12 };
const base = { ageMonths: 60, odometerKm: 300_000, kmPerMonth: 5_000, downtimePct12m: 3, runningPerKm12m: 1000, km12m: 60_000, classMedianRunningPerKm: 1000, classPeers: 5, economicLifeYears: null };

describe('replacement advice', () => {
  it('OK within limits', () => {
    expect(advise(base, L)).toEqual({ advice: 'OK', reasons: [], monthsToLimit: 60 });
  });
  it('replace now on age, km, downtime, cost vs class or economic life', () => {
    expect(advise({ ...base, ageMonths: 121 }, L).advice).toBe('REPLACE_NOW');
    expect(advise({ ...base, odometerKm: 610_000 }, L).reasons).toEqual(['610,000 km (limit 600,000)']);
    expect(advise({ ...base, downtimePct12m: 18 }, L).advice).toBe('REPLACE_NOW');
    expect(advise({ ...base, runningPerKm12m: 1400 }, L).reasons).toEqual(['Running cost 40 % above the class median per km']);
    // cost vs class needs at least 3 peers and real km
    expect(advise({ ...base, runningPerKm12m: 1400, classPeers: 2 }, L).advice).toBe('OK');
    expect(advise({ ...base, economicLifeYears: 4 }, L).reasons).toEqual(['Past its economic life (4 years)']);
  });
  it('plans when a limit comes within the window', () => {
    const r = advise({ ...base, odometerKm: 560_000 }, L);
    expect(r).toEqual({ advice: 'PLAN', reasons: ['Reaches 600,000 km in about 8 months'], monthsToLimit: 8 });
    expect(advise({ ...base, ageMonths: 114 }, L).reasons).toEqual(['Reaches 10 years in 6 months']);
  });
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('economic life', () => {
  const asset = { price: 60_000_000, residual: 6_000_000, lifeMonths: 120 };
  it('finds the minimum average cost per km, projecting rising running costs', () => {
    // running cost per km rises by 15 per year from 515: the optimum lies after the history
    const years = [1, 2, 3].map((y) => ({ year: y, km: 60_000, running: (500 + 15 * y) * 60_000 }));
    const e = economicLife(years, asset)!;
    expect(e.projected).toBe(true);
    expect(e.years).toBeGreaterThan(3);
    expect(e.years).toBeLessThan(12);
    // running costs rising faster than the value falls: the first year is the cheapest
    expect(economicLife([1, 2, 3].map((y) => ({ year: y, km: 60_000, running: (400 + 100 * y) * 60_000 })), asset)!.years).toBe(1);
    // flat running cost: cheapest when depreciation ends (year 10) or later
    const flat = economicLife([1, 2, 3].map((y) => ({ year: y, km: 60_000, running: 500 * 60_000 })), asset)!;
    expect(flat.years).toBeGreaterThanOrEqual(10);
  });
  it('needs asset data and two years', () => {
    expect(economicLife([{ year: 1, km: 1, running: 1 }], asset)).toBeNull();
    expect(economicLife([{ year: 1, km: 1, running: 1 }, { year: 2, km: 1, running: 1 }], null)).toBeNull();
  });
});
