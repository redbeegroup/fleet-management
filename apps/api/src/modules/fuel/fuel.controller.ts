import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateFuelRecordInput, createFuelRecordSchema, paginationSchema, Permission } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { FuelListQuery, FuelService } from './fuel.service';

const listSchema = paginationSchema.extend({
  vehicleId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  flagged: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const rangeSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((r) => r.to > r.from, { path: ['to'], message: '`to` must be after `from`' });

@ApiTags('fuel')
@ApiBearerAuth()
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get('records')
  @RequirePermissions(Permission.FUEL_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: FuelListQuery) {
    return this.fuel.list(user, q);
  }

  @Post('records')
  @RequirePermissions(Permission.FUEL_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createFuelRecordSchema)) body: CreateFuelRecordInput) {
    return this.fuel.create(user, body);
  }

  @Delete('records/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.FUEL_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.fuel.remove(user, id);
  }

  @Get('summary')
  @RequirePermissions(Permission.FUEL_READ)
  summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeSchema)) q: { from: Date; to: Date }) {
    return this.fuel.summary(user, q.from, q.to);
  }
}
