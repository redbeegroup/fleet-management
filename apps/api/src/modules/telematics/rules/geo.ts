/** Small, dependency-free geometry helpers (WGS84). */

const R = 6_371_008.8; // mean Earth radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray casting; polygon is [[lng, lat], ...]. Accurate for fence-sized polygons. */
export function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface FenceShape {
  id: string;
  shape: 'CIRCLE' | 'POLYGON';
  centerLat?: number | null;
  centerLng?: number | null;
  radiusM?: number | null;
  polygon?: [number, number][] | null;
}

export function fenceContains(f: FenceShape, lat: number, lng: number): boolean {
  if (f.shape === 'CIRCLE') {
    return f.centerLat != null && f.centerLng != null && f.radiusM != null && haversineM(f.centerLat, f.centerLng, lat, lng) <= f.radiusM;
  }
  return Array.isArray(f.polygon) && f.polygon.length >= 3 && pointInPolygon(lat, lng, f.polygon);
}

/** Total path length of an ordered track in km, ignoring GPS jumps above maxJumpKmh. */
export function trackDistanceKm(
  points: { latitude: number; longitude: number; recordedAt: Date }[],
  maxJumpKmh = 250,
): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
    const hours = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 3_600_000;
    if (hours > 0 && d / 1000 / hours > maxJumpKmh) continue; // implausible jump: drop segment
    m += d;
  }
  return m / 1000;
}
