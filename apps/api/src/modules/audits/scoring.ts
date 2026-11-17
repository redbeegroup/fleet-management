/** Safety audit scoring (pure). */
import type { AuditQuestion } from '@fms/shared';

export interface Answer {
  key: string;
  result: 'PASS' | 'FAIL' | 'NA';
  note?: string | null;
  photoFileId?: string | null;
}

/**
 * Score = passed weight / applicable weight (NA excluded). A failed critical item fails the
 * audit whatever the score; below the pass mark it needs action.
 */
export function scoreAudit(questions: AuditQuestion[], answers: Answer[], passMark: number) {
  const errors: string[] = [];
  const by = new Map(answers.map((a) => [a.key, a]));
  for (const a of answers) if (!questions.some((q) => q.key === a.key)) errors.push(`${a.key}: not in this audit`);
  const items = questions.map((q) => {
    const a = by.get(q.key);
    if (!a) errors.push(`${q.key}: not answered`);
    else if (a.result === 'FAIL' && !a.note?.trim() && !a.photoFileId) errors.push(`${q.key}: describe the finding or add a photo`);
    return { ...q, result: a?.result ?? 'NA', note: a?.note?.trim() || null, photoFileId: a?.photoFileId ?? null };
  });
  if (errors.length) return { errors };
  const applicable = items.filter((i) => i.result !== 'NA');
  const total = applicable.reduce((s, i) => s + i.weight, 0);
  const passed = applicable.filter((i) => i.result === 'PASS').reduce((s, i) => s + i.weight, 0);
  const score = total ? Math.round((passed / total) * 1000) / 10 : 100;
  const criticalFailed = items.filter((i) => i.critical && i.result === 'FAIL');
  const result = criticalFailed.length ? 'FAIL' : score < passMark ? 'NEEDS_ACTION' : 'PASS';
  return { items, score, result: result as 'PASS' | 'NEEDS_ACTION' | 'FAIL', findings: items.filter((i) => i.result === 'FAIL') };
}

/** Starter templates created on first use (editable). */
export const DEFAULT_AUDITS: { name: string; target: 'BRANCH' | 'VEHICLE'; questions: AuditQuestion[] }[] = [
  {
    name: 'Depot safety audit',
    target: 'BRANCH',
    questions: [
      { key: 'fire_extinguishers', section: 'Fire & emergency', label: 'Fire extinguishers present, charged and inspected', weight: 3, critical: true },
      { key: 'emergency_exits', section: 'Fire & emergency', label: 'Emergency exits marked and unobstructed', weight: 3, critical: true },
      { key: 'first_aid', section: 'Fire & emergency', label: 'First-aid kit complete and in date', weight: 2, critical: false },
      { key: 'emergency_contacts', section: 'Fire & emergency', label: 'Emergency contacts and assembly point posted', weight: 1, critical: false },
      { key: 'fuel_storage', section: 'Hazards', label: 'Fuel / oil stored in bunded area, no leaks', weight: 3, critical: false },
      { key: 'spill_kit', section: 'Hazards', label: 'Spill kit available', weight: 1, critical: false },
      { key: 'electrical', section: 'Hazards', label: 'No exposed wiring or overloaded sockets', weight: 2, critical: false },
      { key: 'housekeeping', section: 'Yard & workshop', label: 'Yard and workshop clean, walkways clear', weight: 1, critical: false },
      { key: 'traffic', section: 'Yard & workshop', label: 'Yard traffic routes, speed limit and reversing rules marked', weight: 2, critical: false },
      { key: 'lifting', section: 'Yard & workshop', label: 'Jacks, stands and lifting gear inspected', weight: 2, critical: false },
      { key: 'ppe', section: 'People', label: 'PPE (vests, safety shoes, gloves) worn', weight: 2, critical: false },
      { key: 'training_records', section: 'People', label: 'Driver and forklift training records up to date', weight: 1, critical: false },
    ],
  },
  {
    name: 'Vehicle safety audit',
    target: 'VEHICLE',
    questions: [
      { key: 'brakes', section: 'Safety equipment', label: 'Brakes and parking brake effective', weight: 3, critical: true },
      { key: 'tires', section: 'Safety equipment', label: 'Tires: tread, pressure, no damage', weight: 3, critical: true },
      { key: 'lights', section: 'Safety equipment', label: 'Lights, indicators, reflectors working and clean', weight: 2, critical: false },
      { key: 'seatbelts', section: 'Safety equipment', label: 'Seat belts working', weight: 2, critical: true },
      { key: 'extinguisher', section: 'Safety equipment', label: 'Fire extinguisher and warning triangle on board', weight: 2, critical: false },
      { key: 'load_securing', section: 'Load', label: 'Load securing equipment (straps, nets) in good condition', weight: 2, critical: false },
      { key: 'documents', section: 'Documents', label: 'Registration, insurance and permit on board', weight: 1, critical: false },
      { key: 'cleanliness', section: 'General', label: 'Cab clean, no loose objects', weight: 1, critical: false },
    ],
  },
];
