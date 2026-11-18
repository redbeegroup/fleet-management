import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, ProfitGroupBy, RateCardInput, rateCardSchema, rerateSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ProfitabilityService } from './profitability.service';

const profitQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupBy: z.enum(ProfitGroupBy).default('trip'),
});
const previewSchema = z.object({
  km: z.number().nonnegative().max(100_000).default(0),
  kg: z.number().nonnegative().max(1_000_000).default(0),
  drops: z.number().int().nonnegative().max(500).default(0),
  pallets: z.number().nonnegative().max(1_000).default(0),
  waitMinutes: z.number().int().nonnegative().max(10_000).default(0),
});

@ApiTags('profitability')
@ApiBearerAuth()
@Controller()
export class ProfitabilityController {
  constructor(private readonly svc: ProfitabilityService) {}

  @Get('rate-cards')
  @RequirePermissions(Permission.COST_READ)
  cards(@CurrentUser() user: AuthUser) {
    return this.svc.cards(user);
  }

  @Post('rate-cards')
  @RequirePermissions(Permission.RATE_CARD_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rateCardSchema)) body: RateCardInput) {
    return this.svc.createCard(user, body);
  }

  @Patch('rate-cards/:id')
  @RequirePermissions(Permission.RATE_CARD_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rateCardSchema)) body: RateCardInput) {
    return this.svc.updateCard(user, id, body);
  }

  @Post('rate-cards/:id/preview')
  @RequirePermissions(Permission.COST_READ)
  preview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.svc.preview(user, id, body);
  }

  @Post('rate-cards/rerate')
  @RequirePermissions(Permission.RATE_CARD_WRITE)
  rerate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rerateSchema)) body: z.infer<typeof rerateSchema>) {
    return this.svc.rerate(user, body.from, body.to);
  }

  @Get('trips/:id/revenue')
  @RequirePermissions(Permission.COST_READ)
  revenue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.tripRevenue(user, id);
  }

  @Post('trips/:id/revenue/recompute')
  @RequirePermissions(Permission.RATE_CARD_WRITE)
  recompute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recompute(user, id);
  }

  @Get('analytics/profitability')
  @RequirePermissions(Permission.COST_READ)
  profitability(@CurrentUser() user: AuthUser, @Query(new ZodPipe(profitQuery)) q: z.infer<typeof profitQuery>) {
    return this.svc.profitability(user, q);
  }

  @Get('analytics/profitability.csv')
  @RequirePermissions(Permission.COST_READ)
  @Header('content-type', 'text/csv; charset=utf-8')
  csv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(profitQuery)) q: z.infer<typeof profitQuery>) {
    return this.svc.profitabilityCsv(user, q);
  }
}
