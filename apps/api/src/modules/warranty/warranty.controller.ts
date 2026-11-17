import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateWarrantyClaimInput,
  createWarrantyClaimSchema,
  Permission,
  UpdateWarrantyClaimInput,
  updateWarrantyClaimSchema,
  VehicleWarrantyInput,
  vehicleWarrantySchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { WarrantyService } from './warranty.service';

const partialWarranty = z.object({
  component: z.string().max(20).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  endKm: z.number().nonnegative().nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  fileId: z.string().uuid().nullable().optional(),
});

@ApiTags('warranty')
@ApiBearerAuth()
@Controller()
export class WarrantyController {
  constructor(private readonly svc: WarrantyService) {}

  @Get('warranties')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ vehicleId: z.string().uuid().optional() }))) q: { vehicleId?: string }) {
    return this.svc.list(user, q.vehicleId);
  }

  @Post('vehicles/:id/warranties')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(vehicleWarrantySchema)) body: VehicleWarrantyInput) {
    return this.svc.create(user, id, body);
  }

  @Patch('warranties/:id')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(partialWarranty)) body: Partial<VehicleWarrantyInput>) {
    return this.svc.update(user, id, body);
  }

  @Delete('warranties/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(user, id);
  }

  @Get('maintenance/work-orders/:id/warranty')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  forWorkOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.forWorkOrder(user, id);
  }

  @Get('warranty-claims')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  claims(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ status: z.string().max(20).optional(), vehicleId: z.string().uuid().optional() }))) q: { status?: string; vehicleId?: string }) {
    return this.svc.claims(user, q);
  }

  @Post('warranty-claims')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  createClaim(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createWarrantyClaimSchema)) body: CreateWarrantyClaimInput) {
    return this.svc.createClaim(user, body);
  }

  @Patch('warranty-claims/:id')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  updateClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateWarrantyClaimSchema)) body: UpdateWarrantyClaimInput) {
    return this.svc.updateClaim(user, id, body);
  }
}
