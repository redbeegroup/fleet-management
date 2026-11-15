import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { AppState } from 'react-native';
import { ApiError, rawFetch } from './api';
import {
  backoffMs,
  classify,
  isLocal,
  localRefs,
  OutboxItem,
  sendable,
  substitute,
  uuid,
} from './outbox-core';

/**
 * Offline outbox: every driver action is stored on the phone first and sent in order with an
 * Idempotency-Key, so nothing is lost without signal and nothing is applied twice.
 */

const db = SQLite.openDatabaseSync('fms.db');
db.execSync(`
  CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, path TEXT NOT NULL, body TEXT, label TEXT NOT NULL,
    trip_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
  CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`);

type Row = {
  id: string;
  created_at: number;
  path: string;
  body: string | null;
  label: string;
  trip_id: string | null;
  status: 'pending' | 'failed';
  attempts: number;
  next_at: number;
  error: string | null;
};
const toItem = (r: Row): OutboxItem => ({
  id: r.id,
  createdAt: r.created_at,
  path: r.path,
  body: r.body ? JSON.parse(r.body) : null,
  label: r.label,
  tripId: r.trip_id,
  status: r.status,
  attempts: r.attempts,
  nextAt: r.next_at,
  error: r.error,
});

export function items(): OutboxItem[] {
  return db.getAllSync<Row>('SELECT * FROM outbox ORDER BY created_at').map(toItem);
}

// ---- change listeners (badge, optimistic UI) ---------------------------------
const listeners = new Set<() => void>();
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((f) => f());

// ---- online state ---------------------------------------------------------------
let online = true;
export const isOnline = () => online;

// ---- photos ------------------------------------------------------------------
/** Keeps a camera photo in app storage until it is uploaded; returns its "@local:" reference. */
export async function keepPhoto(uri: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}outbox/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const to = `${dir}${uuid()}.${uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg'}`;
  await FileSystem.copyAsync({ from: uri, to });
  return `@local:${to}`;
}
export const localUri = (ref: string) => ref.slice('@local:'.length);

async function upload(ref: string, key: string): Promise<string> {
  const uri = localUri(ref);
  const body = new FormData();
  const name = uri.split('/').pop() ?? 'photo.jpg';
  body.append('file', {
    uri,
    name,
    type: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
  } as unknown as Blob);
  const res = await rawFetch('/files', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
  });
  return ((await res.json()) as { id: string }).id;
}

// ---- queue -------------------------------------------------------------------
export interface Submitted<T> {
  /** True when the action is stored on the phone and will be sent later. */
  queued: boolean;
  result?: T;
}

/**
 * Stores an action and tries to send it (with everything queued before it). Resolves with the
 * server response when it went through now, with `queued: true` when it will be sent later, and
 * throws ApiError when the server rejected it now (the item is then dropped, so the user can fix it).
 */
export async function submit<T>(
  path: string,
  body: unknown,
  meta: { label: string; tripId?: string | null },
): Promise<Submitted<T>> {
  const id = uuid();
  db.runSync(
    'INSERT INTO outbox (id, created_at, path, body, label, trip_id, status, attempts, next_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)',
    [id, Date.now(), path, JSON.stringify(body ?? {}), meta.label, meta.tripId ?? null, 'pending'],
  );
  changed();
  const outcome = await flush(id);
  if (outcome?.kind === 'done') return { queued: false, result: outcome.result as T };
  if (outcome?.kind === 'failed') {
    remove(id);
    throw new ApiError(outcome.status, outcome.message);
  }
  return { queued: true };
}

type Outcome =
  | { kind: 'done'; result: unknown }
  | { kind: 'failed'; status: number; message: string }
  | { kind: 'retry' };
let flushing: Promise<Map<string, Outcome>> | null = null;

/** Sends due items in order. Returns the outcome of `watch` if it was attempted. */
export async function flush(watch?: string): Promise<Outcome | undefined> {
  while (flushing) await flushing.catch(() => undefined);
  flushing = run();
  try {
    return (await flushing).get(watch ?? '');
  } finally {
    flushing = null;
  }
}

