import { safetySettingsSchema } from '@fms/shared';
import { attributeDistance, safetyScore } from './score';

const s = safetySettingsSchema.parse({});
const base = { distanceKm: 0, overspeed: 0, harshBrake: 0, harshAccel: 0, harshCorner: 0, idleMinutes: 0 };

describe('safetyScore', () => {
  it('is 100 for clean driving and drops with weighted events per 100 km', () => {
    expect(safetyScore({ ...base, distanceKm: 500 }, s)).toMatchObject({ score: 100, band: 'GOOD' });
    // 500 km, 10 overspeed (50 pts) + 5 brakes (20) + 60 idle min (6) = 76 pts → 15.2 / 100 km
    expect(safetyScore({ ...base, distanceKm: 500, overspeed: 10, harshBrake: 5, idleMinutes: 60 }, s)).toEqual({ score: 85, pointsPer100Km: 15.2, band: 'GOOD' });
    expect(safetyScore({ ...base, distanceKm: 100, overspeed: 8 }, s)).toMatchObject({ score: 60, band: 'POOR' });
  });
  it('needs a minimum distance and never goes below 0', () => {
    expect(safetyScore({ ...base, distanceKm: 20, overspeed: 1 }, s)).toEqual({ score: null, pointsPer100Km: null, band: 'INSUFFICIENT_DATA' });
    expect(safetyScore({ ...base, distanceKm: 60, harshBrake: 100 }, s).score).toBe(0);
  });
});

describe('attributeDistance', () => {
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  it('splits by trips, else uses the assignment at noon', () => {
    const r = attributeDistance(
      [
        { vehicleId: 'v1', day: '2026-01-01', distanceKm: 100 },
        { vehicleId: 'v1', day: '2026-01-02', distanceKm: 50 },
        { vehicleId: 'v2', day: '2026-01-02', distanceKm: 30 },
      ],
      [
        { vehicleId: 'v1', driverId: 'a', day: '2026-01-01', gpsDistanceKm: 60 },
        { vehicleId: 'v1', driverId: 'b', day: '2026-01-01', gpsDistanceKm: 20 },
      ],
      [{ vehicleId: 'v1', driverId: 'c', from: new Date('2026-01-01T00:00:00Z'), to: null }],
      noon,
    );
    expect(Object.fromEntries(r)).toEqual({ a: 75, b: 25, c: 50 }); // v2 unattributed
  });
});
