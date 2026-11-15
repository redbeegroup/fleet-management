import { addMonths, allocateByKm, alertLevel, assetCost, bookValue, evaluateBudget, monthlyAmountOver, monthsIn, spreadFee } from './calc';

const owned = { ownership: 'OWNED', purchasePrice: 60_000_000, residualValue: 12_000_000, usefulLifeMonths: 60, monthlyLeaseCost: null, inServiceAt: '2025-01-01', disposedAt: null };

describe('costs/calc', () => {
  it('pro-rates a monthly amount by days', () => {
    expect(monthlyAmountOver(3000, '2026-11-01', '2026-11-30')).toBeCloseTo(3000);
    expect(monthlyAmountOver(3000, '2026-11-16', '2026-11-30')).toBeCloseTo(1500);
    expect(monthlyAmountOver(3100, '2026-12-01', '2027-01-31')).toBeCloseTo(6200);
    expect(monthlyAmountOver(3000, '2026-11-30', '2026-11-01')).toBe(0);
    expect(monthsIn('2026-11-20', '2027-02-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('depreciates straight-line and stops at the end of life or disposal', () => {
    expect(assetCost(owned, '2026-11-01', '2026-11-30')).toEqual({ category: 'DEPRECIATION', amount: 800_000 });
    // before service start
    expect(assetCost({ ...owned, inServiceAt: '2026-11-16' }, '2026-11-01', '2026-11-30')!.amount).toBe(400_000);
    // fully depreciated after 60 months (2029-12-31 is the last day)
    expect(assetCost(owned, '2030-01-01', '2030-01-31')!.amount).toBe(0);
    expect(assetCost(owned, '2025-01-01', '2029-12-31')!.amount).toBe(48_000_000);
    // disposal: no cost from the disposal day
    expect(assetCost({ ...owned, disposedAt: '2026-11-16' }, '2026-11-01', '2026-11-30')!.amount).toBe(400_000);
    expect(bookValue(owned, '2025-12-31')).toBe(50_400_000);
    expect(bookValue(owned, '2035-01-01')).toBe(12_000_000);
    // incomplete data → none
    expect(assetCost({ ...owned, usefulLifeMonths: null }, '2026-11-01', '2026-11-30')).toBeNull();
  });

  it('charges lease/rent monthly for non-owned vehicles', () => {
    const leased = { ...owned, ownership: 'LEASED', monthlyLeaseCost: 1_500_000, inServiceAt: '2026-11-11' };
    expect(assetCost(leased, '2026-11-01', '2026-11-30')).toEqual({ category: 'LEASE', amount: 1_000_000 });
    expect(assetCost({ ...leased, monthlyLeaseCost: null }, '2026-11-01', '2026-11-30')).toBeNull();
  });

  it('spreads document fees over their validity', () => {
    // 365 days valid, 30 of them in November
    expect(spreadFee(365_000, '2026-01-01', '2027-01-01', '2026-11-01', '2026-11-30')).toBe(30_000);
    expect(spreadFee(365_000, '2026-01-01', '2027-01-01', '2027-01-01', '2027-01-31')).toBe(0);
    expect(spreadFee(50_000, '2026-11-05', null, '2026-11-01', '2026-11-30')).toBe(50_000);
    expect(spreadFee(50_000, null, '2027-01-01', '2026-11-01', '2026-11-30')).toBe(0);
  });

  it('allocates by km with exact cents and leaves it unallocated without km', () => {
    const { parts, unallocated } = allocateByKm(100, [
      { vehicleId: 'a', km: 1 },
      { vehicleId: 'b', km: 1 },
      { vehicleId: 'c', km: 1 },
      { vehicleId: 'd', km: 0 },
    ]);
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(parts.get('a')).toBe(33.34);
    expect(parts.has('d')).toBe(false);
    expect(unallocated).toBe(0);
    expect(allocateByKm(100, [{ vehicleId: 'a', km: 0 }])).toEqual({ parts: new Map(), unallocated: 100 });
    const p = allocateByKm(1000, [{ vehicleId: 'a', km: 300 }, { vehicleId: 'b', km: 100 }]).parts;
    expect(p.get('a')).toBe(750);
    expect(p.get('b')).toBe(250);
  });

  it('evaluates budgets with a month-to-date forecast', () => {
    // 15 of 30 days, half spent → forecast = budget → at risk only if > budget
    expect(evaluateBudget(1000, 500, '2026-11', '2026-11-15')).toMatchObject({ usedPct: 50, forecast: 1000, status: 'OK', variance: 500 });
    expect(evaluateBudget(1000, 600, '2026-11', '2026-11-15')).toMatchObject({ forecast: 1200, status: 'AT_RISK' });
    expect(evaluateBudget(1000, 920, '2026-11', '2026-11-30').status).toBe('AT_RISK');
    expect(evaluateBudget(1000, 1001, '2026-10', '2026-11-15')).toMatchObject({ status: 'OVER', forecast: 1001 });
    expect(evaluateBudget(null, 10, '2026-11', '2026-11-15').status).toBe('NO_BUDGET');
    expect(evaluateBudget(1000, 0, '2026-12', '2026-11-15')).toMatchObject({ status: 'OK', forecast: 0 });
    expect([alertLevel(1000, 899), alertLevel(1000, 900), alertLevel(1000, 1000), alertLevel(0, 5)]).toEqual([null, 90, 100, null]);
  });
});
