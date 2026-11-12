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
