import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({ imports: [FilesModule], controllers: [VehiclesController], providers: [VehiclesService], exports: [VehiclesService] })
export class VehiclesModule {}
