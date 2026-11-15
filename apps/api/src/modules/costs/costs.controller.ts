import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { budgetQuerySchema, copyBudgetsSchema, CostQuery, costQuerySchema, CreateSharedCostInput, createSharedCostSchema, Permission, UpsertBudgetsInput, upsertBudgetsSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CostsService } from './costs.service';

@ApiTags('costs')
@ApiBearerAuth()
@Controller()
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get('costs/budgets')
  @RequirePermissions(Permission.BUDGET_READ)
  budgets(@CurrentUser() user: AuthUser, @Query(new ZodPipe(budgetQuerySchema)) q: z.infer<typeof budgetQuerySchema>) {
    return this.costs.budgets(user, q.year, q.dimension);
  }

  @Put('costs/budgets')
  @RequirePermissions(Permission.BUDGET_WRITE)
  upsert(@CurrentUser() user: AuthUser, @Body(new ZodPipe(upsertBudgetsSchema)) body: UpsertBudgetsInput) {
    return this.costs.upsertBudgets(user, body);
  }

  @Post('costs/budgets/copy')
  @RequirePermissions(Permission.BUDGET_WRITE)
  copy(@CurrentUser() user: AuthUser, @Body(new ZodPipe(copyBudgetsSchema)) body: z.infer<typeof copyBudgetsSchema>) {
    return this.costs.copyBudgets(user, body);
  }

  @Get('costs/shared')
  @RequirePermissions(Permission.COST_READ)
  shared(@CurrentUser() user: AuthUser, @Query(new ZodPipe(costQuerySchema)) q: CostQuery) {
    return this.costs.listShared(user, q);
  }

  @Post('costs/shared')
  @RequirePermissions(Permission.COST_WRITE)
  createShared(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSharedCostSchema)) body: CreateSharedCostInput) {
    return this.costs.createShared(user, body);
  }

  @Delete('costs/shared/:id')
  @RequirePermissions(Permission.COST_WRITE)
  deleteShared(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.costs.deleteShared(user, id);
  }

  @Get('mobile/manager-summary')
  @RequirePermissions(Permission.APPROVAL_DECIDE)
  managerSummary(@CurrentUser() user: AuthUser) {
    return this.costs.managerSummary(user);
  }

  @Get('analytics/tco')
  @RequirePermissions(Permission.COST_READ)
  tco(@CurrentUser() user: AuthUser, @Query(new ZodPipe(costQuerySchema)) q: CostQuery) {
    return this.costs.tco(user, q);
  }

  @Get('analytics/tco.csv')
  @RequirePermissions(Permission.COST_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vehicle-tco.csv"')
  tcoCsv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(costQuerySchema)) q: CostQuery) {
    return this.costs.tcoCsv(user, q);
  }

  @Get('analytics/trip-costs')
  @RequirePermissions(Permission.COST_READ)
  tripCosts(@CurrentUser() user: AuthUser, @Query(new ZodPipe(costQuerySchema)) q: CostQuery) {
    return this.costs.tripCosts(user, q);
  }
}
