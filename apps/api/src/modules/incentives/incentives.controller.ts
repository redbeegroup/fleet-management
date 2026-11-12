import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateAdjustmentInput, createAdjustmentSchema, decideAdjustmentSchema, periodSchema, Permission, UpdateAdjustmentInput, updateAdjustmentSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { IncentivesService } from './incentives.service';

const listSchema = z.object({
  period: periodSchema.optional(),
  driverId: z.string().uuid().optional(),
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED']).optional(),
});
const periodQuery = z.object({ period: periodSchema });

@ApiTags('incentives')
@ApiBearerAuth()
@Controller('adjustments')
export class IncentivesController {
  constructor(private readonly incentives: IncentivesService) {}

  @Get()
  @RequirePermissions(Permission.INCENTIVE_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.incentives.list(user, q);
  }

  @Get('summary')
  @RequirePermissions(Permission.INCENTIVE_READ)
  summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(periodQuery)) q: { period: string }) {
    return this.incentives.summary(user, q.period);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @RequirePermissions(Permission.INCENTIVE_READ)
  csv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(periodQuery)) q: { period: string }) {
    return this.incentives.csv(user, q.period);
  }

  @Post()
  @RequirePermissions(Permission.INCENTIVE_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createAdjustmentSchema)) body: CreateAdjustmentInput) {
    return this.incentives.create(user, body);
  }

  /** Run the automatic safety-bonus rule for a period now (idempotent). */
  @Post('propose-safety-bonuses')
  @HttpCode(200)
  @RequirePermissions(Permission.INCENTIVE_WRITE)
  async propose(@CurrentUser() user: AuthUser, @Body(new ZodPipe(periodQuery)) body: { period: string }) {
    return { created: await this.incentives.proposeSafetyBonuses(user.companyId, body.period) };
  }

  @Patch(':id')
  @RequirePermissions(Permission.INCENTIVE_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateAdjustmentSchema)) body: UpdateAdjustmentInput) {
    return this.incentives.update(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.INCENTIVE_APPROVE)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideAdjustmentSchema)) body: { note?: string | null }) {
    return this.incentives.decide(user, id, 'APPROVED', body.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.INCENTIVE_APPROVE)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideAdjustmentSchema)) body: { note?: string | null }) {
    return this.incentives.decide(user, id, 'REJECTED', body.note);
  }
}
