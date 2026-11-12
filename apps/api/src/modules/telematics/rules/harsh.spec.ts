import { telematicsSettingsSchema } from '@fms/shared';
import { detectHarsh, deviceHarshEvent, headingDelta } from './harsh';

const s = telematicsSettingsSchema.parse({});
const t0 = new Date('2026-01-01T08:00:00Z');
const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
const sample = (sec: number, speedKmh: number | null, heading: number | null = 0) => ({ at: at(sec), speedKmh, heading });

describe('harsh driving', () => {
  it('detects harsh braking and acceleration from close fixes', () => {
    expect(detectHarsh(sample(0, 60), sample(4, 0), s)).toEqual([{ type: 'HARSH_BRAKE', value: 15, unit: 'km/h/s', source: 'gps' }]);
    expect(detectHarsh(sample(0, 0), sample(3, 36), s)[0]).toMatchObject({ type: 'HARSH_ACCEL', value: 12 });
  });

  it('ignores normal driving', () => {
    expect(detectHarsh(sample(0, 60), sample(10, 30), s)).toEqual([]); // 3 km/h/s
  });

  it('skips sparse fixes (gap > harshMaxGapSeconds)', () => {
    expect(detectHarsh(sample(0, 80), sample(30, 0), s)).toEqual([]);
  });

  it('detects harsh cornering via lateral g and ignores slow turns', () => {
    // 50 km/h, 90° turn in 3 s → v·ω = 13.9 m/s × 0.52 rad/s ≈ 0.74 g
    expect(detectHarsh(sample(0, 50, 0), sample(3, 50, 90), s)[0]).toMatchObject({ type: 'HARSH_CORNER', unit: 'g' });
    expect(detectHarsh(sample(0, 10, 0), sample(3, 10, 90), s)).toEqual([]);
    expect(detectHarsh(sample(0, 50, 350), sample(3, 50, 10), s)).toEqual([]); // 20° across north
  });

  it('prefers device events and normalises their names', () => {
    expect(deviceHarshEvent({ event: 'Harsh Braking' })).toBe('HARSH_BRAKE');
    expect(deviceHarshEvent({ alarm: 'hard-acceleration' })).toBe('HARSH_ACCEL');
    expect(deviceHarshEvent({ event: 'ignitionOn' })).toBeNull();
    const r = detectHarsh(null, { ...sample(0, 50), attributes: { event: 'harsh_cornering' } }, s);
    expect(r).toEqual([{ type: 'HARSH_CORNER', value: 0, unit: 'g', source: 'device' }]);
  });

  it('computes heading deltas across north', () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(90, 270)).toBe(180);
  });
});
