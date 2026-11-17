import { tireLayoutOf, TIRE_LAYOUTS, tireSettingsSchema } from '@fms/shared';
import { lifeByBrand, positionStatus, replay } from './tires';

const d = (s: string) => new Date(`${s}T08:00:00Z`);
const settings = tireSettingsSchema.parse({ pressureTargets: { TRUCK: 100 } });

describe('tires', () => {
  it('layouts by class', () => {
    expect(tireLayoutOf('TRUCK')).toBe('4x2-6');
    expect(tireLayoutOf('CAR')).toBe('car-4');
    expect(tireLayoutOf('TRUCK', '6x4-10')).toBe('6x4-10');
    expect(tireLayoutOf('TRUCK', 'nope')).toBe('4x2-6');
    expect(TIRE_LAYOUTS['4x2-6'].positions).toHaveLength(7);
  });

  it('replays fits, replacements and simultaneous rotations', () => {
    const { current, removed } = replay([
      { id: 'a', position: '1L', changedAt: d('2026-01-01'), odometerKm: 10_000, reason: 'NEW_FIT', brand: 'Bridgestone', size: '7.50R16', cost: 400_000 },
      { id: 'b', position: '1R', changedAt: d('2026-01-01'), odometerKm: 10_000, reason: 'NEW_FIT', brand: 'Maxxis', size: '7.50R16', cost: 300_000 },
      { id: 'r1', position: '1L', fromPosition: '1R', changedAt: d('2026-03-01'), odometerKm: 20_000, reason: 'ROTATION', cost: 0 },
      { id: 'r2', position: '1R', fromPosition: '1L', changedAt: d('2026-03-01'), odometerKm: 20_000, reason: 'ROTATION', cost: 0 },
      { id: 'c', position: '1L', changedAt: d('2026-06-01'), odometerKm: 50_000, reason: 'WORN', brand: 'Bridgestone', size: '7.50R16', cost: 420_000, removedTreadMm: 2 },
    ]);
    expect(current.get('1R')!.brand).toBe('Bridgestone');
    expect(current.get('1R')!.fitOdometerKm).toBe(10_000); // km continue after rotation
    expect(current.get('1L')!.changeId).toBe('c');
    expect(removed).toEqual([expect.objectContaining({ brand: 'Maxxis', kmRun: 40_000, cost: 300_000, costPerKm: 7.5, removedTreadMm: 2 })]);
    expect(lifeByBrand(removed)).toEqual([{ brand: 'Maxxis', size: '7.50R16', tires: 1, avgKm: 40_000, costPerKm: 7.5 }]);
  });

  it('tread, wear projection, pressure, life and warranty', () => {
    const tire = replay([{ id: 'a', position: '2LO', changedAt: d('2026-01-01'), odometerKm: 0, reason: 'NEW_FIT', cost: 1, warrantyMonths: 12, warrantyKm: 50_000 }]).current.get('2LO')!;
    const checks = [
      { position: '2LO', checkedAt: d('2026-02-01'), odometerKm: 10_000, treadMm: 12 },
      { position: '2LO', checkedAt: d('2026-04-01'), odometerKm: 30_000, treadMm: 8, pressure: 85 },
      { position: '2RO', checkedAt: d('2026-04-01'), treadMm: 2 },
    ];
    const st = positionStatus('2LO', tire, checks, { odometerKm: 40_000, now: d('2026-05-01'), settings, pressureTarget: 100 });
    expect(st).toMatchObject({ kmSinceFit: 40_000, treadMm: 8, treadStatus: 'OK', kmToMinTread: 25_000, pressure: 85, pressureStatus: 'LOW', level: 'critical', warrantyActive: true, overLife: false });
    expect(positionStatus('2RO', null, checks, { odometerKm: 0, now: d('2026-05-01'), settings, pressureTarget: null })).toMatchObject({ treadStatus: 'REPLACE', level: 'critical' });
    const worn = positionStatus('2LO', tire, [{ position: '2LO', checkedAt: d('2026-04-01'), treadMm: 3.5 }], { odometerKm: 90_000, now: d('2027-02-01'), settings, pressureTarget: 100 });
    expect(worn).toMatchObject({ treadStatus: 'WARN', overLife: true, warrantyActive: false, level: 'warn' });
    expect(positionStatus('1L', null, [], { odometerKm: 0, now: d('2026-05-01'), settings, pressureTarget: 100 }).level).toBe('unknown');
  });
});
