export function daysUntil(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - now.getTime()) / 86_400_000);
}

export function expiryTone(days: number | null): 'ok' | 'warn' | 'danger' | 'muted' {
  if (days === null) return 'muted';
  if (days < 0) return 'danger';
  if (days <= 30) return 'warn';
  return 'ok';
}

export function formatDate(date: string | null): string {
  return date ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export const EVENT_LABELS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'danger' | 'muted' }> = {
  OVERSPEED: { label: 'Overspeed', tone: 'danger' },
  IDLE: { label: 'Idling', tone: 'warn' },
  GEOFENCE_ENTER: { label: 'Entered', tone: 'info' },
  GEOFENCE_EXIT: { label: 'Left', tone: 'info' },
  GPS_OFFLINE: { label: 'GPS offline', tone: 'warn' },
  GPS_RESTORED: { label: 'GPS restored', tone: 'ok' },
  IGNITION_ON: { label: 'Ignition on', tone: 'muted' },
  IGNITION_OFF: { label: 'Ignition off', tone: 'muted' },
  HARSH_BRAKE: { label: 'Harsh braking', tone: 'danger' },
  HARSH_ACCEL: { label: 'Harsh acceleration', tone: 'warn' },
  HARSH_CORNER: { label: 'Harsh cornering', tone: 'warn' },
};

/** One-line description of a telemetry event. */
export function describeEvent(e: { type: string; speedKmh: number | null; data: Record<string, unknown> | null }): string {
  const d = e.data ?? {};
  switch (e.type) {
    case 'OVERSPEED':
      return `${Math.round(Number(d.maxKmh ?? e.speedKmh ?? 0))} km/h (limit ${d.limitKmh})`;
    case 'IDLE':
      return d.durationMin ? `${d.durationMin} min with engine on` : 'engine on, stationary';
    case 'GEOFENCE_ENTER':
    case 'GEOFENCE_EXIT':
      return String(d.geofence ?? '');
    case 'HARSH_BRAKE':
    case 'HARSH_ACCEL':
    case 'HARSH_CORNER':
      return `${d.value} ${d.unit}${d.source === 'device' ? ' (device)' : ''}${e.speedKmh != null ? ` at ${Math.round(e.speedKmh)} km/h` : ''}`;
    case 'GPS_OFFLINE':
      return d.lastFixAt ? `last fix ${new Date(String(d.lastFixAt)).toLocaleString('en-GB')}` : '';
    default:
      return '';
  }
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export const TRIP_TONE: Record<string, 'ok' | 'info' | 'warn' | 'danger' | 'muted'> = {
  PLANNED: 'muted',
  ASSIGNED: 'info',
  ONGOING: 'warn',
  COMPLETED: 'ok',
  CANCELLED: 'danger',
};

/** "12 Nov, 08:30" */
export function formatDateTime(d: string | Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export const FLAG_LABELS: Record<string, string> = {
  ODOMETER_BACKWARDS: 'Odometer went backwards',
  OVER_TANK_CAPACITY: 'More litres than the tank holds',
  LOW_EFFICIENCY: 'Unusually low km/L',
};

export const DUE_TONE = { OK: 'ok', DUE_SOON: 'warn', OVERDUE: 'danger' } as const;
export const WO_TONE = { OPEN: 'muted', IN_PROGRESS: 'warn', COMPLETED: 'ok', CANCELLED: 'danger' } as const;
export const SEVERITY_TONE: Record<string, 'muted' | 'info' | 'warn' | 'danger'> = { LOW: 'muted', MEDIUM: 'info', HIGH: 'warn', CRITICAL: 'danger' };

/** First day of the current month and first day of next month (local). */
export function monthRange(offset = 0): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(from), to: f(to) };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Inclusive local-day range ending today. */
export function lastDays(n: number): { from: string; to: string } {
  const to = new Date();
  return { from: isoDay(new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1))), to: isoDay(to) };
}

export const shortDay = (iso: string) => new Date(`${iso}T00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export const BAND_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = { GOOD: 'ok', FAIR: 'warn', POOR: 'danger', INSUFFICIENT_DATA: 'muted' };
export const INCIDENT_TONE: Record<string, 'warn' | 'info' | 'ok'> = { REPORTED: 'warn', INVESTIGATING: 'info', CLOSED: 'ok' };
export const CLAIM_TONE: Record<string, 'info' | 'ok' | 'danger' | 'muted'> = { SUBMITTED: 'info', APPROVED: 'ok', REJECTED: 'danger', SETTLED: 'muted' };
export const RESULT_TONE: Record<string, 'ok' | 'warn' | 'danger'> = { PASS: 'ok', DEFECTS: 'warn', FAIL: 'danger' };
export const TRAINING_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = { VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'danger', MISSING: 'muted' };
export const ADJ_TONE: Record<string, 'info' | 'ok' | 'danger'> = { PROPOSED: 'info', APPROVED: 'ok', REJECTED: 'danger' };
export const KIND_LABEL: Record<string, string> = { PRE_TRIP: 'Pre-trip', POST_TRIP: 'Post-trip', PERIODIC: 'Periodic' };
