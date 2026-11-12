import { DispatchSettings, licenceInfo, parseLicenceClasses } from '@fms/shared';

/** Pure rules deciding whether a vehicle/driver can take a trip. No I/O. */

export const BLOCKING_VEHICLE_STATUSES = ['UNDER_REPAIR', 'INACTIVE', 'DISPOSED'] as const;

export interface LicenceLike {
  licenseClass: string;
  expiresAt: Date | null;
}

/** "B/E", "ခ, င", "TR" → ['B', 'E'] / ['TR']; see @fms/shared licences. */
export const licenceClasses = parseLicenceClasses;

/** Learner (T) and conductor (CO) permits never allow driving a fleet vehicle. */
const drives = (code: string) => licenceInfo(code)?.drives ?? false;

const label = (code: string) => {
  const i = licenceInfo(code);
  return i ? `${i.myanmar} (${code})` : code;
};

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
  const driving = licences.filter((l) => licenceClasses(l.licenseClass).some(drives));
  if (!driving.length) {
    return { ok: false, reasons: [licences.length ? 'Driver holds only a learner/conductor permit' : 'Driver has no driving licence on record'] };
  }
  const valid = driving.filter((l) => !l.expiresAt || l.expiresAt >= tripEnd);
  if (!valid.length) return { ok: false, reasons: ['Driving licence expires before the trip ends'] };
  if (!vehicleClass || !settings.enforceLicenceClass) return { ok: true, reasons: [] };
  const allowed = settings.licenceRules[vehicleClass] ?? [];
  if (!allowed.length) return { ok: true, reasons: [] };
  const held = new Set(valid.flatMap((l) => licenceClasses(l.licenseClass)).filter(drives));
  return allowed.some((c) => held.has(c))
    ? { ok: true, reasons: [] }
    : {
        ok: false,
        reasons: [
          `A ${vehicleClass.toLowerCase().replace('_', ' ')} requires licence class ${allowed.map(label).join(' or ')} (driver holds ${[...held].map(label).join(', ') || 'none'})`,
        ],
      };
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
