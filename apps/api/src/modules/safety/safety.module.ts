import { Module } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

@Module({ controllers: [SafetyController], providers: [SafetyService, IncidentsService], exports: [SafetyService, IncidentsService] })
export class SafetyModule {}
