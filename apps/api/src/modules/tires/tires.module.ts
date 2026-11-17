import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { TiresController } from './tires.controller';
import { TiresService } from './tires.service';

@Module({ imports: [MaintenanceModule], controllers: [TiresController], providers: [TiresService], exports: [TiresService] })
export class TiresModule {}
