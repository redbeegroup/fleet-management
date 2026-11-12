export type TrainingStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

/** completedAt + months (YYYY-MM-DD in, YYYY-MM-DD out), clamped to the month's last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Status of one driver for one course, from that driver's records of the course.
 * The record with the latest expiry (no expiry = forever) counts.
 */
export function trainingStatus(
  records: { completedAt: string; expiresAt: string | null }[],
  today: string,
  alertDays: number,
): { status: TrainingStatus; expiresAt: string | null; completedAt: string | null } {
  if (!records.length) return { status: 'MISSING', expiresAt: null, completedAt: null };
  const best = [...records].sort((a, b) => (a.expiresAt === null ? 1 : b.expiresAt === null ? -1 : a.expiresAt.localeCompare(b.expiresAt))).at(-1)!;
  if (best.expiresAt === null) return { status: 'VALID', expiresAt: null, completedAt: best.completedAt };
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + alertDays * 86_400_000).toISOString().slice(0, 10);
  const status: TrainingStatus = best.expiresAt < today ? 'EXPIRED' : best.expiresAt <= soon ? 'EXPIRING' : 'VALID';
  return { status, expiresAt: best.expiresAt, completedAt: best.completedAt };
}
