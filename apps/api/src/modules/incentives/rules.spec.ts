import { periodBounds, previousPeriod, safetyBonuses, summarize } from './rules';

const settings = { safetyBonusEnabled: true, safetyBonusMinScore: 90, safetyBonusAmount: 30_000, trainingAlertDays: 30 };

describe('incentive rules', () => {
  it('computes periods', () => {
    expect(previousPeriod('2026-01-01')).toEqual({ period: '2025-12', from: '2025-12-01', to: '2025-12-31' });
    expect(previousPeriod('2026-03-15')).toEqual({ period: '2026-02', from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('proposes safety bonuses only when enabled, for scored drivers at/above the bar', () => {
    const drivers = [
      { id: 'a', fullName: 'A', score: 95, distanceKm: 800 },
      { id: 'b', fullName: 'B', score: 90, distanceKm: 300 },
      { id: 'c', fullName: 'C', score: 89, distanceKm: 900 },
      { id: 'd', fullName: 'D', score: null, distanceKm: 10 },
    ];
    expect(safetyBonuses(drivers, settings).map((x) => x.driverId)).toEqual(['a', 'b']);
    expect(safetyBonuses(drivers, { ...settings, safetyBonusEnabled: false })).toEqual([]);
  });
  it('summarizes approved amounts and counts pending', () => {
    const s = summarize([
      { driverId: 'a', kind: 'INCENTIVE', amount: 100, status: 'APPROVED' },
      { driverId: 'a', kind: 'PENALTY', amount: 30, status: 'APPROVED' },
      { driverId: 'a', kind: 'PENALTY', amount: 999, status: 'REJECTED' },
      { driverId: 'a', kind: 'INCENTIVE', amount: 50, status: 'PROPOSED' },
    ]);
    expect(s.get('a')).toEqual({ incentives: 100, penalties: 30, net: 70, pending: 1 });
  });
});
