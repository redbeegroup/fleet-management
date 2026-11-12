import type { ChecklistItem, InspectionAnswer } from '@fms/shared';

export interface EvaluatedItem extends ChecklistItem {
  ok: boolean;
  note: string | null;
  photoFileId: string | null;
}

export interface Evaluation {
  items: EvaluatedItem[];
  defects: number;
  criticalDefects: number;
  result: 'PASS' | 'DEFECTS' | 'FAIL';
}

/**
 * Checks the answers against the checklist: every item answered exactly once, no unknown
 * items, and a note or photo for every defect. A failed critical item fails the inspection.
 * Returns problems instead of throwing so the caller can map them to a 400.
 */
export function evaluateInspection(checklist: ChecklistItem[], answers: InspectionAnswer[]): Evaluation | { errors: string[] } {
  const errors: string[] = [];
  const byKey = new Map<string, InspectionAnswer>();
  for (const a of answers) {
    if (byKey.has(a.key)) errors.push(`${a.key}: answered twice`);
    byKey.set(a.key, a);
  }
  const known = new Set(checklist.map((i) => i.key));
  for (const k of byKey.keys()) if (!known.has(k)) errors.push(`${k}: not on this checklist`);
  const items: EvaluatedItem[] = [];
  for (const item of checklist) {
    const a = byKey.get(item.key);
    if (!a) {
      errors.push(`${item.key}: not answered`);
      continue;
    }
    if (!a.ok && !a.note?.trim() && !a.photoFileId) errors.push(`${item.key}: describe the defect or add a photo`);
    items.push({ ...item, ok: a.ok, note: a.note?.trim() || null, photoFileId: a.photoFileId ?? null });
  }
  if (errors.length) return { errors };
  const failed = items.filter((i) => !i.ok);
  const criticalDefects = failed.filter((i) => i.critical).length;
  return {
    items,
    defects: failed.length,
    criticalDefects,
    result: criticalDefects ? 'FAIL' : failed.length ? 'DEFECTS' : 'PASS',
  };
}

/**
 * Pre-trip gate: why a trip may not start, or null. `latest` is the most recent
 * pre-trip inspection of the vehicle.
 */
export function preTripBlock(
  latest: { performedAt: Date; result: string; inspectionNo: string } | null,
  now: Date,
  validHours: number,
): string | null {
  if (!latest || now.getTime() - latest.performedAt.getTime() > validHours * 3_600_000) {
    return `A pre-trip inspection of this vehicle is required (valid for ${validHours} h)`;
  }
  if (latest.result === 'FAIL') return `Pre-trip inspection ${latest.inspectionNo} failed — the vehicle must be repaired and re-inspected`;
  return null;
}

/** Default checklists created for a company on first use. */
export const DEFAULT_TEMPLATES: { name: string; kind: 'PRE_TRIP' | 'POST_TRIP'; items: ChecklistItem[] }[] = [
  {
    name: 'Daily pre-trip check',
    kind: 'PRE_TRIP',
    items: [
      { key: 'brakes', label: 'Brakes and parking brake work', critical: true },
      { key: 'tyres', label: 'Tyres: pressure, tread, no damage', critical: true },
      { key: 'steering', label: 'Steering — no excessive play', critical: true },
      { key: 'lights', label: 'Head, brake, indicator and hazard lights', critical: true },
      { key: 'horn_wipers', label: 'Horn, wipers and washer', critical: false },
      { key: 'mirrors_glass', label: 'Mirrors and windscreen clean, not cracked', critical: false },
      { key: 'fluids', label: 'Engine oil, coolant, brake fluid levels; no leaks', critical: false },
      { key: 'seatbelts', label: 'Seat belts work', critical: true },
      { key: 'safety_kit', label: 'Fire extinguisher, warning triangle, first-aid kit', critical: false },
      { key: 'documents', label: 'Registration, insurance and permits on board', critical: false },
      { key: 'body_load', label: 'Body, doors and load secured', critical: false },
    ],
  },
  {
    name: 'End-of-trip check',
    kind: 'POST_TRIP',
    items: [
      { key: 'damage', label: 'No new body damage', critical: false },
      { key: 'warning_lights', label: 'No warning lights on the dashboard', critical: true },
      { key: 'tyres', label: 'Tyres undamaged', critical: false },
      { key: 'leaks', label: 'No fluid leaks under the vehicle', critical: false },
      { key: 'clean_secure', label: 'Cabin clean, vehicle locked, keys returned', critical: false },
    ],
  },
];
