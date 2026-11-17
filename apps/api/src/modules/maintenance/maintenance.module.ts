import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { WarrantyModule } from '../warranty/warranty.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({ imports: [InventoryModule, WarrantyModule], controllers: [MaintenanceController], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
