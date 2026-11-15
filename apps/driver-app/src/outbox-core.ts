/**
 * Pure parts of the offline outbox (no React Native imports, testable in Node).
 * Queued actions are sent first-in first-out; local photos are referenced in the body as
 * "@local:<uri>" and replaced by uploaded file ids just before sending.
 */

export interface OutboxItem {
  /** Also the Idempotency-Key, so a resend never applies twice. */
  id: string;
  createdAt: number;
  path: string;
  body: unknown;
  /** Shown in the pending list, e.g. "Delivered · Shwe Mart". */
  label: string;
  tripId: string | null;
  status: 'pending' | 'failed';
  attempts: number;
  nextAt: number;
  error: string | null;
}

export const LOCAL = '@local:';
export const isLocal = (v: unknown): v is string => typeof v === 'string' && v.startsWith(LOCAL);

/** What to do after a send attempt: null status = no response (offline, timeout). */
export function classify(status: number | null): 'done' | 'retry' | 'failed' {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) return 'done';
  // 408 timeout, 409 in progress (idempotency lock), 425/429 too early / rate limited, 5xx server
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
    return 'retry';
  return 'failed';
}

/** Retry delay: 5 s, 10 s, 20 s … capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** Local photo references in a body (deep). */
export function localRefs(body: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (isLocal(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(body);
  return [...new Set(out)];
}

/** Replaces local references by uploaded ids (deep copy). */
export function substitute<T>(body: T, ids: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (isLocal(v)) return ids[v] ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(body) as T;
}

/** Items to send now, oldest first. Stops at the first item still waiting, to keep the order. */
export function sendable(items: OutboxItem[], now: number): OutboxItem[] {
  const pending = items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  const out: OutboxItem[] = [];
  for (const i of pending) {
    if (i.nextAt > now) break;
    out.push(i);
  }
  return out;
}

/** Path of a queued stop action → stop id and action, for optimistic display. */
export function stopAction(path: string): { stopId: string; action: string } | null {
  const m = /\/stops\/([0-9a-f-]{36})\/(arrive|complete|returns)$/.exec(path);
  return m ? { stopId: m[1], action: m[2] } : null;
}

/** RFC 4122 v4 id from Math.random (good enough for client keys). */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
