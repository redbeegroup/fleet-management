/** Which warranties still cover a vehicle at a date and odometer, and which fit a repair (pure). */

export interface VehicleWarrantyRow {
  id: string;
  component: string;
  label?: string | null;
  supplierId?: string | null;
  startDate: Date;
  endDate?: Date | null;
  endKm?: number | null;
}
export interface PartFitRow {
  lineId: string;
  woNo: string;
  partId: string;
  partNo: string;
  partName: string;
  fittedAt: Date;
  warrantyUntil?: Date | null;
  warrantyKmUntil?: number | null;
  supplierId?: string | null;
}
export interface TireFitRow {
  changeId: string;
  position: string;
  brand?: string | null;
  fittedAt: Date;
  fitOdometerKm: number;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
  supplierId?: string | null;
}

export interface Coverage {
  basis: 'VEHICLE' | 'PART' | 'TIRE';
  ref: string;
  label: string;
  since: Date;
  until: Date | null;
  untilKm: number | null;
  supplierId: string | null;
  /** The repair text or the part being replaced points at this warranty. */
  relevant: boolean;
}

const KEYWORDS: Record<string, RegExp> = {
  WHOLE_VEHICLE: /./,
  ENGINE: /engine|motor|turbo|injector|cylinder|piston|radiator|cooling/i,
  GEARBOX: /gear ?box|transmission|clutch|differential|axle|drive ?shaft/i,
  BATTERY: /batter/i,
  BODY: /body|paint|door|panel|rust|windscreen|windshield|glass/i,
};
const COMPONENT_LABEL: Record<string, string> = { WHOLE_VEHICLE: 'Vehicle', ENGINE: 'Engine', GEARBOX: 'Gearbox / drivetrain', BATTERY: 'Battery', BODY: 'Body', OTHER: 'Other' };

const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

export function coverage(
  at: Date,
  odometerKm: number,
  data: { warranties: VehicleWarrantyRow[]; parts: PartFitRow[]; tires: TireFitRow[] },
  hint: { text?: string; partIds?: string[]; positions?: string[] } = {},
): Coverage[] {
  const text = hint.text ?? '';
  const out: Coverage[] = [];
  for (const w of data.warranties) {
    if (w.startDate > at) continue;
    if (w.endDate && w.endDate < new Date(at.toISOString().slice(0, 10))) continue;
    if (w.endKm != null && odometerKm > w.endKm) continue;
    const re = KEYWORDS[w.component];
    const relevant = w.component === 'WHOLE_VEHICLE' || (re ? re.test(text) : !!w.label && words(w.label).some((x) => text.toLowerCase().includes(x)));
    out.push({ basis: 'VEHICLE', ref: w.id, label: w.label ? `${COMPONENT_LABEL[w.component] ?? w.component}: ${w.label}` : (COMPONENT_LABEL[w.component] ?? w.component), since: w.startDate, until: w.endDate ?? null, untilKm: w.endKm ?? null, supplierId: w.supplierId ?? null, relevant });
  }
  for (const p of data.parts) {
    if (p.warrantyUntil == null && p.warrantyKmUntil == null) continue;
    if (p.warrantyUntil && p.warrantyUntil < new Date(at.toISOString().slice(0, 10))) continue;
    if (p.warrantyKmUntil != null && odometerKm > p.warrantyKmUntil) continue;
    const relevant = (hint.partIds ?? []).includes(p.partId) || words(p.partName).some((x) => text.toLowerCase().includes(x));
    out.push({ basis: 'PART', ref: p.lineId, label: `${p.partName} (${p.partNo}), fitted on ${p.woNo}`, since: p.fittedAt, until: p.warrantyUntil ?? null, untilKm: p.warrantyKmUntil ?? null, supplierId: p.supplierId ?? null, relevant });
  }
  for (const t of data.tires) {
    if (t.warrantyMonths == null && t.warrantyKm == null) continue;
    const until = t.warrantyMonths != null ? addMonths(t.fittedAt, t.warrantyMonths) : null;
    const untilKm = t.warrantyKm != null ? t.fitOdometerKm + t.warrantyKm : null;
    if (until && until < at) continue;
    if (untilKm != null && odometerKm > untilKm) continue;
    const relevant = (hint.positions ?? []).includes(t.position) || /tire|tyre|puncture|wheel/i.test(text);
    out.push({ basis: 'TIRE', ref: t.changeId, label: `Tire ${t.position}${t.brand ? ` (${t.brand})` : ''}`, since: t.fittedAt, until, untilKm, supplierId: t.supplierId ?? null, relevant });
  }
  // Relevant first, then the ones ending soonest.
  return out.sort((a, b) => Number(b.relevant) - Number(a.relevant) || (a.until?.getTime() ?? Infinity) - (b.until?.getTime() ?? Infinity));
}

/** Warranty end of a fitted part from its catalogue terms. */
export function partWarrantyEnd(fittedAt: Date, odometerKm: number | null, months?: number | null, km?: number | null) {
  return {
    warrantyUntil: months ? addMonths(fittedAt, months) : null,
    warrantyKmUntil: km && odometerKm != null ? odometerKm + km : null,
  };
}

/** Allowed claim transitions. */
export const CLAIM_FLOW: Record<string, Record<string, string>> = {
  DRAFT: { SUBMIT: 'SUBMITTED', EDIT: 'DRAFT' },
  SUBMITTED: { APPROVE: 'APPROVED', REJECT: 'REJECTED', EDIT: 'SUBMITTED' },
  APPROVED: { RECOVER: 'RECOVERED', EDIT: 'APPROVED' },
  REJECTED: { EDIT: 'REJECTED' },
  RECOVERED: {},
};
