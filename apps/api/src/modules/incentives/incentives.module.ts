import { Module } from '@nestjs/common';
import { SafetyModule } from '../safety/safety.module';
import { IncentivesController } from './incentives.controller';
import { IncentivesService } from './incentives.service';

@Module({ imports: [SafetyModule], controllers: [IncentivesController], providers: [IncentivesService], exports: [IncentivesService] })
export class IncentivesModule {}
