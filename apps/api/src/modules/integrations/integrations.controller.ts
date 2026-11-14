import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateApiKeyInput,
  createApiKeySchema,
  paginationSchema,
  Permission,
  UpdateWebhookEndpointInput,
  updateWebhookEndpointSchema,
  WebhookEndpointInput,
  webhookEndpointSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ApiKeysService } from './api-keys.service';
import { OrdersService } from './orders.service';
import { WebhooksService } from './webhooks.service';

const deliveriesQuery = z.object({
  endpointId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
const ordersQuery = paginationSchema.extend({
  status: z.string().optional(),
  search: z.string().trim().max(100).optional(),
});

/** Company-admin management of API keys and webhooks. */
@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('api-keys')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  listKeys(@CurrentUser() user: AuthUser) {
    return this.keys.list(user);
  }

  @Post('api-keys')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  createKey(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createApiKeySchema)) body: CreateApiKeyInput) {
    return this.keys.create(user, body);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  revokeKey(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(user, id);
  }

  @Get('webhooks')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  listWebhooks(@CurrentUser() user: AuthUser) {
    return this.webhooks.list(user);
  }

  @Post('webhooks')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  createWebhook(@CurrentUser() user: AuthUser, @Body(new ZodPipe(webhookEndpointSchema)) body: WebhookEndpointInput) {
    return this.webhooks.create(user, body);
  }

  @Patch('webhooks/:id')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  updateWebhook(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateWebhookEndpointSchema)) body: UpdateWebhookEndpointInput) {
    return this.webhooks.update(user, id, body);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  deleteWebhook(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(user, id);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  rotate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.rotateSecret(user, id);
  }

  @Post('webhooks/:id/test')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  test(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.ping(user, id);
  }

  @Get('webhook-deliveries')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  deliveries(@CurrentUser() user: AuthUser, @Query(new ZodPipe(deliveriesQuery)) q: z.infer<typeof deliveriesQuery>) {
    return this.webhooks.deliveries(user, q);
  }

  @Post('webhook-deliveries/:id/redeliver')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  redeliver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.redeliver(user, id);
  }
}

/** Web console view of delivery orders received from the DMS. */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(Permission.ORDER_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ordersQuery)) q: z.infer<typeof ordersQuery>) {
    return this.orders.adminList(user, q);
  }
}
