import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { LogisticsController, MyStopsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';

@Module({ imports: [DispatchModule], controllers: [LogisticsController, MyStopsController], providers: [LogisticsService] })
export class LogisticsModule {}
