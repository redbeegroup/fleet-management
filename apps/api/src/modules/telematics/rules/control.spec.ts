import { controlSettingsSchema } from '@fms/shared';
import { distanceToRouteM, EMPTY_CONTROL, evaluateControl, ControlContext, ControlState, withinWorkingHours } from './control';

const settings = controlSettingsSchema.parse({ workingHoursEnabled: true, requireDriverOnDuty: true, movementWithoutTrip: true });
const route = [
  { lat: 16.8, lng: 96.1 },
  { lat: 16.8, lng: 96.2 },
];
// Monday 2026-11-16 10:00 Yangon = 03:30Z
const t = (min: number) => new Date(Date.parse('2026-11-16T03:30:00Z') + min * 60_000);
const ctx = (over: Partial<ControlContext> = {}): ControlContext => ({
  settings,
  timezone: 'Asia/Yangon',
  trip: { id: 'trip', tripNo: 'T1', route },
  driverId: 'drv',
  driverOnDuty: true,
  enteredRestricted: [],
  ...over,
});
function drive(fixes: { min: number; lat: number; lng: number; speed?: number; ignition?: boolean }[], c: ControlContext | ((i: number) => ControlContext), start: ControlState = EMPTY_CONTROL) {
  let s = start;
  const opened: string[] = [];
  const closed: string[] = [];
  fixes.forEach((f, i) => {
    const r = evaluateControl(s, { recordedAt: t(f.min), latitude: f.lat, longitude: f.lng, speedKmh: f.speed ?? 40, ignition: f.ignition ?? true }, typeof c === 'function' ? c(i) : c);
    s = r.state;
    opened.push(...r.opened.map((e) => `${e.type}@${f.min}`));
    closed.push(...r.closed.map(() => `close@${f.min}`));
  });
  return { s, opened, closed };
}

describe('control rules', () => {
  it('measures distance to a route', () => {
    expect(distanceToRouteM(16.8, 96.15, route)).toBeLessThan(1);
    expect(distanceToRouteM(16.81, 96.15, route)).toBeCloseTo(1113, -1);
    expect(distanceToRouteM(16.8, 96.25, route)).toBeGreaterThan(5000); // beyond the end
  });

  it('opens off-route after the delay and closes when back', () => {
    const off = { lat: 16.81, lng: 96.15 };
    const r = drive(
      [
        { min: 0, lat: 16.8, lng: 96.12 },
        { min: 1, ...off },
        { min: 4, ...off },
        { min: 6, ...off },
        { min: 9, ...off },
        { min: 10, lat: 16.8, lng: 96.16 },
      ],
      ctx(),
    );
    expect(r.opened).toEqual(['OFF_ROUTE@6']);
    expect(r.closed).toEqual(['close@10']);
    // A short detour under the delay does not alert
    expect(drive([{ min: 0, ...off }, { min: 3, lat: 16.8, lng: 96.15 }], ctx()).opened).toEqual([]);
    // No route (straight-line planned trip) → no off-route
    expect(drive([{ min: 0, ...off }, { min: 10, ...off }], ctx({ trip: { id: 'x', tripNo: 'x', route: null } })).opened).toEqual([]);
  });

  it('flags movement without a trip after the km threshold and closes when parked', () => {
    const r = drive(
      [
        { min: 0, lat: 16.8, lng: 96.1 },
        { min: 1, lat: 16.8, lng: 96.105 }, // ~0.53 km
        { min: 2, lat: 16.8, lng: 96.11 }, // ~1.07 km
        { min: 3, lat: 16.8, lng: 96.115 },
        { min: 4, lat: 16.8, lng: 96.115, speed: 0, ignition: false },
      ],
      ctx({ trip: null }),
    );
    expect(r.opened).toEqual(['UNAUTHORISED_MOVEMENT@2']);
    expect(r.closed).toEqual(['close@4']);
    expect(r.s.noTripKm).toBeNull();
    // Ignition off resets the counter: two short moves don't add up
    const r2 = drive(
      [
        { min: 0, lat: 16.8, lng: 96.1 },
        { min: 1, lat: 16.8, lng: 96.106 },
        { min: 2, lat: 16.8, lng: 96.106, speed: 0, ignition: false },
        { min: 3, lat: 16.8, lng: 96.112 },
      ],
      ctx({ trip: null }),
    );
    expect(r2.opened).toEqual([]);
  });

  it('applies working hours in the company time zone, including overnight shifts', () => {
    const hours = settings.workingHours; // Mon–Fri 06–20, Sat 06–14, Sun closed
    expect(withinWorkingHours(new Date('2026-11-16T03:30:00Z'), 'Asia/Yangon', hours)).toBe(true); // Mon 10:00
    expect(withinWorkingHours(new Date('2026-11-16T14:00:00Z'), 'Asia/Yangon', hours)).toBe(false); // Mon 20:30
    expect(withinWorkingHours(new Date('2026-11-15T03:30:00Z'), 'Asia/Yangon', hours)).toBe(false); // Sun
    const night = [null, { start: '22:00', end: '06:00' }, null, null, null, null, null];
    expect(withinWorkingHours(new Date('2026-11-16T16:00:00Z'), 'Asia/Yangon', night)).toBe(true); // Mon 22:30
    expect(withinWorkingHours(new Date('2026-11-16T20:30:00Z'), 'Asia/Yangon', night)).toBe(true); // Tue 03:00 (Monday's shift)
    expect(withinWorkingHours(new Date('2026-11-17T03:30:00Z'), 'Asia/Yangon', night)).toBe(false); // Tue 10:00
    // Sunday drive → AFTER_HOURS once, closed when parked
    const sun = (m: number) => Date.parse('2026-11-15T03:30:00Z') + m * 60_000;
    let s = EMPTY_CONTROL;
    const types: string[] = [];
    for (const [m, speed, ign] of [[0, 40, true], [5, 40, true], [9, 0, false]] as const) {
      const r = evaluateControl(s, { recordedAt: new Date(sun(m)), latitude: 16.8, longitude: 96.1 + m / 1000, speedKmh: speed, ignition: ign }, ctx());
      s = r.state;
      types.push(...r.opened.map((e) => e.type), ...r.closed.map(() => 'close'));
    }
    expect(types).toEqual(['AFTER_HOURS', 'close']);
  });

  it('flags driving without a driver on duty and restricted areas', () => {
    const r = drive([{ min: 0, lat: 16.8, lng: 96.12 }, { min: 1, lat: 16.8, lng: 96.13 }], ctx({ driverOnDuty: false }));
    expect(r.opened).toEqual(['NO_DRIVER@0']);
    expect(drive([{ min: 0, lat: 16.8, lng: 96.12 }], ctx({ driverId: null, driverOnDuty: false })).opened).toEqual(['NO_DRIVER@0']);
    expect(drive([{ min: 0, lat: 16.8, lng: 96.12, speed: 0 }], ctx({ driverOnDuty: false })).opened).toEqual([]);
    const g = drive([{ min: 0, lat: 16.8, lng: 96.12 }], ctx({ enteredRestricted: [{ id: 'g', name: 'Port' }] }));
    expect(g.opened).toEqual(['RESTRICTED_AREA@0']);
    // Disabled rules stay quiet
    const off = controlSettingsSchema.parse({ offRouteEnabled: false, movementWithoutTrip: false, restrictedAreaAlerts: false });
    expect(drive([{ min: 0, lat: 16.9, lng: 96.1 }, { min: 30, lat: 16.95, lng: 96.1 }], ctx({ settings: off, trip: null, enteredRestricted: [{ id: 'g', name: 'Port' }] })).opened).toEqual([]);
  });
});
