import { Module } from '@nestjs/common';
import { CostsModule } from '../costs/costs.module';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';

@Module({ imports: [CostsModule], controllers: [LifecycleController], providers: [LifecycleService] })
export class LifecycleModule {}
