import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsRange, analyticsRangeSchema, Permission } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions(Permission.COST_READ)
  overview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(analyticsRangeSchema)) q: AnalyticsRange) {
    return this.analytics.overview(user, q);
  }

  @Get('vehicles.csv')
  @RequirePermissions(Permission.COST_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="fleet-vehicles.csv"')
  csv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(analyticsRangeSchema)) q: AnalyticsRange) {
    return this.analytics.vehiclesCsv(user, q);
  }
}
