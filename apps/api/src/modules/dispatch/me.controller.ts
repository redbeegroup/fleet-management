import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompleteTripInput, completeTripSchema, Permission, StartTripInput, startTripSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DutyService } from './duty.service';
import { tripInclude, TripsService } from './trips.service';

const scopeSchema = z.object({ scope: z.enum(['active', 'recent']).default('active') });

/**
 * Driver self-service (mobile app). Every call resolves the driver record linked
 * to the signed-in user; drivers only ever see and act on their own trips.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly db: PrismaService,
    private readonly trips: TripsService,
    private readonly duty: DutyService,
  ) {}

  private async driverId(user: AuthUser): Promise<string> {
    const d = await this.db.tenant(user.companyId, (tx) => tx.driver.findFirst({ where: { userId: user.userId, active: true }, select: { id: true } }));
    if (!d) throw new ForbiddenException('Your login is not linked to an active driver profile');
    return d.id;
  }

  @Get('driver')
  @RequirePermissions(Permission.TRIP_READ)
  async profile(@CurrentUser() user: AuthUser) {
    const id = await this.driverId(user);
    return this.db.tenant(user.companyId, async (tx) => ({
      driver: await tx.driver.findUniqueOrThrow({
        where: { id },
        include: {
          licenses: { orderBy: { expiresAt: 'desc' } },
          assignments: { where: { endAt: null }, include: { vehicle: { select: { id: true, plateNumber: true, make: true, model: true } } } },
        },
      }),
      onDuty: await tx.dutySession.findFirst({ where: { driverId: id, endedAt: null } }),
    }));
  }

  @Get('trips')
  @RequirePermissions(Permission.TRIP_READ)
  async myTrips(@CurrentUser() user: AuthUser, @Query(new ZodPipe(scopeSchema)) q: { scope: 'active' | 'recent' }) {
    const driverId = await this.driverId(user);
    return this.db.tenant(user.companyId, (tx) =>
      tx.trip.findMany({
        where:
          q.scope === 'active'
            ? { driverId, status: { in: ['ASSIGNED', 'ONGOING'] } }
            : { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
        include: tripInclude,
        orderBy: { plannedStart: q.scope === 'active' ? 'asc' : 'desc' },
        take: 50,
      }),
    );
  }

  @Post('trips/:id/start')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_READ)
  async start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(startTripSchema)) body: StartTripInput) {
    return this.trips.start(user, id, body, await this.driverId(user));
  }

  @Post('trips/:id/complete')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_READ)
  async complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeTripSchema)) body: CompleteTripInput) {
    return this.trips.complete(user, id, body, await this.driverId(user));
  }

  @Post('duty/start')
  @RequirePermissions(Permission.TRIP_READ)
  async dutyStart(@CurrentUser() user: AuthUser) {
    return this.duty.start(user, await this.driverId(user), 'app');
  }

  @Post('duty/end')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_READ)
  async dutyEnd(@CurrentUser() user: AuthUser) {
    return this.duty.end(user, await this.driverId(user));
  }
}
