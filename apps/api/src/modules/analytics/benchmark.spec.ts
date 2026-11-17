import { benchmark, BenchVehicle, percentile } from './benchmark';

const v = (id: string, cls: string, branch: string, u: number, km: number, cost: number): BenchVehicle => ({
  id,
  plateNumber: id,
  vehicleClass: cls,
  branchId: branch,
  branchName: branch,
  values: { utilizationPct: u, kmPerDay: km, tripsPerDay: 1, availabilityPct: 99, costPerKm: cost, fuelKmPerLitre: null, idlePct: null, overspeedPer100Km: null },
});

describe('benchmark', () => {
  it('percentiles with direction and ties', () => {
    expect(percentile(10, [10, 5, 1], true)).toBe(100);
    expect(percentile(1, [10, 5, 1], true)).toBe(0);
    expect(percentile(1, [10, 5, 1], false)).toBe(100);
    expect(percentile(5, [5, 5, 5], true)).toBe(50);
    expect(percentile(5, [5], true)).toBeNull();
    expect(percentile(null, [1, 2], true)).toBeNull();
  });

  it('compares within the class, scores, ranks and compares branches', () => {
    const r = benchmark([
      v('T1', 'TRUCK', 'Yangon', 90, 300, 900),
      v('T2', 'TRUCK', 'Yangon', 60, 200, 1100),
      v('T3', 'TRUCK', 'Mandalay', 30, 100, 1500),
      v('C1', 'CAR', 'Mandalay', 50, 80, 300),
    ]);
    expect(r.classes.find((c) => c.vehicleClass === 'TRUCK')!.medians.kmPerDay).toBe(200);
    const t1 = r.vehicles.find((x) => x.id === 'T1')!;
    expect(t1.metrics.kmPerDay).toEqual({ value: 300, vsMedianPct: 50, percentile: 100 });
    expect(t1.metrics.costPerKm.percentile).toBe(100); // cheapest
    expect(t1).toMatchObject({ score: 80, rank: 1, of: 3 }); // (100 + 100 + 50 + 50 + 100) / 5: trips and availability tie
    expect(r.vehicles.find((x) => x.id === 'T3')).toMatchObject({ rank: 3 });
    expect(r.vehicles.find((x) => x.id === 'C1')!.score).toBeNull(); // alone in its class
    expect(r.branches[0]).toMatchObject({ branchName: 'Yangon', vehicles: 2 });
    expect(r.branches[0].vsClassPct.kmPerDay).toBe(25); // (+50 % and 0 %) / 2
  });
});
