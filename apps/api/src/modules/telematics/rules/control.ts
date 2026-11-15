import { randomUUID } from 'node:crypto';
import type { ControlSettings } from '@fms/shared';
import { haversineM } from './geo';
import type { EventClose, EventDraft, RuleFix } from './rules-engine';

/**
 * Pure control rules (S12): off-route on a trip, movement without a trip, use outside working hours,
 * moving without a driver on duty, entering restricted areas. Like the core rules engine it keeps
 * episodes open across fixes and returns events to open/close.
 */

export interface ControlState {
  lastLat: number | null;
  lastLng: number | null;
  offRouteSince: Date | null;
  offRouteEventId: string | null;
  offRouteMaxM: number | null;
  noTripKm: number | null;
  noTripEventId: string | null;
  afterHoursEventId: string | null;
  noDriverEventId: string | null;
}

export const EMPTY_CONTROL: ControlState = {
  lastLat: null,
  lastLng: null,
  offRouteSince: null,
  offRouteEventId: null,
  offRouteMaxM: null,
  noTripKm: null,
  noTripEventId: null,
  afterHoursEventId: null,
  noDriverEventId: null,
};

export interface ControlContext {
  settings: ControlSettings;
  timezone: string;
  /** The vehicle's ONGOING trip, with its planned road route when it has one (OSRM). */
  trip: { id: string; tripNo: string; route: { lat: number; lng: number }[] | null } | null;
  /** Current driver (trip or standing assignment) and whether they are on duty. */
  driverId: string | null;
  driverOnDuty: boolean;
  /** Restricted geofences entered at this fix. */
  enteredRestricted: { id: string; name: string }[];
}

const MOVING_KMH = 5;
/** Steps longer than this between two fixes are GPS jumps or long gaps: not counted as driving. */
const MAX_STEP_M = 20_000;
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

