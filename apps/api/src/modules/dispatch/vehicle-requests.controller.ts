import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateVehicleRequestInput, createVehicleRequestSchema, paginationSchema, Permission, scheduleVehicleRequestSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { VehicleRequestsService } from './vehicle-requests.service';

const listSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SCHEDULED', 'CANCELLED']).optional(),
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

@ApiTags('vehicle requests')
@ApiBearerAuth()
@Controller('vehicle-requests')
export class VehicleRequestsController {
  constructor(private readonly svc: VehicleRequestsService) {}

  /** Requesters see their own; vehicle-request:read sees all. */
  @Get()
  @RequirePermissions(Permission.VEHICLE_REQUEST_CREATE)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(Permission.VEHICLE_REQUEST_CREATE)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermissions(Permission.VEHICLE_REQUEST_CREATE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createVehicleRequestSchema)) body: CreateVehicleRequestInput) {
    return this.svc.create(user, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.VEHICLE_REQUEST_CREATE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(user, id);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_WRITE)
  schedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(scheduleVehicleRequestSchema)) body: { vehicleId: string; driverId: string }) {
    return this.svc.schedule(user, id, body);
  }
}
