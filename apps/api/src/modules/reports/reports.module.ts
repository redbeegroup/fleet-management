import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CostsModule } from '../costs/costs.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { SafetyModule } from '../safety/safety.module';
import { ReportsController } from './reports.controller';
import { ReportMailer, ReportsService } from './reports.service';

@Module({
  imports: [AnalyticsModule, CostsModule, LogisticsModule, SafetyModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportMailer],
  exports: [ReportsService],
})
export class ReportsModule {}
