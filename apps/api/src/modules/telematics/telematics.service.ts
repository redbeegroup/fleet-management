import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TelemetryEventType } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { positionsIngested, telemetryEvents } from '../../common/observability/metrics';
import { RedisService } from '../../common/redis/redis.service';
import type { PositionFix } from './providers/telematics-provider';
import { haversineM, trackDistanceKm } from './rules/geo';
import { PersistedEvent, TelemetryRulesService } from './telemetry-rules.service';

export const LIVE_CHANNEL = (companyId: string) => `fms:live:${companyId}`;
export const EVENTS_CHANNEL = (companyId: string) => `fms:events:${companyId}`;

export interface LivePosition {
  vehicleId: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
}

@Injectable()
export class TelematicsService {
  private readonly logger = new Logger(TelematicsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly rules: TelemetryRulesService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Persists fixes from any provider: maps device → vehicle, appends to the
   * partitioned history table, upserts the latest position, runs the rules
   * engine, then (after commit) publishes live updates and sends alerts.
   * Returns the number of fixes stored.
   */
  async ingest(fixes: PositionFix[]): Promise<number> {
    if (!fixes.length) return 0;
    const { stored, latest, events } = await this.db.system(async (tx) => {
      const vehicles = await tx.vehicle.findMany({
        where: { gpsDeviceId: { in: [...new Set(fixes.map((f) => f.deviceId))] }, deletedAt: null },
        select: { id: true, companyId: true, gpsDeviceId: true, plateNumber: true, speedLimitKmh: true, odometerKm: true },
      });
      const byDevice = new Map(vehicles.map((v) => [v.gpsDeviceId!, v]));
      const rows = fixes.flatMap((f) => {
        const v = byDevice.get(f.deviceId);
        return v ? [{ f, v }] : [];
      });
      if (!rows.length) return { stored: 0, latest: [], events: [] as PersistedEvent[] };

      await tx.$executeRaw`
        INSERT INTO vehicle_positions
          (company_id, vehicle_id, recorded_at, latitude, longitude, speed_kmh, heading, altitude_m, ignition, odometer_km, attributes)
        VALUES ${Prisma.join(
          rows.map(
            ({ f, v }) => Prisma.sql`(${v.companyId}::uuid, ${v.id}::uuid, ${f.recordedAt}, ${f.latitude}, ${f.longitude},
              ${f.speedKmh ?? null}, ${f.heading ?? null}, ${f.altitudeM ?? null}, ${f.ignition ?? null},
              ${f.odometerKm ?? null}, ${f.attributes ? JSON.stringify(f.attributes) : null}::jsonb)`,
          ),
        )}
        ON CONFLICT DO NOTHING`;

      // Newest fix per vehicle, only if newer than what we already have.
      const newest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const cur = newest.get(r.v.id);
        if (!cur || cur.f.recordedAt < r.f.recordedAt) newest.set(r.v.id, r);
      }
      const existing = new Map(
        (await tx.vehicleLastPosition.findMany({ where: { vehicleId: { in: [...newest.keys()] } }, select: { vehicleId: true, recordedAt: true } })).map(
          (p) => [p.vehicleId, p.recordedAt],
        ),
      );
      const latest: (LivePosition & { companyId: string })[] = [];
      for (const { f, v } of newest.values()) {
        const prev = existing.get(v.id);
        if (prev && prev >= f.recordedAt) continue;
        const data = {
          companyId: v.companyId,
          recordedAt: f.recordedAt,
          latitude: f.latitude,
          longitude: f.longitude,
          speedKmh: f.speedKmh ?? null,
          heading: f.heading ?? null,
          ignition: f.ignition ?? null,
        };
        await tx.vehicleLastPosition.upsert({ where: { vehicleId: v.id }, create: { vehicleId: v.id, ...data }, update: data });
        latest.push({ vehicleId: v.id, ...data });
        // Devices that report an odometer keep the vehicle's odometer current (never moves backwards).
        if (f.odometerKm != null && f.odometerKm > Number(v.odometerKm)) {
          await tx.vehicle.update({ where: { id: v.id }, data: { odometerKm: f.odometerKm } });
        }
      }

      const batches = new Map<string, { vehicle: (typeof vehicles)[number]; fixes: PositionFix[] }>();
      for (const { f, v } of rows) {
        const b = batches.get(v.id) ?? { vehicle: v, fixes: [] };
        b.fixes.push(f);
        batches.set(v.id, b);
      }
      const events = await this.rules.apply(tx, [...batches.values()]);
      return { stored: rows.length, latest, events };
    });

    positionsIngested.inc(stored);
    for (const e of events) telemetryEvents.inc({ type: e.type });
    await this.publish(latest, events);
    await this.rules.notify(events);
    return stored;
  }

  /** Periodic GPS-offline detection (worker job). */
  async checkOffline(now = new Date()): Promise<number> {
    const events = await this.db.system((tx) => this.rules.checkOffline(tx, now));
    await this.publish([], events);
    await this.rules.notify(events);
    return events.length;
  }

