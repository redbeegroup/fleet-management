import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InspectionKind, Permission, TireChangeInput, tireChangeSchema, TireCheckInput, tireCheckSchema, TireRotateInput, tireRotateSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { TiresService } from './tires.service';

const templateSchema = z.object({
  layout: z.string().max(20),
  name: z.string().trim().min(2).max(120).optional(),
  vehicleClasses: z.array(z.string().trim().toUpperCase()).default([]),
  kind: z.enum([InspectionKind.PRE_TRIP, InspectionKind.PERIODIC]).default('PERIODIC'),
});

@ApiTags('tires')
@ApiBearerAuth()
@Controller()
export class TiresController {
  constructor(private readonly tires: TiresService) {}

  @Get('tires')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  fleet(@CurrentUser() user: AuthUser) {
    return this.tires.fleet(user);
  }

  @Get('vehicles/:id/tires')
  @RequirePermissions(Permission.VEHICLE_READ)
  vehicle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tires.vehicleTires(user, id);
  }

  @Patch('vehicles/:id/tires/layout')
  @RequirePermissions(Permission.VEHICLE_WRITE)
  layout(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ layout: z.string().max(20).nullable() }))) body: { layout: string | null }) {
    return this.tires.setLayout(user, id, body.layout);
  }

  @Post('vehicles/:id/tires/changes')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  change(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(tireChangeSchema)) body: TireChangeInput) {
    return this.tires.change(user, id, body);
  }

  @Post('vehicles/:id/tires/rotate')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  rotate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(tireRotateSchema)) body: TireRotateInput) {
    return this.tires.rotate(user, id, body);
  }

  @Post('vehicles/:id/tires/checks')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  check(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(tireCheckSchema)) body: TireCheckInput) {
    return this.tires.check(user, id, body);
  }

  /** Checklist with tread and pressure items for every position of a layout. */
  @Post('inspection-templates/tires')
  @RequirePermissions(Permission.INSPECTION_WRITE)
  template(@CurrentUser() user: AuthUser, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.tires.createTireTemplate(user, body);
  }
}
