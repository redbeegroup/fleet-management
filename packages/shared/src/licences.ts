/**
 * Myanmar driving licence categories (Road Transport Administration Department,
 * rtad.gov.mm). Codes are stored in Latin form; Myanmar letters are accepted as input.
 */
export interface LicenceClassInfo {
  code: string;
  myanmar: string;
  label: string;
  validityYears: number;
  /** False for permits that never allow driving a fleet vehicle (learner, conductor). */
  drives: boolean;
}

export const LICENCE_CLASSES: LicenceClassInfo[] = [
  { code: 'T', myanmar: 'သ', label: 'Learner', validityYears: 1, drives: false },
  { code: 'A', myanmar: 'က', label: 'Motorcycle', validityYears: 5, drives: true },
  { code: 'B', myanmar: 'ခ', label: 'Private vehicle (≤ 3 t, ≤ 15 passengers)', validityYears: 5, drives: true },
  { code: 'C', myanmar: 'ဂ', label: 'Machinery / industrial equipment', validityYears: 5, drives: true },
  { code: 'D', myanmar: 'ဃ', label: 'Taxi & commercial', validityYears: 3, drives: true },
  { code: 'E', myanmar: 'င', label: 'Heavy vehicle (except heavy machinery)', validityYears: 3, drives: true },
  { code: 'TR', myanmar: 'ဌ', label: 'Trawler-gy / tractor', validityYears: 5, drives: true },
  { code: 'TW', myanmar: 'ဟ', label: 'Three-wheeler & motorcycle', validityYears: 5, drives: true },
  { code: 'CO', myanmar: 'စ', label: 'Conductor / assistant', validityYears: 5, drives: false },
];

const BY_CODE = new Map(LICENCE_CLASSES.map((c) => [c.code, c]));
const BY_MYANMAR = new Map(LICENCE_CLASSES.map((c) => [c.myanmar, c]));

export function licenceInfo(code: string): LicenceClassInfo | undefined {
  return BY_CODE.get(code);
}

/** "e", " E ", "င" → "E"; unknown input → null. */
export function normalizeLicenceClass(raw: string): string | null {
  const t = raw.trim();
  return BY_MYANMAR.get(t)?.code ?? BY_CODE.get(t.toUpperCase())?.code ?? null;
}

/**
 * Parses a stored class string that may hold several classes ("B/E", "ခ, င", "TR").
 * Unknown tokens are kept upper-cased so they stay visible but never match a rule.
 */
export function parseLicenceClasses(raw: string): string[] {
  const out = raw
    .split(/[\s,/;|+]+/)
    .filter(Boolean)
    .map((t) => normalizeLicenceClass(t) ?? t.toUpperCase());
  return [...new Set(out)];
}

/** Expiry implied by the category's validity period. */
export function defaultLicenceExpiry(issuedAt: Date, code: string): Date | null {
  const info = BY_CODE.get(code);
  if (!info) return null;
  const d = new Date(issuedAt);
  d.setUTCFullYear(d.getUTCFullYear() + info.validityYears);
  return d;
}

/**
 * Default dispatch rules: company vehicles are commercial, so passenger and light
 * goods vehicles need ဃ (D) or င (E). Editable per company in settings.
 */
export const DEFAULT_LICENCE_RULES: Record<string, string[]> = {
  MOTORCYCLE: ['A', 'B', 'D', 'E', 'TW'],
  THREE_WHEELER: ['TW', 'D', 'E'],
  CAR: ['D', 'E'],
  VAN: ['D', 'E'],
  PICKUP: ['D', 'E'],
  TRUCK: ['E'],
  BUS: ['E'],
  TRAILER: ['E'],
  TRACTOR: ['TR'],
  MACHINERY: ['C'],
  OTHER: ['D', 'E'],
};
