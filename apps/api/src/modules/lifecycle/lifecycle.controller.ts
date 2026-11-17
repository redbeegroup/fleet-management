import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DisposeVehicleInput, disposeVehicleSchema, Permission, ReplacementPlanInput, replacementPlanSchema } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { LifecycleService } from './lifecycle.service';

@ApiTags('lifecycle')
@ApiBearerAuth()
@Controller()
export class LifecycleController {
  constructor(private readonly svc: LifecycleService) {}

  /** Replacement advice for the fleet, and recent disposals. */
  @Get('lifecycle/replacement')
  @RequirePermissions(Permission.VEHICLE_READ, Permission.COST_READ)
  replacement(@CurrentUser() user: AuthUser) {
    return this.svc.replacement(user);
  }

  @Get('vehicles/:id/lifecycle')
  @RequirePermissions(Permission.VEHICLE_READ, Permission.COST_READ)
  vehicle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.vehicle(user, id);
  }

  @Patch('vehicles/:id/replacement-plan')
  @RequirePermissions(Permission.VEHICLE_WRITE)
  plan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(replacementPlanSchema)) body: ReplacementPlanInput) {
    return this.svc.setPlan(user, id, body);
  }

  @Post('vehicles/:id/dispose')
  @RequirePermissions(Permission.VEHICLE_WRITE, Permission.COST_WRITE)
  dispose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(disposeVehicleSchema)) body: DisposeVehicleInput) {
    return this.svc.dispose(user, id, body);
  }
}
