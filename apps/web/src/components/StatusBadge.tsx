import { humanize } from '../lib/format';

const tone: Record<string, string> = {
  AVAILABLE: 'ok',
  ASSIGNED: 'info',
  OPERATING: 'info',
  UNDER_REPAIR: 'warn',
  INACTIVE: 'muted',
  DISPOSED: 'muted',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${tone[status] ?? 'muted'}`}>{humanize(status)}</span>;
}
