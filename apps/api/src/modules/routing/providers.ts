import { encodePolyline } from './polyline';
import { haversineM } from '../telematics/rules/geo';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  km: number;
  minutes: number;
}

export interface RouteResult {
  km: number;
  minutes: number;
  geometry: string | null;
  legs: RouteLeg[];
}

export interface OptJob {
  id: string;
  location: LatLng;
  serviceMinutes: number;
  window: { start: Date; end: Date } | null;
  /** [kg, m³, cases, pallets] — converted to integers for VROOM. */
  amount: [number, number, number, number];
  priority: number; // 0–100
}

export interface OptVehicle {
  id: string;
  /** null = unlimited for that dimension. */
  capacity: [number | null, number | null, number | null, number | null];
  maxTasks: number | null;
  start: Date;
}

export interface OptRoute {
  vehicleId: string;
  jobIds: string[];
  arrivals: Date[];
  km: number;
  minutes: number;
  geometry: string | null;
}

export interface OptResult {
  routes: OptRoute[];
  unassigned: string[];
}

const SCALE = [1, 1000, 1, 10];
const BIG = 1_000_000_000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** HTTP adapter for OSRM (routes) and VROOM via vroom-express (optimisation). */
export class OsrmVroomProvider {
  constructor(
    private readonly osrmUrl: string,
    private readonly vroomUrl: string | null,
    private readonly timeoutMs = 10_000,
  ) {}

  async route(points: LatLng[]): Promise<RouteResult> {
    if (points.length < 2) return { km: 0, minutes: 0, geometry: null, legs: [] };
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const res = await fetch(`${this.osrmUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=false`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: string; legs: { distance: number; duration: number }[] }[] };
    const r = body.routes?.[0];
    if (body.code !== 'Ok' || !r) throw new Error(`OSRM ${body.code}`);
    return { km: r1(r.distance / 1000), minutes: Math.round(r.duration / 60), geometry: r.geometry, legs: r.legs.map((l) => ({ km: r1(l.distance / 1000), minutes: Math.round(l.duration / 60) })) };
  }

  /** Builds the VROOM problem (exported for tests). */
  static problem(depot: LatLng, vehicles: OptVehicle[], jobs: OptJob[]) {
    const vIdx = new Map(vehicles.map((v, i) => [i + 1, v.id]));
    const jIdx = new Map(jobs.map((j, i) => [i + 1, j.id]));
    const loc = (p: LatLng) => [p.lng, p.lat];
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    return {
      vIdx,
      jIdx,
      body: {
        vehicles: vehicles.map((v, i) => ({
          id: i + 1,
          profile: 'car',
          start: loc(depot),
          end: loc(depot),
          capacity: v.capacity.map((c, k) => (c == null ? BIG : Math.floor(c * SCALE[k]))),
          ...(v.maxTasks != null && { max_tasks: v.maxTasks }),
          time_window: [sec(v.start), sec(v.start) + 16 * 3600],
        })),
        jobs: jobs.map((j, i) => ({
          id: i + 1,
          location: loc(j.location),
          service: Math.round(j.serviceMinutes * 60),
          delivery: j.amount.map((a, k) => Math.ceil(a * SCALE[k])),
          priority: j.priority,
          ...(j.window && { time_windows: [[sec(j.window.start), sec(j.window.end)]] }),
        })),
        options: { g: true },
      },
    };
  }

  async optimize(depot: LatLng, vehicles: OptVehicle[], jobs: OptJob[]): Promise<OptResult> {
    if (!this.vroomUrl) throw new Error('VROOM not configured');
    const { vIdx, jIdx, body } = OsrmVroomProvider.problem(depot, vehicles, jobs);
    const res = await fetch(this.vroomUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs * 3) });
    if (!res.ok) throw new Error(`VROOM HTTP ${res.status}`);
    const out = (await res.json()) as {
      code: number;
      error?: string;
      routes?: { vehicle: number; distance?: number; duration: number; service?: number; waiting_time?: number; geometry?: string; steps: { type: string; id?: number; job?: number; arrival: number }[] }[];
      unassigned?: { id: number }[];
    };
    if (out.code !== 0) throw new Error(`VROOM ${out.code}: ${out.error ?? ''}`);
    return {
      routes: (out.routes ?? []).map((r) => {
        const jobsSteps = r.steps.filter((s) => s.type === 'job');
        return {
          vehicleId: vIdx.get(r.vehicle)!,
          jobIds: jobsSteps.map((s) => jIdx.get(s.id ?? s.job!)!),
          arrivals: jobsSteps.map((s) => new Date(s.arrival * 1000)),
          km: r1((r.distance ?? 0) / 1000),
          // Travel + service + waiting for time windows.
          minutes: Math.round((r.duration + (r.service ?? 0) + (r.waiting_time ?? 0)) / 60),
          geometry: r.geometry ?? null,
        };
      }),
      unassigned: (out.unassigned ?? []).map((u) => jIdx.get(u.id)!),
    };
  }

  async health(): Promise<{ osrm: boolean; vroom: boolean | null }> {
    const ok = async (url: string) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return r.status < 500;
      } catch {
        return false;
      }
    };
    return {
      osrm: await ok(`${this.osrmUrl.replace(/\/$/, '')}/nearest/v1/driving/96.15,16.8`),
      vroom: this.vroomUrl ? await ok(this.vroomUrl.replace(/\/$/, '') + '/health') : null,
    };
  }
}

/** Fallback: straight lines at an average speed (no road network). */
export class StraightLineProvider {
  constructor(private readonly avgSpeedKmh: number) {}

  route(points: LatLng[]): RouteResult {
    const legs: RouteLeg[] = [];
    for (let i = 1; i < points.length; i++) {
      const km = haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng) / 1000;
      legs.push({ km: r1(km), minutes: Math.round((km / this.avgSpeedKmh) * 60) });
    }
    return {
      km: r1(legs.reduce((s, l) => s + l.km, 0)),
      minutes: legs.reduce((s, l) => s + l.minutes, 0),
      geometry: points.length > 1 ? encodePolyline(points) : null,
      legs,
    };
  }
}
