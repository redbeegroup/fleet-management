import { podSettingsSchema } from '@fms/shared';
import { expectedReturns, reconcile } from './checkin';
import { fillRate, onTime, orderKpis, sequenceAdherence, tripCost } from './kpis';
import { evaluatePod } from './pod';

const settings = podSettingsSchema.parse({});
const ctx = { stopLat: 16.8, stopLng: 96.15, codExpected: 50_000, settings };

describe('proof of delivery', () => {
  it('requires a photo and the cash collected for a delivery, nothing for a failure', () => {
    expect(evaluatePod({ outcome: 'DELIVERED', photoFileIds: [] }, ctx).errors).toEqual(['Take at least one photo of the delivery', 'Enter the cash collected']);
    expect(evaluatePod({ outcome: 'FAILED', photoFileIds: [] }, ctx).errors).toEqual([]);
    const sig = evaluatePod({ outcome: 'PARTIAL', photoFileIds: ['p'], codCollected: 1 }, { ...ctx, settings: { ...settings, requireSignature: true } });
    expect(sig.errors).toEqual(["Get the recipient's signature"]);
  });
  it('flags distance, missing GPS and cash differences', () => {
    const near = evaluatePod({ outcome: 'DELIVERED', photoFileIds: ['p'], latitude: 16.801, longitude: 96.15, codCollected: 50_000 }, ctx);
    expect(near).toMatchObject({ errors: [], flags: [], distanceM: 111 });
    const far = evaluatePod({ outcome: 'DELIVERED', photoFileIds: ['p'], latitude: 16.81, longitude: 96.15, codCollected: 40_000 }, ctx);
    expect(far.flags).toEqual(['FAR_FROM_CUSTOMER', 'COD_SHORT']);
    expect(evaluatePod({ outcome: 'DELIVERED', photoFileIds: ['p'], codCollected: 60_000 }, ctx).flags).toEqual(['NO_GPS', 'COD_OVER']);
  });
});

describe('warehouse check-in', () => {
  const orders = [
    { id: 'o1', externalRef: 'SO-1', status: 'PARTIAL', lines: [{ lineNo: 1, sku: 'A', description: null, uom: 'CTN', quantity: 10, deliveredQty: 6 }, { lineNo: 2, sku: 'B', description: null, uom: 'EA', quantity: 2, deliveredQty: 2 }] },
    { id: 'o2', externalRef: 'SO-2', status: 'FAILED', lines: [{ lineNo: 1, sku: 'C', description: null, uom: 'BAG', quantity: 5, deliveredQty: 0 }] },
    { id: 'o3', externalRef: 'SO-3', status: 'DELIVERED', lines: [{ lineNo: 1, sku: 'D', description: null, uom: 'EA', quantity: 1, deliveredQty: 1 }] },
  ];
  const returns = [{ id: 'r1', sku: 'E', description: 'Damaged', uom: 'EA', quantity: 3, reason: 'Damaged' }];
  it('lists undelivered quantities and customer returns', () => {
    expect(expectedReturns(orders, returns).map((e) => [e.key, e.expectedQty])).toEqual([
      ['order:o1:1', 4],
      ['order:o2:1', 5],
      ['return:r1', 3],
    ]);
  });
  it('reconciles counts and cash', () => {
    const exp = expectedReturns(orders, returns);
    const r = reconcile(exp, [{ key: 'order:o1:1', receivedQty: 4 }, { key: 'order:o2:1', receivedQty: 4 }, { key: 'return:r1', receivedQty: 4 }, { key: 'x', receivedQty: 1 }], 100_000, 99_000);
    expect(r).toMatchObject({ shortages: 1, overages: 1, cashDiff: -1000, ok: false, unknownKeys: ['x'] });
    expect(reconcile(exp, exp.map((e) => ({ key: e.key, receivedQty: e.expectedQty })), 10, 10).ok).toBe(true);
    expect(reconcile(exp, [], 0, null).shortages).toBe(3); // nothing counted = all short
  });
});

describe('delivery KPIs', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 16, h));
  const base = { completedLocalDay: '2026-11-16', deliveryDate: '2026-11-16', windowStart: t(2), windowEnd: t(6), failureReason: null };
  it('computes success, in-full, on-time and OTIF', () => {
    const k = orderKpis([
      { ...base, status: 'DELIVERED', completedAt: t(3) }, // OTIF
      { ...base, status: 'DELIVERED', completedAt: t(8) }, // late
      { ...base, status: 'PARTIAL', completedAt: t(4) }, // on time, not in full
      { ...base, status: 'FAILED', completedAt: t(5), failureReason: 'Customer closed' },
      { ...base, status: 'PLANNED', completedAt: null },
    ]);
    expect(k).toMatchObject({ attempted: 4, delivered: 2, partial: 1, failed: 1, successRatePct: 75, inFullRatePct: 50, onTimeRatePct: 50, otif: 1, otifPct: 25, failureReasons: { 'Customer closed': 1 } });
    expect(onTime({ ...base, windowStart: null, windowEnd: null, status: 'DELIVERED', completedAt: t(20), completedLocalDay: '2026-11-17' })).toBe(false);
  });
  it('measures sequence adherence, fill rate and cost', () => {
    expect(sequenceAdherence([1, 2, 3, 4])).toBe(100);
    expect(sequenceAdherence([2, 1, 3, 4])).toBe(75);
    expect(sequenceAdherence([])).toBeNull();
    expect(fillRate({ kg: 900, m3: 2 }, { kg: 1000, m3: 8, cases: null })).toEqual({ pct: 90, byLimit: { kg: 90, m3: 25 } });
    expect(tripCost({ expenses: 5000, km: 40, fuelCostPerKm: 250, driverCostPerDay: 20_000 })).toBe(35_000);
  });
});
