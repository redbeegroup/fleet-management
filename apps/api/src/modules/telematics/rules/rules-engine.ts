import { randomUUID } from 'node:crypto';
import type { TelematicsSettings, TelemetryEventType } from '@fms/shared';
import { fenceContains, FenceShape } from './geo';
import { detectHarsh } from './harsh';

/**
 * Pure telematics rules engine. Given the carried state of one vehicle and a
 * new position fix, returns the new state plus events to open/close. It does no
 * I/O so it is deterministic and unit-testable; TelematicsService persists.
 */

export interface RuleFix {
  recordedAt: Date;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  heading?: number | null;
  ignition?: boolean | null;
  attributes?: Record<string, unknown> | null;
}

export interface RuleState {
  lastFixAt: Date | null;
  ignition: boolean | null;
  lastSpeedKmh: number | null;
  lastHeading: number | null;
  insideGeofenceIds: string[];
  overspeedEventId: string | null;
  overspeedMaxKmh: number | null;
  idleSince: Date | null;
  idleEventId: string | null;
  offlineEventId: string | null;
}

export const EMPTY_STATE: RuleState = {
  lastFixAt: null,
  ignition: null,
  lastSpeedKmh: null,
  lastHeading: null,
  insideGeofenceIds: [],
  overspeedEventId: null,
  overspeedMaxKmh: null,
  idleSince: null,
  idleEventId: null,
  offlineEventId: null,
};

export interface Fence extends FenceShape {
  name: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
}

export interface RuleContext {
  settings: TelematicsSettings;
  /** Effective limit for this vehicle (vehicle override or company default). */
  speedLimitKmh: number;
  geofences: Fence[];
}

export interface EventDraft {
  id: string;
  type: TelemetryEventType;
  occurredAt: Date;
  endedAt?: Date | null;
  latitude?: number;
  longitude?: number;
  speedKmh?: number | null;
  geofenceId?: string | null;
  data?: Record<string, unknown>;
  /** Whether this event should produce a user notification. */
  notify: boolean;
}

export interface EventClose {
  id: string;
  endedAt: Date;
  data: Record<string, unknown>;
}

export interface RuleResult {
  state: RuleState;
  opened: EventDraft[];
  closed: EventClose[];
}

const IDLE_SPEED_KMH = 3;
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

