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
