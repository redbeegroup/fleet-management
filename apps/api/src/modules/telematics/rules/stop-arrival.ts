import { haversineM } from './geo';
import type { RuleFix } from './rules-engine';

/**
 * Pure GPS arrival at delivery stops (S14). A vehicle that has (almost) stopped within `radiusM` of an
 * open stop of its ongoing load arrives there; it leaves once it is more than twice the radius away (the
 * hysteresis avoids flapping at the edge). Only one stop is "current" at a time.
 */
export interface StopPoint {
  id: string;
  latitude: number;
  longitude: number;
  /** Stops already completed are not arrived at again. */
  open: boolean;
}

export function stopArrival(atStopId: string | null, stops: StopPoint[], fix: RuleFix, radiusM: number): { enter: string | null; exit: boolean } {
  const d = (s: StopPoint) => haversineM(fix.latitude, fix.longitude, s.latitude, s.longitude);
  if (atStopId) {
    const cur = stops.find((s) => s.id === atStopId);
    if (!cur || d(cur) > radiusM * 2) {
      const next = enterable();
      return { enter: next, exit: true };
    }
    return { enter: null, exit: false };
  }
  return { enter: enterable(), exit: false };

  function enterable(): string | null {
    if ((fix.speedKmh ?? 0) > 10) return null;
    const near = stops
      .filter((s) => s.open)
      .map((s) => ({ s, m: d(s) }))
      .filter((x) => x.m <= radiusM)
      .sort((a, b) => a.m - b.m)[0];
    return near?.s.id ?? null;
  }
}
