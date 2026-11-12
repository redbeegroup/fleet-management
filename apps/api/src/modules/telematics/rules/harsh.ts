import type { TelematicsSettings } from '@fms/shared';

/**
 * Harsh-driving detection (pure).
 *
 * Device events (accelerometer, e.g. from Watch Tower in `attributes.event`) win.
 * Otherwise events are computed from consecutive GPS fixes — only when they are
 * close enough in time (`harshMaxGapSeconds`), because a 30-second fix interval
 * cannot distinguish a hard stop from a gentle one.
 */

export type HarshType = 'HARSH_ACCEL' | 'HARSH_BRAKE' | 'HARSH_CORNER';

export interface HarshSample {
  at: Date;
  speedKmh: number | null;
  heading: number | null;
}

export interface HarshDetection {
  type: HarshType;
  /** km/h per second for accel/brake, g for cornering */
  value: number;
  unit: 'km/h/s' | 'g';
  source: 'gps' | 'device';
}

const DEVICE_EVENTS: Record<string, HarshType> = {
  harsh_acceleration: 'HARSH_ACCEL',
  harsh_accel: 'HARSH_ACCEL',
  hard_acceleration: 'HARSH_ACCEL',
  harsh_braking: 'HARSH_BRAKE',
  harsh_brake: 'HARSH_BRAKE',
  hard_braking: 'HARSH_BRAKE',
  harsh_cornering: 'HARSH_CORNER',
  harsh_turn: 'HARSH_CORNER',
  hard_cornering: 'HARSH_CORNER',
};

/** Maps a provider event name (case/space-insensitive) to a harsh type. */
export function deviceHarshEvent(attributes: Record<string, unknown> | undefined | null): HarshType | null {
  const raw = attributes?.event ?? attributes?.alarm;
  if (typeof raw !== 'string') return null;
  return DEVICE_EVENTS[raw.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

/** Smallest absolute difference between two headings, in degrees (0–180). */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function detectHarsh(
  prev: HarshSample | null,
  cur: HarshSample & { attributes?: Record<string, unknown> | null },
  s: Pick<TelematicsSettings, 'harshAccelKmhPerS' | 'harshBrakeKmhPerS' | 'harshCornerG' | 'harshMaxGapSeconds'>,
): HarshDetection[] {
  const device = deviceHarshEvent(cur.attributes);
  if (device) return [{ type: device, value: 0, unit: device === 'HARSH_CORNER' ? 'g' : 'km/h/s', source: 'device' }];
  if (!prev || prev.speedKmh == null || cur.speedKmh == null) return [];
  const dt = (cur.at.getTime() - prev.at.getTime()) / 1000;
  if (dt <= 0 || dt > s.harshMaxGapSeconds) return [];

  const out: HarshDetection[] = [];
  const dv = (cur.speedKmh - prev.speedKmh) / dt; // km/h per second
  if (dv >= s.harshAccelKmhPerS) out.push({ type: 'HARSH_ACCEL', value: round(dv), unit: 'km/h/s', source: 'gps' });
  if (-dv >= s.harshBrakeKmhPerS) out.push({ type: 'HARSH_BRAKE', value: round(-dv), unit: 'km/h/s', source: 'gps' });

  if (prev.heading != null && cur.heading != null) {
    const avgMs = ((prev.speedKmh + cur.speedKmh) / 2) / 3.6;
    // Lateral acceleration a = v·ω; ignore manoeuvres at walking pace (GPS heading is noise there).
    if (avgMs >= 20 / 3.6) {
      const omega = (headingDelta(prev.heading, cur.heading) * Math.PI) / 180 / dt;
      const g = (avgMs * omega) / 9.81;
      if (g >= s.harshCornerG) out.push({ type: 'HARSH_CORNER', value: round(g), unit: 'g', source: 'gps' });
    }
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;
