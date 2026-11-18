import { Module } from '@nestjs/common';
import { CostsModule } from '../costs/costs.module';
import { SapController } from './sap.controller';
import { SapService } from './sap.service';

@Module({ imports: [CostsModule], controllers: [SapController], providers: [SapService], exports: [SapService] })
export class SapModule {}
