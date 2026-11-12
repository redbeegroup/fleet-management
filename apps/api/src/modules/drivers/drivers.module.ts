import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({ imports: [FilesModule], controllers: [DriversController], providers: [DriversService], exports: [DriversService] })
export class DriversModule {}
