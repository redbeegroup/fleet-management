import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { ApiKeysService } from './api-keys.service';
import { Idempotency } from './idempotency';
import { IntegrationsController, OrdersController } from './integrations.controller';
import { OrdersService } from './orders.service';
import { IntegrationV1Controller } from './v1.controller';
import { WebhooksService } from './webhooks.service';

/** Webhooks are emitted from many modules, so the service is global. */
@Global()
@Module({ providers: [WebhooksService], exports: [WebhooksService] })
export class WebhooksModule {}

@Module({
  imports: [RedisModule],
  controllers: [IntegrationsController, OrdersController, IntegrationV1Controller],
  providers: [ApiKeysService, OrdersService, Idempotency],
})
export class IntegrationsModule {}
