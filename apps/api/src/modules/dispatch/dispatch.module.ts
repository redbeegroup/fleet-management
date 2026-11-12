import { Module } from '@nestjs/common';
import { DutyService } from './duty.service';
import { MeController } from './me.controller';
import { DispatchController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController, DispatchController, MeController],
  providers: [TripsService, DutyService],
  exports: [TripsService],
})
export class DispatchModule {}
