import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { DeliveryKpiService } from './delivery-kpi.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  autofillSchema,
  CheckInInput,
  checkInSchema,
  CreateReturnInput,
  createReturnSchema,
  deliveryKpiQuerySchema,
  CreateLoadInput,
  createLoadSchema,
  paginationSchema,
  Permission,
  planningQuerySchema,
  StopOutcomeInput,
  stopOutcomeSchema,
  UpdateCustomerInput,
  updateCustomerSchema,
  UpdateLoadInput,
  updateLoadSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { LogisticsService } from './logistics.service';

const loadsQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.string().uuid().optional() });
const customersQuery = paginationSchema.extend({ search: z.string().trim().max(100).optional() });
const dispatchStopSchema = z.union([z.object({ status: z.literal('ARRIVED') }), stopOutcomeSchema]);

@ApiTags('logistics')
@ApiBearerAuth()
@Controller()
export class LogisticsController {
  constructor(
    private readonly svc: LogisticsService,
    private readonly kpi: DeliveryKpiService,
  ) {}

  @Post('logistics/stops/:id/returns')
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  addReturn(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createReturnSchema)) body: CreateReturnInput) {
    return this.svc.addReturn(user, id, body);
  }

  @Get('logistics/loads/:tripId/check-in')
  @RequirePermissions(Permission.LOGISTICS_READ)
  checkInExpected(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) id: string) {
    return this.svc.checkInExpected(user, id);
  }

  @Post('logistics/loads/:tripId/check-in')
  @HttpCode(200)
  @RequirePermissions(Permission.WAREHOUSE_CHECKIN)
  checkIn(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) id: string, @Body(new ZodPipe(checkInSchema)) body: CheckInInput) {
    return this.svc.checkIn(user, id, body);
  }

  @Get('logistics/pod-exceptions')
  @RequirePermissions(Permission.LOGISTICS_READ)
  podExceptions(@CurrentUser() user: AuthUser, @Query(new ZodPipe(deliveryKpiQuerySchema)) q: { from: string; to: string }) {
    return this.svc.podExceptions(user, q);
  }

  @Get('analytics/delivery')
  @RequirePermissions(Permission.LOGISTICS_READ)
  deliveryKpis(@CurrentUser() user: AuthUser, @Query(new ZodPipe(deliveryKpiQuerySchema)) q: z.infer<typeof deliveryKpiQuerySchema>) {
    return this.kpi.overview(user, q);
  }

  @Get('analytics/delivery.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @RequirePermissions(Permission.LOGISTICS_READ)
  deliveryCsv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(deliveryKpiQuerySchema)) q: z.infer<typeof deliveryKpiQuerySchema>) {
    return this.kpi.csv(user, q);
  }

  @Get('logistics/planning')
  @RequirePermissions(Permission.LOGISTICS_READ)
  planning(@CurrentUser() user: AuthUser, @Query(new ZodPipe(planningQuerySchema)) q: { date: string; branchId: string }) {
    return this.svc.planning(user, q);
  }

  @Post('logistics/autofill')
  @HttpCode(200)
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  autofill(@CurrentUser() user: AuthUser, @Body(new ZodPipe(autofillSchema)) body: z.infer<typeof autofillSchema>) {
    return this.svc.autofill(user, body);
  }

  @Get('logistics/loads')
  @RequirePermissions(Permission.LOGISTICS_READ)
  loads(@CurrentUser() user: AuthUser, @Query(new ZodPipe(loadsQuery)) q: z.infer<typeof loadsQuery>) {
    return this.svc.loads(user, q);
  }

  @Post('logistics/loads')
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  createLoad(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createLoadSchema)) body: CreateLoadInput) {
    return this.svc.createLoad(user, body);
  }

  @Get('logistics/loads/:tripId')
  @RequirePermissions(Permission.LOGISTICS_READ)
  load(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) id: string) {
    return this.svc.load(user, id);
  }

  /** Same data as the load, for the printable manifest. */
  @Get('logistics/loads/:tripId/manifest')
  @RequirePermissions(Permission.LOGISTICS_READ)
  manifest(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) id: string) {
    return this.svc.load(user, id);
  }

  @Patch('logistics/loads/:tripId')
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  updateLoad(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateLoadSchema)) body: UpdateLoadInput) {
    return this.svc.updateLoad(user, id, body);
  }

  /** Dispatch records a stop result (e.g. the driver phoned in). */
  @Post('logistics/stops/:id/status')
  @HttpCode(200)
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  stopStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(dispatchStopSchema)) body: z.infer<typeof dispatchStopSchema>) {
    return 'status' in body ? this.svc.arrive(user, id) : this.svc.complete(user, id, body);
  }

  @Get('customers')
  @RequirePermissions(Permission.LOGISTICS_READ)
  customers(@CurrentUser() user: AuthUser, @Query(new ZodPipe(customersQuery)) q: z.infer<typeof customersQuery>) {
    return this.svc.customers(user, q);
  }

  @Patch('customers/:id')
  @RequirePermissions(Permission.LOGISTICS_WRITE)
  updateCustomer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCustomerSchema)) body: UpdateCustomerInput) {
    return this.svc.updateCustomer(user, id, body);
  }
}

/** Driver app: stops of the driver's own delivery trips. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/trips/:tripId/stops')
export class MyStopsController {
  constructor(
    private readonly svc: LogisticsService,
    private readonly db: PrismaService,
  ) {}

  private async driverFor(user: AuthUser, tripId: string) {
    const d = await this.db.tenant(user.companyId, (tx) => tx.driver.findFirst({ where: { userId: user.userId, active: true }, select: { id: true } }));
    if (!d) throw new ForbiddenException('Your login is not linked to an active driver profile');
    const trip = await this.db.tenant(user.companyId, (tx) => tx.trip.findFirst({ where: { id: tripId, driverId: d.id, kind: 'DELIVERY' }, select: { id: true } }));
    if (!trip) throw new ForbiddenException('Not your delivery trip');
    return d.id;
  }

  @Get()
  @RequirePermissions(Permission.TRIP_READ)
  async list(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string) {
    await this.driverFor(user, tripId);
    const l = await this.svc.load(user, tripId);
    return { tripNo: l.tripNo, status: l.status, depot: l.depot, cod: l.cod, totals: l.totals, stops: l.stops, failureReasons: l.failureReasons, podSettings: l.podSettings };
  }

  @Post(':stopId/arrive')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_READ)
  async arrive(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string, @Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.arrive(user, stopId, await this.driverFor(user, tripId));
  }

  @Post(':stopId/returns')
  @RequirePermissions(Permission.TRIP_READ)
  async addReturn(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body(new ZodPipe(createReturnSchema)) body: CreateReturnInput,
  ) {
    return this.svc.addReturn(user, stopId, body, await this.driverFor(user, tripId));
  }

  @Post(':stopId/complete')
  @HttpCode(200)
  @RequirePermissions(Permission.TRIP_READ)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body(new ZodPipe(stopOutcomeSchema)) body: StopOutcomeInput,
  ) {
    return this.svc.complete(user, stopId, body, await this.driverFor(user, tripId));
  }
}
