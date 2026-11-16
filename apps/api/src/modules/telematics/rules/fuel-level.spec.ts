import { diagnosticsSettingsSchema, fuelControlSettingsSchema } from '@fms/shared';
import { diagnosticEvents, EMPTY_FUEL, evaluateFuelLevel, fuelLevelL, readDiagnostics } from './fuel-level';

const s = fuelControlSettingsSchema.parse({});
const run = (levels: { l: number; speed?: number; ign?: boolean }[]) => {
  let st = EMPTY_FUEL;
  const ev: string[] = [];
  levels.forEach((x, i) => {
    const r = evaluateFuelLevel(st, { recordedAt: new Date(1_800_000_000_000 + i * 60_000), latitude: 16.8, longitude: 96.1, speedKmh: x.speed ?? 0, ignition: x.ign ?? false }, x.l, s);
    st = r.state;
    ev.push(...r.opened.map((e) => `${e.type}:${(e.data as { litres: number }).litres}@${i}`));
  });
  return ev;
};

describe('fuel level sensor', () => {
  it('reads litres or percent with aliases', () => {
    expect(fuelLevelL({ fuelLevelL: 42 }, null)).toBe(42);
    expect(fuelLevelL({ fuel_level_pct: '50' }, 120)).toBe(60);
    expect(fuelLevelL({ fuelPercent: 50 }, null)).toBeNull(); // no tank size
    expect(fuelLevelL({ fuelLevelL: -1 }, null)).toBeNull();
    expect(fuelLevelL(null, 100)).toBeNull();
  });

  it('detects a refill once it stops rising and ignores a single spike', () => {
    const flat = Array.from({ length: 4 }, () => ({ l: 30 }));
    const refill = [{ l: 40 }, { l: 55 }, { l: 70 }, { l: 80 }, { l: 80 }, { l: 80 }, { l: 80 }];
    expect(run([...flat, ...refill])).toEqual(['FUEL_REFILL:50@10']);
    // one bad sample of 90 L between 30s is filtered by the median
    expect(run([{ l: 30 }, { l: 30 }, { l: 30 }, { l: 90 }, { l: 30 }, { l: 30 }, { l: 30 }])).toEqual([]);
  });

  it('flags a drop while parked but not consumption while driving', () => {
    const parkedDrop = [{ l: 80 }, { l: 80 }, { l: 80 }, { l: 74 }, { l: 66 }, { l: 60 }, { l: 60 }, { l: 60 }, { l: 60 }];
    expect(run(parkedDrop)).toEqual(['FUEL_DROP:20@8']);
    const driving = parkedDrop.map((x) => ({ ...x, speed: 50, ign: true }));
    expect(run(driving)).toEqual([]);
    expect(run([{ l: 80 }, { l: 80 }, { l: 80 }, { l: 77 }, { l: 75 }, { l: 75 }, { l: 75 }])).toEqual([]); // below 10 L
  });
});

describe('engine diagnostics', () => {
  const d = diagnosticsSettingsSchema.parse({ autoRepairCodes: ['P03'] });
  const fix = { recordedAt: new Date(), latitude: 16.8, longitude: 96.1, speedKmh: 0, ignition: false };
  it('parses codes and values from aliases', () => {
    expect(readDiagnostics({ dtc: 'p0300, P0420;bad' })).toMatchObject({ dtcCodes: ['P0300', 'P0420'] });
    expect(readDiagnostics({ mil: 1, engineTemp: '98', battery: 12.4 })).toMatchObject({ checkEngine: true, coolantTempC: 98, batteryV: 12.4 });
    expect(readDiagnostics({ speed: 3 })).toBeNull();
  });
  it('raises a fault only for new codes and new breaches', () => {
    const a = readDiagnostics({ dtc: ['P0300'], coolantTempC: 110, batteryV: 11 })!;
    const ev = diagnosticEvents(null, a, fix, d).map((e) => e.data);
    expect(ev).toEqual([
      { kind: 'DTC', code: 'P0300', autoRepair: true },
      { kind: 'COOLANT_HOT', value: 110, limit: 105 },
      { kind: 'BATTERY_LOW', value: 11, limit: 11.5 },
    ]);
    expect(diagnosticEvents(a, a, fix, d)).toEqual([]);
    const b = readDiagnostics({ dtc: ['P0300', 'P0171'], coolantTempC: 90 })!;
    expect(diagnosticEvents(a, b, fix, d).map((e) => e.data)).toEqual([{ kind: 'DTC', code: 'P0171', autoRepair: false }]);
    // low battery while the engine runs is ignored
    expect(diagnosticEvents(null, readDiagnostics({ batteryV: 11 })!, { ...fix, ignition: true }, d)).toEqual([]);
  });
});
