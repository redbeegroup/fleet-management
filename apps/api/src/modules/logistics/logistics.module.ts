import { CostsModule } from '../costs/costs.module';
import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RoutingModule } from '../routing/routing.module';
import { LogisticsController, MyStopsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';
import { DeliveryKpiService } from './delivery-kpi.service';

@Module({ imports: [DispatchModule, RoutingModule, CostsModule], controllers: [LogisticsController, MyStopsController], providers: [LogisticsService, DeliveryKpiService] })
export class LogisticsModule {}
