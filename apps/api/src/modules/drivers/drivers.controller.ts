import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateDriverInput, createDriverSchema, PaginationInput, paginationSchema, Permission } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { DriversService } from './drivers.service';

const expiringSchema = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) });

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions(Permission.DRIVER_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: PaginationInput) {
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
}
