export type StopOutcome = 'DELIVERED' | 'PARTIAL' | 'FAILED';

/** Order status after its stop is resolved; a PARTIAL stop may still deliver some orders in full. */
export function orderOutcome(stop: StopOutcome, lines: { quantity: number; deliveredQty: number }[]): 'DELIVERED' | 'PARTIAL' | 'FAILED' {
  if (stop === 'FAILED') return 'FAILED';
  if (stop === 'DELIVERED') return 'DELIVERED';
  const delivered = lines.reduce((s, l) => s + l.deliveredQty, 0);
  if (delivered <= 0) return 'FAILED';
  return lines.every((l) => l.deliveredQty >= l.quantity) ? 'DELIVERED' : 'PARTIAL';
}

/** Order statuses the planner may (re)load onto a trip. */
export const PLANNABLE = ['RECEIVED', 'FAILED'] as const;

export const RESOLVED_STOP = ['DELIVERED', 'PARTIAL', 'FAILED'];