/** Shortest distance (m) from a point to a polyline, using a local equirectangular projection. */
export function distanceToRouteM(lat: number, lng: number, route: { lat: number; lng: number }[]): number {
  if (!route.length) return Infinity;
  if (route.length === 1) return haversineM(lat, lng, route[0].lat, route[0].lng);
  const k = Math.cos((lat * Math.PI) / 180);
  const M = 111_320; // m per degree latitude
  const px = lng * k * M;
  const py = lat * M;
  let best = Infinity;
  for (let i = 1; i < route.length; i++) {
    const ax = route[i - 1].lng * k * M;
    const ay = route[i - 1].lat * M;
    const bx = route[i].lng * k * M;
    const by = route[i].lat * M;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** Local weekday (0 = Sunday) and minutes after midnight of an instant in a time zone. */
export function localClock(at: Date, timezone: string): { weekday: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { weekday, minute: Number(p.hour) * 60 + Number(p.minute) };
}

const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * Inside working hours? A day's window [start, end) may run past midnight (end < start): then the
 * part after midnight belongs to the previous weekday's window.
 */
export function withinWorkingHours(at: Date, timezone: string, hours: ControlSettings['workingHours']): boolean {
  const { weekday, minute } = localClock(at, timezone);
  const today = hours[weekday];
  if (today) {
    const s = hm(today.start);
    const e = hm(today.end);
    if (e > s ? minute >= s && minute < e : minute >= s) return true;
  }
  const yesterday = hours[(weekday + 6) % 7];
  if (yesterday) {
    const s = hm(yesterday.start);
    const e = hm(yesterday.end);
    if (e <= s && minute < e) return true;
  }
  return false;
}

export function evaluateControl(prev: ControlState, fix: RuleFix, ctx: ControlContext): { state: ControlState; opened: EventDraft[]; closed: EventClose[] } {
  const opened: EventDraft[] = [];
  const closed: EventClose[] = [];
  const s: ControlState = { ...prev };
  const at = fix.recordedAt;
  const where = { latitude: fix.latitude, longitude: fix.longitude };
  const speed = fix.speedKmh ?? 0;
  const set = ctx.settings;
  const stepM = prev.lastLat != null && prev.lastLng != null ? haversineM(prev.lastLat, prev.lastLng, fix.latitude, fix.longitude) : 0;
  const moving = speed >= MOVING_KMH || (stepM > 50 && stepM < MAX_STEP_M);
  const parked = fix.ignition === false && speed < MOVING_KMH;
  const base = { tripId: ctx.trip?.id ?? null, tripNo: ctx.trip?.tripNo ?? null };

  // 1. Off-route: only against a real road route.
  const route = set.offRouteEnabled && ctx.trip?.route && ctx.trip.route.length >= 2 ? ctx.trip.route : null;
  const d = route ? distanceToRouteM(fix.latitude, fix.longitude, route) : null;
  if (d != null && d > set.offRouteMeters) {
    s.offRouteSince ??= at;
    s.offRouteMaxM = Math.max(s.offRouteMaxM ?? 0, Math.round(d));
    if (!s.offRouteEventId && minutes(s.offRouteSince, at) >= set.offRouteMinutes) {
      s.offRouteEventId = randomUUID();
      opened.push({ id: s.offRouteEventId, type: 'OFF_ROUTE', occurredAt: s.offRouteSince, ...where, speedKmh: speed, data: { ...base, distanceM: Math.round(d), limitM: set.offRouteMeters }, notify: true });
    }
  } else {
    if (s.offRouteEventId && s.offRouteSince) closed.push({ id: s.offRouteEventId, endedAt: at, data: { maxDistanceM: s.offRouteMaxM, durationMin: Math.round(minutes(s.offRouteSince, at)) } });
    s.offRouteSince = null;
    s.offRouteEventId = null;
    s.offRouteMaxM = null;
  }

  // 2. Movement without an ongoing trip.
  if (!ctx.trip && set.movementWithoutTrip) {
    if (moving && stepM < MAX_STEP_M) s.noTripKm = (s.noTripKm ?? 0) + stepM / 1000;
    if (!s.noTripEventId && (s.noTripKm ?? 0) >= set.movementWithoutTripKm) {
      s.noTripEventId = randomUUID();
      opened.push({ id: s.noTripEventId, type: 'UNAUTHORISED_MOVEMENT', occurredAt: at, ...where, speedKmh: speed, data: { km: Math.round((s.noTripKm ?? 0) * 10) / 10, driverId: ctx.driverId }, notify: true });
    }
  }
  if (ctx.trip || parked || !set.movementWithoutTrip) {
    if (s.noTripEventId) closed.push({ id: s.noTripEventId, endedAt: at, data: { km: Math.round((s.noTripKm ?? 0) * 10) / 10 } });
    s.noTripEventId = null;
    s.noTripKm = null;
  }

  // 3. Outside working hours.
  const afterHours = set.workingHoursEnabled && !withinWorkingHours(at, ctx.timezone, set.workingHours);
  if (afterHours && moving && !s.afterHoursEventId) {
    s.afterHoursEventId = randomUUID();
    opened.push({ id: s.afterHoursEventId, type: 'AFTER_HOURS', occurredAt: at, ...where, speedKmh: speed, data: { ...base, driverId: ctx.driverId }, notify: true });
  } else if (s.afterHoursEventId && (!afterHours || parked)) {
    closed.push({ id: s.afterHoursEventId, endedAt: at, data: {} });
    s.afterHoursEventId = null;
  }

  // 4. Moving without a driver on duty.
  const noDriver = set.requireDriverOnDuty && (!ctx.driverId || !ctx.driverOnDuty);
  if (noDriver && moving && !s.noDriverEventId) {
    s.noDriverEventId = randomUUID();
    opened.push({ id: s.noDriverEventId, type: 'NO_DRIVER', occurredAt: at, ...where, speedKmh: speed, data: { ...base, driverId: ctx.driverId, reason: ctx.driverId ? 'driver not on duty' : 'no driver assigned' }, notify: true });
  } else if (s.noDriverEventId && (!noDriver || parked)) {
    closed.push({ id: s.noDriverEventId, endedAt: at, data: {} });
    s.noDriverEventId = null;
  }

  // 5. Restricted areas (instant, escalated).
  if (set.restrictedAreaAlerts)
    for (const g of ctx.enteredRestricted)
      opened.push({ id: randomUUID(), type: 'RESTRICTED_AREA', occurredAt: at, ...where, speedKmh: speed, geofenceId: g.id, data: { ...base, geofence: g.name, driverId: ctx.driverId }, notify: true });

  s.lastLat = fix.latitude;
  s.lastLng = fix.longitude;
  return { state: s, opened, closed };
}
