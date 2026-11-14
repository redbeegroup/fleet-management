import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BulkMaintenancePlanInput,
  bulkMaintenancePlanSchema,
  CompleteWorkOrderInput,
  completeWorkOrderSchema,
  CreateRepairRequestInput,
  createRepairRequestSchema,
  CreateWorkOrderInput,
  createWorkOrderSchema,
  MaintenancePlanInput,
  maintenancePlanSchema,
  paginationSchema,
  Permission,
  WorkOrderLineInput,
  workOrderLineSchema,
  WorkOrderStatus,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { MaintenanceService } from './maintenance.service';

const woListSchema = paginationSchema.extend({
  status: z.nativeEnum(WorkOrderStatus).optional(),
  vehicleId: z.string().uuid().optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const rangeSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((r) => r.to > r.from, { path: ['to'], message: '`to` must be after `from`' });
const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  intervalKm: z.number().int().min(100).max(1_000_000).optional().nullable(),
  intervalDays: z.number().int().min(1).max(3650).optional().nullable(),
  lastDoneAt: z.coerce.date().optional().nullable(),
  lastDoneOdometerKm: z.number().nonnegative().optional().nullable(),
  active: z.boolean().optional(),
});

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Get('plans')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  plans(@CurrentUser() user: AuthUser, @Query('vehicleId') vehicleId?: string) {
    return this.svc.plans(user, vehicleId);
  }

  @Post('plans')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  createPlan(@CurrentUser() user: AuthUser, @Body(new ZodPipe(maintenancePlanSchema)) body: MaintenancePlanInput) {
    return this.svc.createPlan(user, body);
  }

  @Post('plans/bulk')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  bulk(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bulkMaintenancePlanSchema)) body: BulkMaintenancePlanInput) {
    return this.svc.createPlansBulk(user, body);
  }

  @Patch('plans/:id')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  updatePlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(planUpdateSchema)) body: z.infer<typeof planUpdateSchema>) {
    return this.svc.updatePlan(user, id, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  async removePlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.removePlan(user, id);
  }

  @Get('repair-requests')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  requests(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.repairRequests(user, status);
  }

  @Post('repair-requests')
  @RequirePermissions(Permission.REPAIR_REQUEST)
  createRequest(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createRepairRequestSchema)) body: CreateRepairRequestInput) {
    return this.svc.createRepairRequest(user, body);
  }

  @Post('repair-requests/:id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.svc.rejectRepairRequest(user, id, body.reason);
  }

  @Get('work-orders')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  workOrders(@CurrentUser() user: AuthUser, @Query(new ZodPipe(woListSchema)) q: z.infer<typeof woListSchema>) {
    return this.svc.workOrders(user, q);
  }

  @Get('work-orders/:id')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  workOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.workOrder(user, id);
  }

  @Post('work-orders')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  createWo(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createWorkOrderSchema)) body: CreateWorkOrderInput) {
    return this.svc.createWorkOrder(user, body);
  }

  @Post('work-orders/:id/start')
  @HttpCode(200)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.startWorkOrder(user, id);
  }

  @Post('work-orders/:id/request-approval')
  @HttpCode(200)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  requestApproval(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.requestWorkOrderApproval(user, id);
  }

  @Post('work-orders/:id/lines')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  addLine(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(workOrderLineSchema)) body: WorkOrderLineInput) {
    return this.svc.addLine(user, id, body);
  }

  @Delete('work-orders/:id/lines/:lineId')
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  removeLine(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.svc.removeLine(user, id, lineId);
  }

  @Post('work-orders/:id/complete')
  @HttpCode(200)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeWorkOrderSchema)) body: CompleteWorkOrderInput) {
    return this.svc.completeWorkOrder(user, id, body);
  }

  @Post('work-orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.MAINTENANCE_WRITE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.svc.cancelWorkOrder(user, id, body.reason);
  }

  @Get('report')
  @RequirePermissions(Permission.MAINTENANCE_READ)
  report(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeSchema)) q: { from: Date; to: Date }) {
    return this.svc.report(user, q.from, q.to);
  }
}