async function run(): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>();
  for (const item of sendable(items(), Date.now())) {
    const o = await sendOne(item);
    out.set(item.id, o);
    if (o.kind === 'retry') {
      online = false;
      const attempts = item.attempts + 1;
      db.runSync('UPDATE outbox SET attempts = ?, next_at = ? WHERE id = ?', [
        attempts,
        Date.now() + backoffMs(attempts),
        item.id,
      ]);
      break; // keep the order: later actions wait for this one
    }
    online = true;
    if (o.kind === 'done') remove(item.id);
    else
      db.runSync("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", [
        o.message,
        item.id,
      ]);
  }
  changed();
  return out;
}

async function sendOne(item: OutboxItem): Promise<Outcome> {
  try {
    let body = item.body;
    const refs = localRefs(body);
    if (refs.length) {
      const ids: Record<string, string> = {};
      for (const [n, ref] of refs.entries()) ids[ref] = await upload(ref, `${item.id}-f${n}`);
      body = substitute(body, ids);
      // Remember the uploads so a retry does not depend on the local files any more.
      db.runSync('UPDATE outbox SET body = ? WHERE id = ?', [JSON.stringify(body), item.id]);
      for (const ref of refs)
        void FileSystem.deleteAsync(localUri(ref), { idempotent: true }).catch(() => undefined);
    }
    const res = await rawFetch(item.path, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      headers: { 'Idempotency-Key': item.id },
    });
    return { kind: 'done', result: res.status === 204 ? undefined : await res.json() };
  } catch (e) {
    if (e instanceof ApiError) {
      const k = classify(e.status);
      return k === 'retry'
        ? { kind: 'retry' }
        : { kind: 'failed', status: e.status, message: e.message };
    }
    return { kind: 'retry' };
  }
}

export function remove(id: string) {
  const it = db.getFirstSync<Row>('SELECT * FROM outbox WHERE id = ?', [id]);
  if (it?.body)
    for (const ref of localRefs(JSON.parse(it.body)))
      if (isLocal(ref))
        void FileSystem.deleteAsync(localUri(ref), { idempotent: true }).catch(() => undefined);
  db.runSync('DELETE FROM outbox WHERE id = ?', [id]);
  changed();
}

/** Puts a failed item back in the queue (e.g. after the dispatcher fixed the trip). */
export function retry(id: string) {
  db.runSync(
    "UPDATE outbox SET status = 'pending', error = NULL, attempts = 0, next_at = 0 WHERE id = ?",
    [id],
  );
  changed();
  void flush();
}

/** Signing out clears what belongs to this user. */
export function clearAll() {
  for (const i of items()) remove(i.id);
  db.runSync('DELETE FROM cache');
}

// ---- read cache --------------------------------------------------------------
/** GET with a fallback to the last good copy when there is no connection. */
export async function cachedGet<T>(
  path: string,
): Promise<{ data: T; stale: boolean; at: number | null }> {
  try {
    const res = await rawFetch(path, { method: 'GET' });
    const data = (await res.json()) as T;
    db.runSync('INSERT OR REPLACE INTO cache (key, json, updated_at) VALUES (?, ?, ?)', [
      path,
      JSON.stringify(data),
      Date.now(),
    ]);
    online = true;
    return { data, stale: false, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    online = false;
    changed();
    const row = db.getFirstSync<{ json: string; updated_at: number }>(
      'SELECT json, updated_at FROM cache WHERE key = ?',
      [path],
    );
    if (!row) throw new Error('No connection and nothing saved on this phone yet.');
    return { data: JSON.parse(row.json) as T, stale: true, at: row.updated_at };
  }
}

// ---- triggers ----------------------------------------------------------------
let started = false;
/** Sends the queue when the connection comes back, when the app returns to the foreground and every 30 s. */
export function startOutbox() {
  if (started) return;
  started = true;
  NetInfo.addEventListener((s) => {
    const was = online;
    online = !!s.isConnected && s.isInternetReachable !== false;
    if (online && !was) {
      // Connection is back: send now, without waiting for the backoff.
      db.runSync("UPDATE outbox SET next_at = 0 WHERE status = 'pending'");
      void flush();
    }
    changed();
  });
  AppState.addEventListener('change', (s) => s === 'active' && void flush());
  setInterval(() => void flush(), 30_000);
  void flush();
}