export function evaluate(prev: RuleState, fix: RuleFix, ctx: RuleContext): RuleResult {
  const opened: EventDraft[] = [];
  const closed: EventClose[] = [];
  // Out-of-order or duplicate fixes are ignored by the rules (still stored as history).
  if (prev.lastFixAt && fix.recordedAt <= prev.lastFixAt) return { state: prev, opened, closed };

  const s: RuleState = { ...prev, insideGeofenceIds: [...prev.insideGeofenceIds] };
  const at = fix.recordedAt;
  const where = { latitude: fix.latitude, longitude: fix.longitude };
  const speed = fix.speedKmh ?? 0;
  const firstFix = prev.lastFixAt === null;

  // 1. GPS restored
  if (s.offlineEventId) {
    closed.push({ id: s.offlineEventId, endedAt: at, data: {} });
    opened.push({ id: randomUUID(), type: 'GPS_RESTORED', occurredAt: at, ...where, notify: false });
    s.offlineEventId = null;
  }

  // 2. Ignition changes
  if (fix.ignition != null) {
    if (s.ignition != null && fix.ignition !== s.ignition) {
      opened.push({ id: randomUUID(), type: fix.ignition ? 'IGNITION_ON' : 'IGNITION_OFF', occurredAt: at, ...where, notify: false });
    }
    s.ignition = fix.ignition;
  }

  // 3. Geofences (no enter/exit flood on the very first fix)
  const inside = ctx.geofences.filter((g) => fenceContains(g, fix.latitude, fix.longitude)).map((g) => g.id);
  if (!firstFix) {
    const byId = new Map(ctx.geofences.map((g) => [g.id, g]));
    for (const id of inside.filter((x) => !prev.insideGeofenceIds.includes(x))) {
      const g = byId.get(id)!;
      opened.push({ id: randomUUID(), type: 'GEOFENCE_ENTER', occurredAt: at, ...where, speedKmh: speed, geofenceId: id, data: { geofence: g.name }, notify: g.alertOnEnter });
    }
    for (const id of prev.insideGeofenceIds.filter((x) => !inside.includes(x))) {
      const g = byId.get(id);
      if (!g) continue; // fence deleted/deactivated: drop silently
      opened.push({ id: randomUUID(), type: 'GEOFENCE_EXIT', occurredAt: at, ...where, speedKmh: speed, geofenceId: id, data: { geofence: g.name }, notify: g.alertOnExit });
    }
  }
  s.insideGeofenceIds = inside;

  // 4. Overspeed episodes with hysteresis
  const limit = ctx.speedLimitKmh;
  if (!s.overspeedEventId && speed > limit) {
    s.overspeedEventId = randomUUID();
    s.overspeedMaxKmh = speed;
    opened.push({ id: s.overspeedEventId, type: 'OVERSPEED', occurredAt: at, ...where, speedKmh: speed, data: { limitKmh: limit }, notify: true });
  } else if (s.overspeedEventId) {
    s.overspeedMaxKmh = Math.max(s.overspeedMaxKmh ?? 0, speed);
    if (speed <= limit - ctx.settings.overspeedHysteresisKmh) {
      closed.push({ id: s.overspeedEventId, endedAt: at, data: { limitKmh: limit, maxKmh: s.overspeedMaxKmh } });
      s.overspeedEventId = null;
      s.overspeedMaxKmh = null;
    }
  }

  // 5. Idling: engine on, not moving
  const idleNow = fix.ignition === true && speed < IDLE_SPEED_KMH;
  if (idleNow) {
    s.idleSince ??= at;
    if (!s.idleEventId && minutes(s.idleSince, at) >= ctx.settings.idleMinutes) {
      s.idleEventId = randomUUID();
      opened.push({ id: s.idleEventId, type: 'IDLE', occurredAt: s.idleSince, ...where, speedKmh: speed, notify: true });
    }
  } else {
    if (s.idleEventId && s.idleSince) {
      closed.push({ id: s.idleEventId, endedAt: at, data: { durationMin: Math.round(minutes(s.idleSince, at)) } });
    }
    s.idleSince = null;
    s.idleEventId = null;
  }

  // 6. Harsh driving (instant events; they feed the safety score rather than alerts)
  const prevSample = prev.lastFixAt ? { at: prev.lastFixAt, speedKmh: prev.lastSpeedKmh, heading: prev.lastHeading } : null;
  for (const h of detectHarsh(prevSample, { at, speedKmh: fix.speedKmh ?? null, heading: fix.heading ?? null, attributes: fix.attributes }, ctx.settings)) {
    opened.push({ id: randomUUID(), type: h.type, occurredAt: at, ...where, speedKmh: speed, data: { value: h.value, unit: h.unit, source: h.source }, notify: false });
  }

  s.lastFixAt = at;
  s.lastSpeedKmh = fix.speedKmh ?? null;
  s.lastHeading = fix.heading ?? null;
  return { state: s, opened, closed };
}

/** Offline check (run periodically): opens GPS_OFFLINE when the last fix is too old. */
export function evaluateOffline(prev: RuleState, now: Date, settings: TelematicsSettings): RuleResult {
  if (!prev.lastFixAt || prev.offlineEventId || minutes(prev.lastFixAt, now) < settings.offlineMinutes) {
    return { state: prev, opened: [], closed: [] };
  }
  const id = randomUUID();
  return {
    state: { ...prev, offlineEventId: id },
    opened: [{ id, type: 'GPS_OFFLINE', occurredAt: now, data: { lastFixAt: prev.lastFixAt.toISOString() }, notify: true }],
    closed: [],
  };
}
