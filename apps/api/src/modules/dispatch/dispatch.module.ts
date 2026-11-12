import { Module } from '@nestjs/common';
import { FuelModule } from '../fuel/fuel.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { DutyService } from './duty.service';
import { MeController } from './me.controller';
import { DispatchController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [FuelModule, MaintenanceModule],
  controllers: [TripsController, DispatchController, MeController],
  providers: [TripsService, DutyService],
  exports: [TripsService],
})
export class DispatchModule {}
