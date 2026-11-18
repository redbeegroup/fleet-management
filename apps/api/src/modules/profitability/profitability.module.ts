import { Module } from '@nestjs/common';
import { CostsModule } from '../costs/costs.module';
import { ProfitabilityController } from './profitability.controller';
import { ProfitabilityService } from './profitability.service';

@Module({ imports: [CostsModule], controllers: [ProfitabilityController], providers: [ProfitabilityService], exports: [ProfitabilityService] })
export class ProfitabilityModule {}
