import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiScope, batchOrdersSchema, cancelOrderSchema, orderRefSchema, UpsertOrderInput, upsertOrderSchema } from '@fms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { ApiClient } from '../../common/auth/api-key';
import { ApiKeyAuth, CurrentClient } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Idempotency } from './idempotency';
import { OrdersService } from './orders.service';

const listQuery = z.object({
  updatedSince: z.coerce.date().optional(),
  status: z.enum(['RECEIVED', 'PLANNED', 'DISPATCHED', 'DELIVERED', 'PARTIAL', 'FAILED', 'RETURNED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(200).optional(),
});
const tripsQuery = z.object({ updatedSince: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

/**
 * Public integration API for the DMS and other systems. Authenticated only by `X-API-Key`;
 * see docs/INTEGRATION_API.md and /api/integrations/docs.
 */
@ApiTags('integration v1')
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('integrations/v1')
export class IntegrationV1Controller {
  constructor(
    private readonly orders: OrdersService,
    private readonly idem: Idempotency,
    private readonly db: PrismaService,
  ) {}

  /** Create or replace an order (idempotent; an identical payload is a no-op). 201 created, 200 updated/unchanged, 409 once planned. */
  @Put('orders/:externalRef')
  @ApiKeyAuth(ApiScope.ORDERS_WRITE)
  async upsert(
    @CurrentClient() client: ApiClient,
    @Param('externalRef', new ZodPipe(orderRefSchema)) ref: string,
    @Body(new ZodPipe(upsertOrderSchema)) body: UpsertOrderInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.orders.upsert(client.companyId, ref, body);
    res.status(r.result === 'created' ? 201 : 200);
    return r;
  }

  /** Up to 200 orders; every item gets its own result (errors do not fail the batch). */
  @Post('orders/batch')
  @HttpCode(200)
  @ApiKeyAuth(ApiScope.ORDERS_WRITE)
  batch(@CurrentClient() client: ApiClient, @Body(new ZodPipe(batchOrdersSchema)) body: z.infer<typeof batchOrdersSchema>, @Headers('idempotency-key') key?: string) {
    return this.idem.run(client.companyId, key, body, () => this.orders.batch(client.companyId, body.orders));
  }

  @Post('orders/:externalRef/cancel')
  @HttpCode(200)
  @ApiKeyAuth(ApiScope.ORDERS_WRITE)
  cancel(
    @CurrentClient() client: ApiClient,
    @Param('externalRef', new ZodPipe(orderRefSchema)) ref: string,
    @Body(new ZodPipe(cancelOrderSchema)) body: z.infer<typeof cancelOrderSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.idem.run(client.companyId, key, { ref, body }, () => this.orders.cancel(client.companyId, ref, body.reason));
  }

  @Get('orders/:externalRef')
  @ApiKeyAuth(ApiScope.ORDERS_READ)
  get(@CurrentClient() client: ApiClient, @Param('externalRef', new ZodPipe(orderRefSchema)) ref: string) {
    return this.orders.get(client.companyId, ref);
  }

  /** Changes feed: orders updated since a time, oldest first; follow `nextCursor`. */
  @Get('orders')
  @ApiKeyAuth(ApiScope.ORDERS_READ)
  list(@CurrentClient() client: ApiClient, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(client.companyId, q);
  }

  @Get('vehicles')
  @ApiKeyAuth(ApiScope.VEHICLES_READ)
  vehicles(@CurrentClient() client: ApiClient) {
    return this.db.tenant(client.companyId, (tx) =>
      tx.vehicle.findMany({
        where: { deletedAt: null },
        select: { id: true, plateNumber: true, vehicleClass: true, make: true, model: true, status: true, capacityKg: true, capacityM3: true },
        orderBy: { plateNumber: 'asc' },
      }),
    );
  }

  @Get('vehicles/positions')
  @ApiKeyAuth(ApiScope.TRACKING_READ)
  async positions(@CurrentClient() client: ApiClient) {
    return this.db.tenant(client.companyId, async (tx) => {
      const [pos, vehicles] = await Promise.all([
        tx.vehicleLastPosition.findMany({ select: { vehicleId: true, recordedAt: true, latitude: true, longitude: true, speedKmh: true, heading: true, ignition: true } }),
        tx.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true } }),
      ]);
      const plate = new Map(vehicles.map((v) => [v.id, v.plateNumber]));
      return pos.filter((p) => plate.has(p.vehicleId)).map((p) => ({ ...p, plateNumber: plate.get(p.vehicleId) }));
    });
  }

  @Get('trips')
  @ApiKeyAuth(ApiScope.TRIPS_READ)
  trips(@CurrentClient() client: ApiClient, @Query(new ZodPipe(tripsQuery)) q: z.infer<typeof tripsQuery>) {
    return this.db.tenant(client.companyId, (tx) =>
      tx.trip.findMany({
        where: q.updatedSince ? { updatedAt: { gte: q.updatedSince } } : {},
        select: {
          id: true,
          tripNo: true,
          status: true,
          originName: true,
          destinationName: true,
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          gpsDistanceKm: true,
          updatedAt: true,
          vehicle: { select: { plateNumber: true } },
          driver: { select: { fullName: true, employeeNo: true } },
        },
        orderBy: { updatedAt: 'asc' },
        take: q.limit,
      }),
    );
  }
}