  private async publish(latest: (LivePosition & { companyId: string })[], events: PersistedEvent[]) {
    try {
      const r = this.redis.client;
      if (r.status === 'wait') await r.connect();
      const group = <T extends { companyId: string }>(items: T[]) => {
        const m = new Map<string, T[]>();
        for (const it of items) m.set(it.companyId, [...(m.get(it.companyId) ?? []), it]);
        return m;
      };
      for (const [companyId, items] of group(latest)) {
        await r.publish(LIVE_CHANNEL(companyId), JSON.stringify(items.map(({ companyId: _c, ...p }) => p)));
      }
      for (const [companyId, items] of group(events)) {
        await r.publish(
          EVENTS_CHANNEL(companyId),
          JSON.stringify(items.map((e) => ({ id: e.id, type: e.type, vehicleId: e.vehicleId, plateNumber: e.plateNumber, occurredAt: e.occurredAt, speedKmh: e.speedKmh, data: e.data }))),
        );
      }
    } catch (err) {
      this.logger.warn(`Live publish failed: ${(err as Error).message}`);
    }
  }

  /** Latest known position of every vehicle in the company (initial live-map load). */
  async live(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [positions, vehicles] = await Promise.all([
        tx.vehicleLastPosition.findMany(),
        tx.vehicle.findMany({
          where: { deletedAt: null },
          select: { id: true, plateNumber: true, status: true, vehicleClass: true },
        }),
      ]);
      const byId = new Map(vehicles.map((v) => [v.id, v]));
      const staleAfter = Date.now() - 15 * 60_000;
      return positions
        .filter((p) => byId.has(p.vehicleId))
        .map((p) => ({ ...p, vehicle: byId.get(p.vehicleId), offline: p.recordedAt.getTime() < staleAfter }));
    });
  }

  /** Track for playback plus trip summary (distance, speeds, stops) and events in range. */
  history(user: AuthUser, vehicleId: string, from: Date, to: Date) {
    return this.db.tenant(user.companyId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { id: true, plateNumber: true } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      const rows = await tx.$queryRaw<
        { recorded_at: Date; latitude: number; longitude: number; speed_kmh: number | null; ignition: boolean | null }[]
      >`SELECT recorded_at, latitude, longitude, speed_kmh, ignition
          FROM vehicle_positions
         WHERE vehicle_id = ${vehicleId}::uuid AND recorded_at BETWEEN ${from} AND ${to}
         ORDER BY recorded_at
         LIMIT 50000`;
      const points = rows.map((r) => ({
        recordedAt: r.recorded_at,
        latitude: r.latitude,
        longitude: r.longitude,
        speedKmh: r.speed_kmh,
        ignition: r.ignition,
      }));
      const events = await tx.telemetryEvent.findMany({
        where: { vehicleId, occurredAt: { gte: from, lte: to }, type: { notIn: ['IGNITION_ON', 'IGNITION_OFF'] } },
        orderBy: { occurredAt: 'asc' },
      });
      return { vehicle, points, events, summary: summarize(points) };
    });
  }

  listEvents(
    user: AuthUser,
    q: { vehicleId?: string; type?: TelemetryEventType; from?: Date; to?: Date; page: number; pageSize: number },
  ) {
    const where: Prisma.TelemetryEventWhereInput = {
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.type ? { type: q.type } : { type: { notIn: ['IGNITION_ON', 'IGNITION_OFF'] } }),
      ...((q.from || q.to) && { occurredAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.telemetryEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.telemetryEvent.count({ where }),
      ]);
      const vehicles = await tx.vehicle.findMany({
        where: { id: { in: [...new Set(items.map((i) => i.vehicleId))] } },
        select: { id: true, plateNumber: true },
      });
      const plate = new Map(vehicles.map((v) => [v.id, v.plateNumber]));
      return { items: items.map((i) => ({ ...i, plateNumber: plate.get(i.vehicleId) ?? null })), total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Ensures monthly partitions exist for the current and next month. */
  async maintainPartitions(): Promise<void> {
    await this.db.system(async (tx) => {
      await tx.$queryRaw`SELECT fms_ensure_position_partition(current_date)`;
      await tx.$queryRaw`SELECT fms_ensure_position_partition((current_date + interval '1 month')::date)`;
    });
    this.logger.log('Position partitions ensured');
  }
}

/** Trip summary from an ordered track. Stops = ≥ 5 min below 3 km/h. */
export function summarize(points: { recordedAt: Date; latitude: number; longitude: number; speedKmh: number | null }[]) {
  if (!points.length) return { distanceKm: 0, maxSpeedKmh: 0, avgMovingSpeedKmh: 0, movingMinutes: 0, stops: 0, from: null, to: null };
  let movingMs = 0;
  let stops = 0;
  let stopStart: Date | null = null;
  let movingKm = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.recordedAt.getTime() - a.recordedAt.getTime();
    if ((a.speedKmh ?? 0) >= 3) {
      movingMs += dt;
      movingKm += haversineM(a.latitude, a.longitude, b.latitude, b.longitude) / 1000;
      if (stopStart && a.recordedAt.getTime() - stopStart.getTime() >= 5 * 60_000) stops++;
      stopStart = null;
    } else {
      stopStart ??= a.recordedAt;
    }
  }
  const movingMinutes = Math.round(movingMs / 60_000);
  return {
    distanceKm: Math.round(trackDistanceKm(points) * 10) / 10,
    maxSpeedKmh: Math.round(Math.max(...points.map((p) => p.speedKmh ?? 0))),
    avgMovingSpeedKmh: movingMs ? Math.round(movingKm / (movingMs / 3_600_000)) : 0,
    movingMinutes,
    stops,
    from: points[0].recordedAt,
    to: points[points.length - 1].recordedAt,
  };
}
