import type { DispatchSettings } from '@fms/shared';

/** Pure rules deciding whether a vehicle/driver can take a trip. No I/O. */

export const BLOCKING_VEHICLE_STATUSES = ['UNDER_REPAIR', 'INACTIVE', 'DISPOSED'] as const;

export interface LicenceLike {
  licenseClass: string;
  expiresAt: Date | null;
}

/** "B/E", "B, E" or "BE"-style class strings → ['B', 'E']. */
export function licenceClasses(raw: string): string[] {
  const parts = raw.toUpperCase().split(/[\s,/;|+]+/).filter(Boolean);
  // A single token of several single letters ("BE") is treated as multiple classes.
  return parts.flatMap((p) => (p.length > 1 && /^[A-Z]+$/.test(p) && p.length <= 4 ? p.split('') : [p]));
}

export interface Verdict {
  ok: boolean;
  reasons: string[];
}

/** Licence must be valid until the end of the trip and of an allowed class. */
export function checkLicence(
  vehicleClass: string | null,
  licences: LicenceLike[],
  tripEnd: Date,
  settings: DispatchSettings,
): Verdict {
  const valid = licences.filter((l) => !l.expiresAt || l.expiresAt >= tripEnd);
  if (!licences.length) return { ok: false, reasons: ['Driver has no driving licence on record'] };
  if (!valid.length) return { ok: false, reasons: ['Driving licence expires before the trip ends'] };
  if (!vehicleClass || !settings.enforceLicenceClass) return { ok: true, reasons: [] };
  const allowed = settings.licenceRules[vehicleClass] ?? [];
  if (!allowed.length) return { ok: true, reasons: [] };
  const held = new Set(valid.flatMap((l) => licenceClasses(l.licenseClass)));
  return allowed.some((c) => held.has(c))
    ? { ok: true, reasons: [] }
    : { ok: false, reasons: [`A ${vehicleClass.toLowerCase()} requires licence class ${allowed.join('/')} (driver holds ${[...held].join('/') || 'none'})`] };
}

export interface TripWindowLike {
  id: string;
  tripNo: string;
  status: string;
  plannedStart: Date;
  plannedEnd: Date;
}

/**
 * Does an existing trip block the window [from, to)? Ongoing trips block
 * everything after their start until they are completed, even if they overrun.
 */
export function blocks(t: TripWindowLike, from: Date, to: Date): boolean {
  if (t.status === 'ONGOING') return t.plannedStart < to;
  if (t.status !== 'PLANNED' && t.status !== 'ASSIGNED') return false;
  return t.plannedStart < to && t.plannedEnd > from;
}
