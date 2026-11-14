import { Module } from '@nestjs/common';
import { FuelModule } from '../fuel/fuel.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { SafetyModule } from '../safety/safety.module';
import { InspectionsModule } from '../inspections/inspections.module';
import { TrainingModule } from '../training/training.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { DutyService } from './duty.service';
import { VehicleRequestsController } from './vehicle-requests.controller';
import { VehicleRequestsService } from './vehicle-requests.service';
import { MeController } from './me.controller';
import { DispatchController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [FuelModule, MaintenanceModule, SafetyModule, InspectionsModule, TrainingModule, IncentivesModule],
  controllers: [TripsController, DispatchController, MeController, VehicleRequestsController],
  providers: [TripsService, DutyService, VehicleRequestsService],
  exports: [TripsService],
})
export class DispatchModule {}
