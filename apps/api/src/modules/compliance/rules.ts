/** Country rule packs: required documents per vehicle, and legal payload (pure). */
import type { ComplianceSettings, RequiredDocument } from '@fms/shared';

export type ReqStatus = 'OK' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'UNKNOWN';
export interface DocLike {
  id: string;
  type: string;
  number?: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
}
export interface RequirementState {
  type: string;
  label: string;
  status: ReqStatus;
  validUntil: string | null;
  documentId: string | null;
  blocks: boolean;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};

export function applies(r: RequiredDocument, v: { vehicleClass: string; assetKind: string }) {
  return r.assetKinds.includes(v.assetKind) && (!r.vehicleClasses.length || r.vehicleClasses.includes(v.vehicleClass));
}

/**
 * Status of every requirement that applies to the vehicle. The latest document of the type counts;
 * without an expiry date its validity is the issue date + the usual renewal period.
 */
export function evaluate(v: { vehicleClass: string; assetKind: string }, docs: DocLike[], s: Pick<ComplianceSettings, 'requirements' | 'warnDays' | 'enforceDispatch'>, today: Date): RequirementState[] {
  return s.requirements
    .filter((r) => applies(r, v))
    .map((r) => {
      const mine = docs
        .filter((d) => d.type === r.type)
        .sort((a, b) => (b.expiresAt ?? b.issuedAt ?? new Date(0)).getTime() - (a.expiresAt ?? a.issuedAt ?? new Date(0)).getTime());
      const d = mine[0];
      let status: ReqStatus;
      let until: Date | null = null;
      if (!d) status = 'MISSING';
      else {
        until = d.expiresAt ?? (d.issuedAt && r.renewMonths ? addMonths(d.issuedAt, r.renewMonths) : null);
        if (!until) status = r.renewMonths ? 'UNKNOWN' : 'OK';
        else if (day(until) < day(today)) status = 'EXPIRED';
        else if ((until.getTime() - today.getTime()) / 86_400_000 <= s.warnDays) status = 'EXPIRING';
        else status = 'OK';
      }
      return {
        type: r.type,
        label: r.label,
        status,
        validUntil: until ? day(until) : null,
        documentId: d?.id ?? null,
        blocks: s.enforceDispatch && r.blockDispatch && (status === 'MISSING' || status === 'EXPIRED'),
      };
    });
}

/** Reasons a vehicle (and its trailer) may not be dispatched, or []. */
export function dispatchBlocks(plate: string, states: RequirementState[]): string[] {
  return states.filter((s) => s.blocks).map((s) => `${plate}: ${s.label} ${s.status === 'MISSING' ? 'is missing' : `expired on ${s.validUntil}`}`);
}

/** Payload limit (kg): the smaller of the technical capacity and the legal limit; a trailer adds both. */
export function payloadLimit(
  vehicle: { vehicleClass: string; capacityKg: number | null },
  trailer: { vehicleClass: string; capacityKg: number | null } | null,
  legal: Record<string, number>,
): { kg: number | null; technical: number | null; legal: number | null } {
  // With a trailer the trailer carries the load (a tractor's own payload, if any, is added).
  const technical = trailer ? (trailer.capacityKg == null ? null : (vehicle.capacityKg ?? 0) + trailer.capacityKg) : vehicle.capacityKg;
  const legalV = legal[vehicle.vehicleClass] ?? null;
  const legalT = trailer ? (legal[trailer.vehicleClass] ?? null) : null;
  const legalLimit = trailer ? (legalT == null ? null : (legalV ?? 0) + legalT) : legalV;
  const kg = technical == null ? legalLimit : legalLimit == null ? technical : Math.min(technical, legalLimit);
  return { kg, technical, legal: legalLimit };
}
