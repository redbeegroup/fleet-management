import { telematicsSettingsSchema } from '@fms/shared';
import { haversineM, pointInPolygon, trackDistanceKm } from './geo';
import { EMPTY_STATE, evaluate, evaluateOffline, Fence, RuleContext, RuleFix, RuleState } from './rules-engine';

const settings = telematicsSettingsSchema.parse({ speedLimitKmh: 60, idleMinutes: 10, offlineMinutes: 30 });
// Rule tests use 1-minute fixes, so computed harsh events never fire here (gap > harshMaxGapSeconds).
const yard: Fence = { id: 'yard', name: 'Yard', shape: 'CIRCLE', centerLat: 16.8, centerLng: 96.15, radiusM: 500, alertOnEnter: true, alertOnExit: false };
const ctx: RuleContext = { settings, speedLimitKmh: 60, geofences: [yard] };
const t0 = new Date('2026-01-01T08:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

function run(fixes: (Partial<RuleFix> & { min: number })[], start: RuleState = EMPTY_STATE) {
  let state = start;
  const opened = [];
  const closed = [];
  for (const f of fixes) {
    const r = evaluate(state, { latitude: 16.9, longitude: 96.2, speedKmh: 30, ignition: true, ...f, recordedAt: at(f.min) }, ctx);
    state = r.state;
    opened.push(...r.opened);
    closed.push(...r.closed);
  }
  return { state, opened, closed };
}

describe('geo', () => {
  it('computes distances', () => {
    expect(haversineM(16.8, 96.15, 16.8, 96.15)).toBe(0);
    expect(haversineM(0, 0, 0, 1) / 1000).toBeCloseTo(111.2, 0);
  });
  it('tests points in polygons', () => {
    const sq: [number, number][] = [[96, 16], [97, 16], [97, 17], [96, 17]];
    expect(pointInPolygon(16.5, 96.5, sq)).toBe(true);
    expect(pointInPolygon(17.5, 96.5, sq)).toBe(false);
  });
  it('drops implausible GPS jumps from track distance', () => {
    const pts = [
      { latitude: 16.8, longitude: 96.15, recordedAt: at(0) },
      { latitude: 16.81, longitude: 96.15, recordedAt: at(1) }, // ~1.1 km in 1 min (67 km/h)
      { latitude: 17.8, longitude: 96.15, recordedAt: at(2) }, // 110 km in 1 min: jump
    ];
    expect(trackDistanceKm(pts)).toBeCloseTo(1.11, 1);
  });
});

describe('rules engine', () => {
  it('does not emit geofence events on the first fix', () => {
    const r = run([{ min: 0, latitude: 16.8, longitude: 96.15 }]);
    expect(r.opened).toHaveLength(0);
    expect(r.state.insideGeofenceIds).toEqual(['yard']);
  });

  it('emits enter/exit with the fence alert flags', () => {
    const r = run([{ min: 0 }, { min: 1, latitude: 16.8, longitude: 96.15 }, { min: 2 }]);
    expect(r.opened.map((e) => [e.type, e.notify])).toEqual([
      ['GEOFENCE_ENTER', true],
      ['GEOFENCE_EXIT', false],
    ]);
  });

  it('opens one overspeed episode and closes it below limit minus hysteresis', () => {
    const r = run([{ min: 0, speedKmh: 50 }, { min: 1, speedKmh: 70 }, { min: 2, speedKmh: 90 }, { min: 3, speedKmh: 58 }, { min: 4, speedKmh: 54 }]);
    const os = r.opened.filter((e) => e.type === 'OVERSPEED');
    expect(os).toHaveLength(1);
    expect(r.closed).toEqual([{ id: os[0].id, endedAt: at(4), data: { limitKmh: 60, maxKmh: 90 } }]);
    expect(r.state.overspeedEventId).toBeNull();
  });

  it('flags idling after the threshold and closes it when moving', () => {
    const r = run([{ min: 0, speedKmh: 0 }, { min: 5, speedKmh: 0 }, { min: 11, speedKmh: 1 }, { min: 15, speedKmh: 0 }, { min: 20, speedKmh: 25 }]);
    const idle = r.opened.filter((e) => e.type === 'IDLE');
    expect(idle).toHaveLength(1);
    expect(idle[0].occurredAt).toEqual(at(0));
    expect(r.closed).toEqual([{ id: idle[0].id, endedAt: at(20), data: { durationMin: 20 } }]);
  });

  it('does not count engine-off stops as idling', () => {
    const r = run([{ min: 0, speedKmh: 0, ignition: false }, { min: 30, speedKmh: 0, ignition: false }]);
    expect(r.opened.filter((e) => e.type === 'IDLE')).toHaveLength(0);
  });

  it('records ignition changes', () => {
    const r = run([{ min: 0, ignition: false }, { min: 1, ignition: true }, { min: 2, ignition: false }]);
    expect(r.opened.map((e) => e.type)).toEqual(['IGNITION_ON', 'IGNITION_OFF']);
  });

  it('ignores out-of-order fixes', () => {
    const r1 = run([{ min: 5 }]);
    const r2 = evaluate(r1.state, { recordedAt: at(1), latitude: 0, longitude: 0, speedKmh: 200 }, ctx);
    expect(r2.opened).toHaveLength(0);
    expect(r2.state).toBe(r1.state);
  });

  it('opens GPS_OFFLINE once and closes it with GPS_RESTORED', () => {
    const r1 = run([{ min: 0 }]);
    expect(evaluateOffline(r1.state, at(20), settings).opened).toHaveLength(0);
    const off = evaluateOffline(r1.state, at(45), settings);
    expect(off.opened[0].type).toBe('GPS_OFFLINE');
    expect(evaluateOffline(off.state, at(90), settings).opened).toHaveLength(0);
    const back = run([{ min: 50 }], off.state);
    expect(back.closed[0].id).toBe(off.opened[0].id);
    expect(back.opened.map((e) => e.type)).toContain('GPS_RESTORED');
  });

  it('emits harsh braking between close fixes and carries speed/heading in state', () => {
    const r1 = evaluate(EMPTY_STATE, { recordedAt: t0, latitude: 16.9, longitude: 96.2, speedKmh: 70, heading: 0, ignition: true }, ctx);
    expect(r1.state).toMatchObject({ lastSpeedKmh: 70, lastHeading: 0 });
    const r2 = evaluate(r1.state, { recordedAt: new Date(t0.getTime() + 4000), latitude: 16.9, longitude: 96.2, speedKmh: 10, heading: 0, ignition: true }, ctx);
    const harsh = r2.opened.find((e) => e.type === 'HARSH_BRAKE');
    expect(harsh).toMatchObject({ notify: false, data: { value: 15, unit: 'km/h/s', source: 'gps' } });
  });
});
