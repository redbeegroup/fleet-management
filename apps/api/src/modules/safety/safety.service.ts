import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { dayBounds, localDate } from '../../common/time';
import { NotificationsService } from '../notifications/notifications.service';
import { attributeDistance, DriverSafetyAgg, safetyScore } from './score';

const DAY = 86_400_000;
const HARSH = ['OVERSPEED', 'HARSH_BRAKE', 'HARSH_ACCEL', 'HARSH_CORNER', 'IDLE'] as const;

export interface Range {
  from: string;
  to: string;
}

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Scores for every active driver over local days [from, to]. */
  scores(user: AuthUser, q: Range) {
    return this.db.tenant(user.companyId, (tx) => this.compute(tx, q));
  }

  /** Scores for a company outside a request (jobs). */
  scoresFor(companyId: string, q: Range) {
    return this.db.tenant(companyId, (tx) => this.compute(tx, q));
  }

  async driver(user: AuthUser, driverId: string, q: Range) {
    return this.db.tenant(user.companyId, async (tx) => {
      const d = await tx.driver.findFirst({ where: { id: driverId }, select: { id: true } });
      if (!d) throw new NotFoundException('Driver not found');
      const all = await this.compute(tx, q, [driverId]);
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const { start } = dayBounds(q.from, company.timezone);
      const { end } = dayBounds(q.to, company.timezone);
      const events = await tx.telemetryEvent.findMany({
        where: { driverId, occurredAt: { gte: start, lt: end }, type: { in: [...HARSH] } },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      });
      const plates = new Map(
        (await tx.vehicle.findMany({ where: { id: { in: [...new Set(events.map((e) => e.vehicleId))] } }, select: { id: true, plateNumber: true } })).map((v) => [v.id, v.plateNumber]),
      );
      return { ...all.drivers[0], recentEvents: events.map((e) => ({ ...e, plateNumber: plates.get(e.vehicleId) ?? null })) };
    });
  }

  private async compute(tx: Tx, q: Range, onlyDriverIds?: string[]) {
    const company = await tx.company.findFirstOrThrow({ select: { timezone: true, settings: true } });
    const tz = company.timezone;
    const settings = parseCompanySettings(company.settings).safety;
    const start = dayBounds(q.from, tz).start;
    const end = dayBounds(q.to, tz).end;
    const [drivers, stats, trips, assignments, events] = await Promise.all([
      tx.driver.findMany({
        where: { active: true, ...(onlyDriverIds && { id: { in: onlyDriverIds } }) },
        select: { id: true, fullName: true, employeeNo: true },
        orderBy: { fullName: 'asc' },
      }),
      tx.vehicleDailyStat.findMany({ where: { day: { gte: new Date(q.from), lte: new Date(q.to) } }, select: { vehicleId: true, day: true, distanceKm: true } }),
      tx.trip.findMany({
        where: { status: { in: ['ONGOING', 'COMPLETED'] }, actualStart: { gte: new Date(start.getTime() - DAY), lt: end }, driverId: { not: null }, vehicleId: { not: null } },
        select: { vehicleId: true, driverId: true, actualStart: true, gpsDistanceKm: true },
      }),
      tx.vehicleAssignment.findMany({
        where: { driverId: { not: null }, startAt: { lt: end }, OR: [{ endAt: null }, { endAt: { gt: start } }] },
        select: { vehicleId: true, driverId: true, startAt: true, endAt: true },
      }),
      tx.telemetryEvent.groupBy({
        by: ['driverId', 'type'],
        where: { occurredAt: { gte: start, lt: end }, driverId: { not: null }, type: { in: [...HARSH] } },
        _count: { _all: true },
      }),
    ]);
    const idle = await tx.telemetryEvent.findMany({
      where: { type: 'IDLE', occurredAt: { gte: start, lt: end }, driverId: { not: null } },
      select: { driverId: true, data: true, occurredAt: true, endedAt: true },
    });

    const km = attributeDistance(
      stats.map((x) => ({ vehicleId: x.vehicleId, day: x.day.toISOString().slice(0, 10), distanceKm: Number(x.distanceKm) })),
      trips.map((t) => ({ vehicleId: t.vehicleId!, driverId: t.driverId!, day: localDate(t.actualStart!, tz), gpsDistanceKm: t.gpsDistanceKm ? Number(t.gpsDistanceKm) : null })),
      assignments.map((a) => ({ vehicleId: a.vehicleId, driverId: a.driverId!, from: a.startAt, to: a.endAt })),
      (day) => new Date(dayBounds(day, tz).start.getTime() + DAY / 2),
    );
    const count = (driverId: string, type: string) => events.find((e) => e.driverId === driverId && e.type === type)?._count._all ?? 0;
    const idleMin = (driverId: string) =>
      idle
        .filter((e) => e.driverId === driverId)
        .reduce((s, e) => s + Number((e.data as { durationMin?: number } | null)?.durationMin ?? (e.endedAt ? (e.endedAt.getTime() - e.occurredAt.getTime()) / 60_000 : 0)), 0);

    const rows = drivers.map((d) => {
      const agg: DriverSafetyAgg = {
        distanceKm: Math.round((km.get(d.id) ?? 0) * 10) / 10,
        overspeed: count(d.id, 'OVERSPEED'),
        harshBrake: count(d.id, 'HARSH_BRAKE'),
        harshAccel: count(d.id, 'HARSH_ACCEL'),
        harshCorner: count(d.id, 'HARSH_CORNER'),
        idleMinutes: Math.round(idleMin(d.id)),
      };
      return { ...d, ...agg, ...safetyScore(agg, settings) };
    });
    const scored = rows.filter((r) => r.score !== null);
    const totalKm = scored.reduce((s, r) => s + r.distanceKm, 0);
    return {
      range: { ...q, timezone: tz },
      settings,
      fleet: {
        drivers: rows.length,
        scoredDrivers: scored.length,
        averageScore: totalKm ? Math.round(scored.reduce((s, r) => s + r.score! * r.distanceKm, 0) / totalKm) : null,
        belowThreshold: scored.filter((r) => r.score! < settings.alertBelow).length,
        distanceKm: Math.round(rows.reduce((s, r) => s + r.distanceKm, 0)),
        events: {
          overspeed: rows.reduce((s, r) => s + r.overspeed, 0),
          harshBrake: rows.reduce((s, r) => s + r.harshBrake, 0),
          harshAccel: rows.reduce((s, r) => s + r.harshAccel, 0),
          harshCorner: rows.reduce((s, r) => s + r.harshCorner, 0),
        },
      },
      drivers: rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    };
  }

  /** Daily: alert managers about drivers below the threshold (last 30 days), once per ISO week. */
  async lowScoreAlerts(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, timezone: true } }));
    let sent = 0;
    for (const c of companies) {
      const to = localDate(now, c.timezone);
      const from = localDate(new Date(now.getTime() - 29 * DAY), c.timezone);
      const res = await this.db.tenant(c.id, (tx) => this.compute(tx, { from, to }));
      const week = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / DAY + 1) / 7)}`;
      for (const d of res.drivers.filter((r) => r.score !== null && r.score < res.settings.alertBelow)) {
        sent += await this.notifications.notify({
          companyId: c.id,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
          topic: 'safety.low_score',
          severity: 'warning',
          title: `Safety score ${d.score} — ${d.fullName}`,
          body: `${d.fullName} (${d.employeeNo}) scored ${d.score} over the last 30 days: ${d.overspeed} overspeed, ${d.harshBrake} harsh braking, ${d.harshAccel} harsh acceleration, ${d.harshCorner} harsh cornering events in ${d.distanceKm} km.`,
          data: { driverId: d.id, link: `/drivers/${d.id}` },
          dedupeKey: `safety-low:${d.id}:${week}`,
        });
      }
    }
    this.logger.log(`Safety low-score alerts: ${sent}`);
    return sent;
  }
}
