import { complianceSettingsSchema, MYANMAR_PACK } from '@fms/shared';
import { dispatchBlocks, evaluate, payloadLimit } from './rules';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-11-17');
const truck = { vehicleClass: 'TRUCK', assetKind: 'VEHICLE' };

describe('compliance rules', () => {
  const s = complianceSettingsSchema.parse({ enforceDispatch: true });
  it('Myanmar pack applies by class and asset kind', () => {
    expect(evaluate(truck, [], s, today).map((r) => r.type)).toEqual(['REGISTRATION', 'INSURANCE', 'INSPECTION', 'PERMIT']);
    expect(evaluate({ vehicleClass: 'CAR', assetKind: 'VEHICLE' }, [], s, today).map((r) => r.type)).toEqual(['REGISTRATION', 'INSURANCE']);
    expect(evaluate({ vehicleClass: 'TRAILER', assetKind: 'TRAILER' }, [], s, today).map((r) => r.type)).toEqual(['REGISTRATION', 'INSPECTION']);
    expect(evaluate({ vehicleClass: 'MACHINERY', assetKind: 'GENERATOR' }, [], s, today)).toEqual([]);
    expect(MYANMAR_PACK).toHaveLength(4);
  });

  it('latest document; expiry from the date or issue + renewal; expiring window', () => {
    const r = evaluate(
      truck,
      [
        { id: 'r-old', type: 'REGISTRATION', issuedAt: d('2024-01-01'), expiresAt: d('2025-01-01') },
        { id: 'r-new', type: 'REGISTRATION', issuedAt: d('2026-01-01'), expiresAt: d('2026-12-01') },
        { id: 'i', type: 'INSURANCE', issuedAt: d('2025-10-01'), expiresAt: null },
        { id: 'x', type: 'INSPECTION', issuedAt: null, expiresAt: null },
      ],
      s,
      today,
    );
    expect(r.map((x) => [x.type, x.status, x.validUntil, x.blocks])).toEqual([
      ['REGISTRATION', 'EXPIRING', '2026-12-01', false],
      ['INSURANCE', 'EXPIRED', '2026-10-01', true],
      ['INSPECTION', 'UNKNOWN', null, false],
      ['PERMIT', 'MISSING', null, false], // permit does not block in the default pack
    ]);
    expect(dispatchBlocks('YGN-1', r)).toEqual(['YGN-1: Third-party liability insurance expired on 2026-10-01']);
  });

  it('nothing blocks while enforcement is off', () => {
    const off = complianceSettingsSchema.parse({});
    expect(evaluate(truck, [], off, today).some((x) => x.blocks)).toBe(false);
  });

  it('payload: technical vs legal, trailer adds both', () => {
    expect(payloadLimit({ vehicleClass: 'TRUCK', capacityKg: 10000 }, null, {})).toEqual({ kg: 10000, technical: 10000, legal: null });
    expect(payloadLimit({ vehicleClass: 'TRUCK', capacityKg: 10000 }, null, { TRUCK: 8000 })).toEqual({ kg: 8000, technical: 10000, legal: 8000 });
    expect(payloadLimit({ vehicleClass: 'TRACTOR', capacityKg: 0 }, { vehicleClass: 'TRAILER', capacityKg: 30000 }, { TRACTOR: 0, TRAILER: 25000 })).toEqual({ kg: 25000, technical: 30000, legal: 25000 });
    expect(payloadLimit({ vehicleClass: 'TRACTOR', capacityKg: null }, { vehicleClass: 'TRAILER', capacityKg: 30000 }, {})).toEqual({ kg: 30000, technical: 30000, legal: null });
    expect(payloadLimit({ vehicleClass: 'TRACTOR', capacityKg: null }, { vehicleClass: 'TRAILER', capacityKg: null }, { TRAILER: 20000 })).toEqual({ kg: 20000, technical: null, legal: 20000 });
  });
});
