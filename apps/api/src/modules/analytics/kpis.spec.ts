import { fleetKpis, VehicleAgg, vehicleKpis } from './kpis';

const base: VehicleAgg = {
  id: 'v', plateNumber: 'P', vehicleClass: 'TRUCK', branchId: null, branchName: null,
  distanceKm: 0, daysUsed: 0, engineMinutes: 0, idleMinutes: 0, movingMinutes: 0, maxSpeedKmh: null,
  fuelCost: 0, fuelLitres: 0, fuelSegKm: 0, fuelSegLitres: 0, maintenanceCost: 0, otherCost: 0,
  downtimeMinutes: 0, tripsCompleted: 0, overspeedEvents: 0,
};

describe('KPIs', () => {
  const a: VehicleAgg = { ...base, id: 'a', distanceKm: 1000, daysUsed: 5, engineMinutes: 600, idleMinutes: 60, fuelCost: 300_000, fuelLitres: 120, fuelSegKm: 900, fuelSegLitres: 100, maintenanceCost: 100_000, otherCost: 20_000, downtimeMinutes: 1440, tripsCompleted: 10, overspeedEvents: 3 };
  const b: VehicleAgg = { ...base, id: 'b' }; // idle vehicle

  it('computes per-vehicle KPIs', () => {
    const k = vehicleKpis(a, 10);
    expect(k).toMatchObject({ totalCost: 420_000, costPerKm: 420, fuelKmPerLitre: 9, maintenanceCostPerKm: 100, utilizationPct: 50, idlePct: 10, downtimePct: 10, overspeedPer100Km: 0.3 });
  });

  it('returns nulls instead of dividing by zero', () => {
    expect(vehicleKpis(b, 10)).toMatchObject({ costPerKm: null, fuelKmPerLitre: null, idlePct: null, overspeedPer100Km: null, utilizationPct: 0 });
  });

  it('aggregates the fleet (idle vehicles lower utilization)', () => {
    const f = fleetKpis([a, b], 10);
    expect(f).toMatchObject({ vehicles: 2, distanceKm: 1000, totalCost: 420_000, costPerKm: 420, utilizationPct: 25, availabilityPct: 95, tripsPerVehiclePerDay: 0.5 });
  });

  it('handles an empty fleet', () => {
    expect(fleetKpis([], 7)).toMatchObject({ vehicles: 0, costPerKm: null, utilizationPct: null, availabilityPct: null });
  });
});
