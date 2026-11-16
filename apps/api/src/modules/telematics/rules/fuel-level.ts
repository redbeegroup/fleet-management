import { randomUUID } from 'node:crypto';
import type { DiagnosticsSettings, FuelControlSettings } from '@fms/shared';
import type { EventDraft, RuleFix } from './rules-engine';

/**
 * Pure fuel-level sensor and engine-diagnostics rules (S13). Device attributes are read defensively:
 * the Watch Tower field names are not confirmed yet, so several common aliases are accepted.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Fuel level in litres from attributes (litres, or percent × tank capacity). */
export function fuelLevelL(attrs: Record<string, unknown> | null | undefined, tankL: number | null): number | null {
  if (!attrs) return null;
  const l = num(attrs.fuelLevelL ?? attrs.fuel_level_l ?? attrs.fuelLiters ?? attrs.fuel_liters);
  if (l != null) return l >= 0 ? l : null;
  const pct = num(attrs.fuelLevelPct ?? attrs.fuel_level_pct ?? attrs.fuelPercent ?? attrs.fuel);
  return pct != null && tankL && pct >= 0 && pct <= 100 ? (pct / 100) * tankL : null;
}

export interface FuelLevelState {
  /** Recent raw samples [epochMs, litres], newest last (max 5). */
  samples: [number, number][];
  level: number | null;
  /** Smoothed level where a rise / a drop started, while it continues. */
  riseFrom: number | null;
  dropFrom: number | null;
}
export const EMPTY_FUEL: FuelLevelState = { samples: [], level: null, riseFrom: null, dropFrom: null };

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Smooths the level (median of the last 5 samples, so a single spike is ignored), then follows rises
 * and falls. A rise of ≥ refillMinL is a FUEL_REFILL (reported when it stops rising). A fall of ≥ dropMinL
 * while parked or idling is a FUEL_DROP (possible theft); normal consumption while driving is not.
 */
export function evaluateFuelLevel(prev: FuelLevelState, fix: RuleFix, litres: number | null, s: FuelControlSettings): { state: FuelLevelState; opened: EventDraft[] } {
  const opened: EventDraft[] = [];
  if (litres == null || !s.sensorEnabled) return { state: prev, opened };
  const samples = [...prev.samples, [fix.recordedAt.getTime(), litres] as [number, number]].slice(-5);
  if (samples.length < 3) return { state: { ...prev, samples, level: med(samples.map((x) => x[1])) }, opened };
  const level = med(samples.map((x) => x[1]));
  const st: FuelLevelState = { ...prev, samples, level };
  const last = prev.level ?? level;
  const where = { latitude: fix.latitude, longitude: fix.longitude, speedKmh: fix.speedKmh ?? null };
  const stationary = (fix.speedKmh ?? 0) < 5;

  // Rising
  if (level > last + 0.5) {
    st.riseFrom ??= last;
    st.dropFrom = null;
  } else if (st.riseFrom != null) {
    const added = level - st.riseFrom;
    if (added >= s.refillMinL) opened.push({ id: randomUUID(), type: 'FUEL_REFILL', occurredAt: fix.recordedAt, ...where, data: { litres: r1(added), from: r1(st.riseFrom), to: r1(level) }, notify: false });
    st.riseFrom = null;
  }
  // Falling while parked / idling
  if (level < last - 0.5 && stationary) {
    st.dropFrom ??= last;
  } else if (st.dropFrom != null && (level >= last - 0.5 || !stationary)) {
    const lost = st.dropFrom - level;
    if (lost >= s.dropMinL) opened.push({ id: randomUUID(), type: 'FUEL_DROP', occurredAt: fix.recordedAt, ...where, data: { litres: r1(lost), from: r1(st.dropFrom), to: r1(level) }, notify: true });
    st.dropFrom = null;
  }
  return { state: st, opened };
}

export interface Diagnostics {
  dtcCodes: string[];
  checkEngine: boolean | null;
  coolantTempC: number | null;
  batteryV: number | null;
  engineHours: number | null;
}

/** Engine diagnostics from attributes, or null when the device reports none. */
export function readDiagnostics(attrs: Record<string, unknown> | null | undefined): Diagnostics | null {
  if (!attrs) return null;
  const rawDtc = attrs.dtc ?? attrs.dtcCodes ?? attrs.dtc_codes ?? attrs.troubleCodes;
  const dtcCodes = (Array.isArray(rawDtc) ? rawDtc : typeof rawDtc === 'string' ? rawDtc.split(/[,; ]+/) : [])
    .map((c) => String(c).trim().toUpperCase())
    .filter((c) => /^[PBCU][0-9A-F]{4}$/.test(c));
  const ce = attrs.checkEngine ?? attrs.mil ?? attrs.check_engine;
  const d: Diagnostics = {
    dtcCodes: [...new Set(dtcCodes)].sort(),
    checkEngine: typeof ce === 'boolean' ? ce : ce == null ? null : ['1', 'true', 'on'].includes(String(ce).toLowerCase()),
    coolantTempC: num(attrs.coolantTempC ?? attrs.coolant_temp ?? attrs.engineTemp),
    batteryV: num(attrs.batteryV ?? attrs.battery ?? attrs.power),
    engineHours: num(attrs.engineHours ?? attrs.engine_hours ?? attrs.hours),
  };
  return d.dtcCodes.length || d.checkEngine != null || d.coolantTempC != null || d.batteryV != null || d.engineHours != null ? d : null;
}

/**
 * ENGINE_FAULT events: one per trouble code that newly appears, plus threshold breaches (coolant too hot,
 * battery too low) when they start. `prev` is the last stored diagnostics (or null).
 */
export function diagnosticEvents(prev: Diagnostics | null, now: Diagnostics, fix: RuleFix, s: DiagnosticsSettings): EventDraft[] {
  const where = { latitude: fix.latitude, longitude: fix.longitude, speedKmh: fix.speedKmh ?? null };
  const out: EventDraft[] = [];
  const before = new Set(prev?.dtcCodes ?? []);
  for (const code of now.dtcCodes.filter((c) => !before.has(c)))
    out.push({ id: randomUUID(), type: 'ENGINE_FAULT', occurredAt: fix.recordedAt, ...where, data: { kind: 'DTC', code, autoRepair: s.autoRepairCodes.some((p) => code.startsWith(p)) }, notify: true });
  const hot = (d: Diagnostics | null) => d?.coolantTempC != null && d.coolantTempC > s.coolantMaxC;
  if (hot(now) && !hot(prev)) out.push({ id: randomUUID(), type: 'ENGINE_FAULT', occurredAt: fix.recordedAt, ...where, data: { kind: 'COOLANT_HOT', value: now.coolantTempC, limit: s.coolantMaxC }, notify: true });
  // Low battery only counts with the engine off (cranking dips are normal).
  const low = (d: Diagnostics | null, ign: boolean | null | undefined) => d?.batteryV != null && d.batteryV < s.batteryMinV && ign === false;
  if (low(now, fix.ignition) && !(prev?.batteryV != null && prev.batteryV < s.batteryMinV))
    out.push({ id: randomUUID(), type: 'ENGINE_FAULT', occurredAt: fix.recordedAt, ...where, data: { kind: 'BATTERY_LOW', value: now.batteryV, limit: s.batteryMinV }, notify: true });
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
