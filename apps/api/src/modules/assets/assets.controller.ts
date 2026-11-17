import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MeterReadingInput, meterReadingSchema, Permission, tripTrailerSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AssetsService } from './assets.service';

@ApiTags('assets')
@ApiBearerAuth()
@Controller()
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Get('vehicles/:id/meter-readings')
  @RequirePermissions(Permission.VEHICLE_READ)
  readings(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.readings(user, id);
  }

  @Post('vehicles/:id/meter-readings')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  addReading(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(meterReadingSchema)) body: MeterReadingInput) {
    return this.svc.addReading(user, id, body);
  }

  @Get('trailers')
  @RequirePermissions(Permission.VEHICLE_READ)
  trailers(@CurrentUser() user: AuthUser) {
    return this.svc.trailers(user);
  }

  /** Dispatcher couples a trailer to a planned / assigned trip (null removes it). */
  @Patch('trips/:id/trailer')
  @RequirePermissions(Permission.TRIP_WRITE)
  trailer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(tripTrailerSchema)) body: { trailerId: string | null }) {
    return this.svc.setTrailer(user, id, body.trailerId);
  }

  /** Manual coupling outside trips (null tractor = uncouple). */
  @Post('vehicles/:id/couple')
  @RequirePermissions(Permission.TRIP_WRITE)
  couple(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ tractorId: z.string().uuid().nullable() }))) body: { tractorId: string | null }) {
    return this.svc.couple(user, id, body.tractorId);
  }

  @Get('vehicles/:id/couplings')
  @RequirePermissions(Permission.VEHICLE_READ)
  couplings(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.couplings(user, id);
  }
}
