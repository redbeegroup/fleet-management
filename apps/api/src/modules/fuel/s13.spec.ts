import { consumptionVariance, kmCheck, locationCheck } from './checks';
import { cardLast4, parseAmount, parseStatementDate, reconcile } from './reconcile';

describe('fuel checks', () => {
  it('compares the fill location with the vehicle', () => {
    const fill = { lat: 16.8, lng: 96.15 };
    expect(locationCheck({ fill, vehicle: { lat: 16.8, lng: 96.152, speedKmh: 0, minutesFromFill: 1 }, maxM: 500 })).toEqual({ distanceM: 213, flag: null });
    expect(locationCheck({ fill, vehicle: { lat: 16.82, lng: 96.15, speedKmh: 0, minutesFromFill: 1 }, maxM: 500 }).flag).toBe('VEHICLE_ELSEWHERE');
    expect(locationCheck({ fill: null, vehicle: { lat: 16.82, lng: 96.15, speedKmh: 60, minutesFromFill: 1 }, maxM: 500 })).toEqual({ distanceM: null, flag: 'VEHICLE_ELSEWHERE' });
    expect(locationCheck({ fill, vehicle: { lat: 17, lng: 96, speedKmh: 0, minutesFromFill: 40 }, maxM: 500 }).flag).toBeNull(); // no recent fix
    expect(locationCheck({ fill, vehicle: null, maxM: 500 })).toEqual({ distanceM: null, flag: null });
  });

  it('compares odometer and GPS distance', () => {
    expect(kmCheck(400, 330, 15)).toBe('KM_MISMATCH');
    expect(kmCheck(400, 380, 15)).toBeNull();
    expect(kmCheck(15, 40, 15)).toBeNull();
    expect(kmCheck(null, 300, 15)).toBeNull();
  });

  it('measures consumption against the vehicle, else the class', () => {
    const v = consumptionVariance({ segments: [{ km: 400, litres: 50 }, { km: 300, litres: 50 }], baseline: [8, 8, 9, 8], classBaseline: [10, 10, 10], unitPrice: 3000 });
    // actual 7 km/L vs expected 8: 700 km needed 87.5 L, used 100 → 12.5 L excess
    expect(v).toMatchObject({ actualKmPerL: 7, expectedKmPerL: 8, basis: 'vehicle', variancePct: -12.5, excessLitres: 12.5, excessCost: 37_500 });
    expect(consumptionVariance({ segments: [{ km: 500, litres: 50 }], baseline: [9], classBaseline: [10, 10, 10], unitPrice: null })).toMatchObject({ basis: 'class', variancePct: 0, excessLitres: 0, excessCost: null });
    expect(consumptionVariance({ segments: [], baseline: [], classBaseline: [], unitPrice: null }).variancePct).toBeNull();
  });
});

describe('fuel card reconciliation', () => {
  const t0 = new Date('2026-11-10T03:00:00Z');
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const tol = { matchHours: 2, matchLitresPct: 3, matchAmountPct: 2 };
  it('matches one-to-one by vehicle, time and amount', () => {
    const recs = [
      { id: 'r1', vehicleId: 'v1', filledAt: at(10), litres: 40, totalCost: 120_000 },
      { id: 'r2', vehicleId: 'v1', filledAt: at(60), litres: 20, totalCost: 60_000 },
      { id: 'r3', vehicleId: 'v2', filledAt: at(0), litres: 30, totalCost: 90_000 },
    ];
    const res = reconcile(
      [
        { id: 't1', vehicleId: 'v1', occurredAt: at(0), litres: 40, amount: 120_000 },
        { id: 't2', vehicleId: 'v1', occurredAt: at(55), litres: 25, amount: 75_000 },
        { id: 't3', vehicleId: 'v2', occurredAt: at(300), litres: 30, amount: 90_000 },
        { id: 't4', vehicleId: null, occurredAt: at(0), litres: 10, amount: 30_000 },
      ],
      recs,
      tol,
    );
    expect(res).toEqual([
      { txnId: 't1', status: 'MATCHED', fuelRecordId: 'r1', differences: { minutes: 10 } },
      { txnId: 't4', status: 'CARD_ONLY', fuelRecordId: null, differences: null },
      { txnId: 't2', status: 'MISMATCH', fuelRecordId: 'r2', differences: { minutes: 5, amount: -15_000, litres: -5 } },
      { txnId: 't3', status: 'CARD_ONLY', fuelRecordId: null, differences: null },
    ]);
  });

  it('parses statement values', () => {
    expect(cardLast4('7083 **** **** 1234')).toBe('1234');
    expect(cardLast4('12')).toBeNull();
    expect([parseAmount('1,250,000'), parseAmount('1.250,50'), parseAmount('125000 MMK'), parseAmount('(25.00)'), parseAmount(''), parseAmount(42)]).toEqual([1_250_000, 1250.5, 125_000, -25, null, 42]);
    // Yangon is UTC+6:30 (390 min): 10/11/2026 09:30 local = 03:00Z
    expect(parseStatementDate('10/11/2026 09:30', 'DMY', 390)?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(parseStatementDate('11/10/2026 09:30', 'MDY', 390)?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(parseStatementDate('2026-11-10 09:30', 'DMY', 390)?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(parseStatementDate('2026-11-10T03:00:00Z', 'DMY', 390)?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(parseStatementDate('31/02/2026', 'DMY', 0)).toBeNull();
    expect(parseStatementDate('nope', 'DMY', 0)).toBeNull();
  });
});
