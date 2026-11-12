import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import type { PositionFix } from './providers/telematics-provider';

@Injectable()
export class TelematicsService {
  private readonly logger = new Logger(TelematicsService.name);

  constructor(private readonly db: PrismaService) {}

  /**
   * Persists fixes from any provider: maps device → vehicle, appends to the
   * partitioned history table and upserts the latest position.
   * Returns the number of fixes stored.
   */
  async ingest(fixes: PositionFix[]): Promise<number> {
    if (!fixes.length) return 0;
    return this.db.system(async (tx) => {
      const vehicles = await tx.vehicle.findMany({
        where: { gpsDeviceId: { in: [...new Set(fixes.map((f) => f.deviceId))] }, deletedAt: null },
        select: { id: true, companyId: true, gpsDeviceId: true },
      });
      const byDevice = new Map(vehicles.map((v) => [v.gpsDeviceId!, v]));
      const rows = fixes.flatMap((f) => {
        const v = byDevice.get(f.deviceId);
        return v ? [{ f, v }] : [];
      });
      if (!rows.length) return 0;

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

      // Keep only the newest fix per vehicle for the "last position" table.
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const cur = latest.get(r.v.id);
        if (!cur || cur.f.recordedAt < r.f.recordedAt) latest.set(r.v.id, r);
      }
      for (const { f, v } of latest.values()) {
        const data = {
          companyId: v.companyId,
          recordedAt: f.recordedAt,
          latitude: f.latitude,
          longitude: f.longitude,
          speedKmh: f.speedKmh ?? null,
          heading: f.heading ?? null,
          ignition: f.ignition ?? null,
        };
        await tx.vehicleLastPosition.upsert({
          where: { vehicleId: v.id },
          create: { vehicleId: v.id, ...data },
          update: data,
        });
      }
      return rows.length;
    });
  }

  /** Latest known position of every vehicle in the company (live map). */
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

  /** Position history for trip playback. */
  history(user: AuthUser, vehicleId: string, from: Date, to: Date) {
    return this.db.tenant(
      user.companyId,
      (tx) => tx.$queryRaw<
        { recorded_at: Date; latitude: number; longitude: number; speed_kmh: number | null; ignition: boolean | null }[]
      >`SELECT recorded_at, latitude, longitude, speed_kmh, ignition
          FROM vehicle_positions
         WHERE vehicle_id = ${vehicleId}::uuid AND recorded_at BETWEEN ${from} AND ${to}
         ORDER BY recorded_at
         LIMIT 20000`,
    );
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
