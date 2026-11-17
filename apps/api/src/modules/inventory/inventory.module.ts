import { Module } from '@nestjs/common';
import { WebhooksModule } from '../integrations/integrations.module';
import { InventoryController, SuppliersController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({ imports: [WebhooksModule], controllers: [SuppliersController, InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
