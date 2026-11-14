import type { UpsertOrderInput } from '@fms/shared';
import { createHash } from 'node:crypto';

/** Stable JSON (sorted keys) so equal payloads hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v instanceof Date ? v.toISOString() : v) ?? 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export const payloadHash = (o: UpsertOrderInput) => createHash('sha256').update(stableStringify(o)).digest('hex');

const sum = (xs: (number | null | undefined)[]) => {
  const known = xs.filter((x): x is number => x != null);
  return known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 1000) / 1000 : null;
};

/** Order columns from the DMS payload (customer handled separately). */
export function orderColumns(o: UpsertOrderInput) {
  return {
    priority: o.priority,
    orderDate: o.orderDate ?? null,
    windowStart: o.deliveryWindow?.start ?? null,
    windowEnd: o.deliveryWindow?.end ?? null,
    address: o.address ?? null,
    latitude: o.latitude ?? null,
    longitude: o.longitude ?? null,
    contactName: o.contactName ?? null,
    contactPhone: o.contactPhone ?? null,
    codAmount: o.codAmount ?? null,
    notes: o.notes ?? null,
    totalWeightKg: sum(o.lines.map((l) => l.weightKg)),
    totalVolumeM3: sum(o.lines.map((l) => l.volumeM3)),
  };
}

export function lineRows(o: UpsertOrderInput) {
  return o.lines.map((l, i) => ({
    lineNo: i + 1,
    sku: l.sku,
    description: l.description ?? null,
    quantity: l.quantity,
    uom: l.uom,
    weightKg: l.weightKg ?? null,
    volumeM3: l.volumeM3 ?? null,
  }));
}

/** Statuses in which the DMS may still change or cancel an order. */
export const EDITABLE = ['RECEIVED'];
