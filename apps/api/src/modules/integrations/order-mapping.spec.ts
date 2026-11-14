import { upsertOrderSchema } from '@fms/shared';
import { orderColumns, payloadHash, stableStringify } from './order-mapping';

const base = {
  customer: { code: 'OUT-1', name: 'Shop 1' },
  lines: [
    { sku: 'A', quantity: 2, weightKg: 10.5, volumeM3: 0.1 },
    { sku: 'B', quantity: 1, weightKg: 4 },
  ],
};

describe('order mapping', () => {
  it('hashes equal payloads equally regardless of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    const a = upsertOrderSchema.parse(base);
    const b = upsertOrderSchema.parse({ lines: base.lines, customer: { name: 'Shop 1', code: 'OUT-1' } });
    expect(payloadHash(a)).toBe(payloadHash(b));
    expect(payloadHash(a)).not.toBe(payloadHash(upsertOrderSchema.parse({ ...base, notes: 'x' })));
  });
  it('totals line weight/volume from the lines that have them', () => {
    const c = orderColumns(upsertOrderSchema.parse(base));
    expect(c).toMatchObject({ totalWeightKg: 14.5, totalVolumeM3: 0.1, priority: 'NORMAL', windowStart: null });
  });
  it('validates the contract', () => {
    expect(upsertOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(upsertOrderSchema.safeParse({ ...base, latitude: 16.8 }).success).toBe(false);
    expect(upsertOrderSchema.safeParse({ ...base, deliveryWindow: { start: '2026-11-15T10:00:00Z', end: '2026-11-15T09:00:00Z' } }).success).toBe(false);
    expect(upsertOrderSchema.safeParse({ ...base, customer: { code: 'bad code!', name: 'x' } }).success).toBe(false);
  });
});
