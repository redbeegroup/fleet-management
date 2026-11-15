import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../common/config/env';
import { sequenceStops } from '../logistics/sequence';
import { LatLng, OptJob, OptVehicle, OsrmVroomProvider, RouteResult, StraightLineProvider } from './providers';

export type RoutingSource = 'osrm' | 'straight-line';

export interface PlannedStop {
  id: string;
  lat: number | null;
  lng: number | null;
  serviceMinutes: number;
  window: { start: Date; end: Date } | null;
  amount: [number, number, number, number];
}

export interface SequencedRoute {
  order: string[];
  arrivals: Map<string, Date>;
  km: number;
  minutes: number;
  geometry: string | null;
  source: RoutingSource;
}

/**
 * Road routing through OSRM/VROOM when configured and reachable, otherwise straight lines.
 * Every result says which source produced it.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  private engine(): OsrmVroomProvider | null {
    const e = env();
    return e.OSRM_URL ? new OsrmVroomProvider(e.OSRM_URL, e.VROOM_URL ?? null) : null;
  }

  async status() {
    const e = this.engine();
    if (!e) return { configured: false, osrm: null, vroom: null, source: 'straight-line' as RoutingSource };
    const h = await e.health();
    return { configured: true, ...h, source: (h.osrm ? 'osrm' : 'straight-line') as RoutingSource };
  }

  /** Route through points in the given order (depot → stops → depot). */
  async route(points: LatLng[], avgSpeedKmh: number): Promise<RouteResult & { source: RoutingSource }> {
    const e = this.engine();
    if (e && points.length > 1) {
      try {
        return { ...(await e.route(points)), source: 'osrm' };
      } catch (err) {
        this.logger.warn(`OSRM route failed, using straight lines: ${(err as Error).message}`);
      }
    }
    return { ...new StraightLineProvider(avgSpeedKmh).route(points), source: 'straight-line' };
  }

  /** Best visiting order for one vehicle (time windows, service times), with ETAs. */
  async sequence(depot: LatLng | null, stops: PlannedStop[], start: Date, avgSpeedKmh: number): Promise<SequencedRoute> {
    const located = stops.filter((s) => s.lat != null && s.lng != null);
    const unlocated = stops.filter((s) => s.lat == null || s.lng == null).map((s) => s.id);
    const e = this.engine();
    if (e && depot && located.length) {
      try {
        const opt = await e.optimize(
          depot,
          [{ id: 'v', capacity: [null, null, null, null], maxTasks: null, start }],
          located.map<OptJob>((s) => ({ id: s.id, location: { lat: s.lat!, lng: s.lng! }, serviceMinutes: s.serviceMinutes, window: s.window, amount: [0, 0, 0, 0], priority: 0 })),
        );
        const r = opt.routes[0];
        // Stops VROOM could not fit into their windows still have to be visited: append them.
        const order = [...(r?.jobIds ?? []), ...opt.unassigned, ...unlocated];
        const arrivals = new Map<string, Date>((r?.jobIds ?? []).map((id, i) => [id, r!.arrivals[i]]));
        if (opt.unassigned.length || !r) {
          return this.withRoute(depot, stops, order, start, avgSpeedKmh);
        }
        return { order, arrivals, km: r.km, minutes: r.minutes, geometry: r.geometry, source: 'osrm' };
      } catch (err) {
        this.logger.warn(`VROOM optimisation failed, using nearest-neighbour: ${(err as Error).message}`);
      }
    }
    const order = sequenceStops(depot, stops).map((s) => s.id);
    return this.withRoute(depot, stops, order, start, avgSpeedKmh);
  }

  /** ETAs and totals for a fixed order (manual reorder or fallback). */
  async withRoute(depot: LatLng | null, stops: PlannedStop[], order: string[], start: Date, avgSpeedKmh: number): Promise<SequencedRoute> {
    const byId = new Map(stops.map((s) => [s.id, s]));
    const seq = order.map((id) => byId.get(id)!).filter(Boolean);
    const located = seq.filter((s) => s.lat != null && s.lng != null);
    const pts: LatLng[] = [...(depot ? [depot] : []), ...located.map((s) => ({ lat: s.lat!, lng: s.lng! })), ...(depot ? [depot] : [])];
    const r = await this.route(pts, avgSpeedKmh);
    const arrivals = new Map<string, Date>();
    let t = start.getTime();
    located.forEach((s, i) => {
      const leg = r.legs[depot ? i : i - 1];
      t += (leg?.minutes ?? 0) * 60_000;
      if (s.window && t < s.window.start.getTime()) t = s.window.start.getTime(); // wait for the window
      arrivals.set(s.id, new Date(t));
      t += s.serviceMinutes * 60_000;
    });
    const service = seq.reduce((sum, s) => sum + s.serviceMinutes, 0);
    return { order, arrivals, km: r.km, minutes: r.minutes + service, geometry: r.geometry, source: r.source };
  }

  /** Multi-vehicle assignment with capacities via VROOM; null when unavailable (caller falls back). */
  async assign(depot: LatLng | null, vehicles: OptVehicle[], jobs: (Omit<OptJob, 'location'> & { location: LatLng | null })[]): Promise<{ loads: { vehicleId: string; jobIds: string[] }[]; unassigned: string[] } | null> {
    const e = this.engine();
    if (!e || !depot || !vehicles.length || jobs.some((j) => !j.location)) return null;
    try {
      const r = await e.optimize(depot, vehicles, jobs as OptJob[]);
      return { loads: r.routes.filter((x) => x.jobIds.length).map((x) => ({ vehicleId: x.vehicleId, jobIds: x.jobIds })), unassigned: r.unassigned };
    } catch (err) {
      this.logger.warn(`VROOM assignment failed, using the greedy proposal: ${(err as Error).message}`);
      return null;
    }
  }
}
