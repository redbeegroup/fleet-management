import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AssignTripInput,
  assignTripSchema,
  availabilityQuerySchema,
  CancelTripInput,
  cancelTripSchema,
  CompleteTripInput,
  completeTripSchema,
  CreateTripInput,
  createTripSchema,
  paginationSchema,
  Permission,
  StartTripInput,
  startTripSchema,
  TripStatus,
  UpdateTripInput,
  updateTripSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DutyService } from './duty.service';
import { TripListQuery, TripsService } from './trips.service';

const listSchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.nativeEnum(TripStatus).optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
const availabilitySchema = availabilityQuerySchema.and(z.object({ vehicleId: z.string().uuid().optional() }));
const daySchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const dutySchema = z.object({ action: z.enum(['start', 'end']), at: z.coerce.date().optional() });

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @RequirePermissions(Permission.TRIP_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: TripListQuery) {
    return this.trips.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(Permission.TRIP_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(user, id);
  }

  @Post()
  @RequirePermissions(Permission.TRIP_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createTripSchema)) body: CreateTripInput) {
    return this.trips.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TRIP_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateTripSchema)) body: UpdateTripInput) {
    return this.trips.update(user, id, body);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_WRITE)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assignTripSchema)) body: AssignTripInput) {
    return this.trips.assign(user, id, body);
  }

  @Delete(':id/assign')
  @RequirePermissions(Permission.TRIP_WRITE)
  unassign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.unassign(user, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_WRITE)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(startTripSchema)) body: StartTripInput) {
    return this.trips.start(user, id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_WRITE)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeTripSchema)) body: CompleteTripInput) {
    return this.trips.complete(user, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_WRITE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelTripSchema)) body: CancelTripInput) {
    return this.trips.cancel(user, id, body);
  }
}

@ApiTags('dispatch')
@ApiBearerAuth()
@Controller()
export class DispatchController {
  constructor(
    private readonly trips: TripsService,
    private readonly duty: DutyService,
  ) {}

  @Get('dispatch/availability')
  @RequirePermissions(Permission.TRIP_READ, Permission.VEHICLE_READ, Permission.DRIVER_READ)
  availability(@CurrentUser() user: AuthUser, @Query(new ZodPipe(availabilitySchema)) q: z.infer<typeof availabilitySchema>) {
    return this.trips.availability(user, q);
  }

  @Get('dispatch/attendance')
  @RequirePermissions(Permission.DRIVER_READ)
  attendance(@CurrentUser() user: AuthUser, @Query(new ZodPipe(daySchema)) q: { day: string }) {
    return this.duty.attendance(user, q.day);
  }

  /** Clock a driver on/off duty on their behalf (supervisor). */
  @Post('drivers/:id/duty')
  @RequirePermissions(Permission.DRIVER_WRITE)
  dutyAction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(dutySchema)) body: z.infer<typeof dutySchema>) {
    return body.action === 'start' ? this.duty.start(user, id, 'web', body.at) : this.duty.end(user, id, body.at);
  }
}
