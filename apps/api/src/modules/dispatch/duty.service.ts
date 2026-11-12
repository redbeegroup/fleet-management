import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { dayBounds } from '../../common/time';

/** Driver duty sessions (attendance). */
@Injectable()
export class DutyService {
  constructor(private readonly db: PrismaService) {}

  async start(user: AuthUser, driverId: string, source: string, at = new Date()) {
    try {
      return await this.db.tenant(user.companyId, async (tx) => {
        const driver = await tx.driver.findFirst({ where: { id: driverId } });
        if (!driver) throw new NotFoundException('Driver not found');
        if (!driver.active) throw new BadRequestException('Driver is inactive');
        return tx.dutySession.create({ data: { companyId: user.companyId, driverId, startedAt: at, source, createdBy: user.userId } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Driver is already on duty');
      }
      throw err;
    }
  }

  end(user: AuthUser, driverId: string, at = new Date()) {
    return this.db.tenant(user.companyId, async (tx) => {
      const open = await tx.dutySession.findFirst({ where: { driverId, endedAt: null } });
      if (!open) throw new ConflictException('Driver is not on duty');
      if (at < open.startedAt) throw new BadRequestException('End is before start');
      return tx.dutySession.update({ where: { id: open.id }, data: { endedAt: at } });
    });
  }

  current(user: AuthUser, driverId: string) {
    return this.db.tenant(user.companyId, (tx) => tx.dutySession.findFirst({ where: { driverId, endedAt: null } }));
  }

  /** Attendance for one local day: on-duty minutes per driver (sessions clipped to the day). */
  attendance(user: AuthUser, day: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const { start, end } = dayBounds(day, company.timezone);
      const [drivers, sessions, trips] = await Promise.all([
        tx.driver.findMany({ where: { active: true }, select: { id: true, fullName: true, employeeNo: true }, orderBy: { fullName: 'asc' } }),
        tx.dutySession.findMany({
          where: { startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
          orderBy: { startedAt: 'asc' },
        }),
        tx.trip.groupBy({
          by: ['driverId'],
          where: { status: 'COMPLETED', actualEnd: { gte: start, lt: end } },
          _count: { _all: true },
        }),
      ]);
      const now = new Date();
      const tripsBy = new Map(trips.map((t) => [t.driverId, t._count._all]));
      return {
        day,
        timezone: company.timezone,
        drivers: drivers.map((d) => {
          const mine = sessions.filter((s) => s.driverId === d.id);
          const minutes = mine.reduce((sum, s) => {
            const a = Math.max(s.startedAt.getTime(), start.getTime());
            const b = Math.min((s.endedAt ?? now).getTime(), end.getTime());
            return sum + Math.max(0, b - a) / 60_000;
          }, 0);
          return {
            ...d,
            present: mine.length > 0,
            onDutyNow: mine.some((s) => !s.endedAt),
            firstIn: mine[0]?.startedAt ?? null,
            lastOut: mine.length && mine.every((s) => s.endedAt) ? mine[mine.length - 1].endedAt : null,
            dutyMinutes: Math.round(minutes),
            completedTrips: tripsBy.get(d.id) ?? 0,
            sessions: mine.map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, source: s.source })),
          };
        }),
      };
    });
  }
}
