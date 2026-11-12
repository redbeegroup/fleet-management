import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationSchema, Permission, TelemetryEventType } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { TelematicsService } from './telematics.service';

const historySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.from < v.to && v.to.getTime() - v.from.getTime() <= 7 * 86_400_000, {
    message: '`from` must be before `to` and the range at most 7 days',
  });

const eventsSchema = paginationSchema.extend({
  vehicleId: z.string().uuid().optional(),
  type: z.nativeEnum(TelemetryEventType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
export class TelematicsController {
  constructor(private readonly telematics: TelematicsService) {}

  @Get('live')
  @RequirePermissions(Permission.TRACKING_READ)
  live(@CurrentUser() user: AuthUser) {
    return this.telematics.live(user);
  }

  @Get('vehicles/:id/history')
  @RequirePermissions(Permission.TRACKING_READ)
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(historySchema)) q: { from: Date; to: Date },
  ) {
    return this.telematics.history(user, id, q.from, q.to);
  }

  @Get('events')
  @RequirePermissions(Permission.TRACKING_READ)
  events(@CurrentUser() user: AuthUser, @Query(new ZodPipe(eventsSchema)) q: z.infer<typeof eventsSchema>) {
    return this.telematics.listEvents(user, q);
  }
}
