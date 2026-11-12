import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateDriverInput,
  CreateDriverLicenseInput,
  createDriverLicenseSchema,
  createDriverSchema,
  PaginationInput,
  paginationSchema,
  Permission,
  UpdateDriverInput,
  updateDriverSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DriversService } from './drivers.service';

const listSchema = paginationSchema.extend({
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const expiringSchema = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) });

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions(Permission.DRIVER_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: PaginationInput & { active?: boolean }) {
    return this.drivers.list(user, q);
  }

  @Get('licenses/expiring')
  @RequirePermissions(Permission.DRIVER_READ)
  expiring(@CurrentUser() user: AuthUser, @Query(new ZodPipe(expiringSchema)) q: { days: number }) {
    return this.drivers.expiringLicenses(user, q.days);
  }

  @Get(':id')
  @RequirePermissions(Permission.DRIVER_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.get(user, id);
  }

  @Post()
  @RequirePermissions(Permission.DRIVER_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createDriverSchema)) body: CreateDriverInput) {
    return this.drivers.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DRIVER_WRITE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateDriverSchema)) body: UpdateDriverInput,
  ) {
    return this.drivers.update(user, id, body);
  }

  @Post(':id/licenses')
  @RequirePermissions(Permission.DRIVER_WRITE)
  addLicense(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createDriverLicenseSchema)) body: CreateDriverLicenseInput,
  ) {
    return this.drivers.addLicense(user, id, body);
  }

  @Delete(':id/licenses/:licenseId')
  @HttpCode(204)
  @RequirePermissions(Permission.DRIVER_WRITE)
  async removeLicense(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenseId', ParseUUIDPipe) licenseId: string,
  ) {
    await this.drivers.removeLicense(user, id, licenseId);
  }
}
