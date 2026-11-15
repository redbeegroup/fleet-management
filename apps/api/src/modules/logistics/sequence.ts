import { haversineM } from '../telematics/rules/geo';

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Nearest-neighbour visiting order from the depot. Stops without coordinates keep their
 * relative order and go last. (S11 replaces this with VROOM behind the same signature.)
 */
export function sequenceStops<T extends { id: string; lat: number | null; lng: number | null }>(depot: Point | null, stops: T[]): T[] {
  const located = stops.filter((s) => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (!depot && located.length) depot = { lat: located[0].lat!, lng: located[0].lng! };
  const out: T[] = [];
  let at = depot;
  const left = [...located];
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, i) => {
      const d = haversineM(at!.lat, at!.lng, s.lat!, s.lng!);
      if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && s.id < left[best].id)) {
        best = i;
        bestD = d;
      }
    });
    const [next] = left.splice(best, 1);
    out.push(next);
    at = { lat: next.lat!, lng: next.lng! };
  }
  return [...out, ...rest];
}

/** Straight-line round trip depot → stops → depot, in km. */
export function routeKm(depot: Point | null, stops: { lat: number | null; lng: number | null }[]): number {
  const pts = stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng! }));
  const path = depot ? [depot, ...pts, depot] : pts;
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversineM(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
  return Math.round(m / 100) / 10;
}

/** Bearing (degrees, 0 = north) from a to b, used to sweep orders around the depot. */
export function bearing(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
