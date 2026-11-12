import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AssignVehicleInput,
  assignVehicleSchema,
  ChangeVehicleStatusInput,
  changeVehicleStatusSchema,
  CreateVehicleDocumentInput,
  createVehicleDocumentSchema,
  CreateVehicleInput,
  createVehicleSchema,
  paginationSchema,
  Permission,
  UpdateVehicleDocumentInput,
  updateVehicleDocumentSchema,
  UpdateVehicleInput,
  updateVehicleSchema,
  VehicleStatus,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { VehicleListQuery, VehiclesService } from './vehicles.service';

const listSchema = paginationSchema.extend({
  status: z.nativeEnum(VehicleStatus).optional(),
  branchId: z.string().uuid().optional(),
});
const expiringSchema = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) });

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions(Permission.VEHICLE_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: VehicleListQuery) {
    return this.vehicles.list(user, q);
  }

  @Get('documents/expiring')
  @RequirePermissions(Permission.VEHICLE_READ)
  expiring(@CurrentUser() user: AuthUser, @Query(new ZodPipe(expiringSchema)) q: { days: number }) {
    return this.vehicles.expiringDocuments(user, q.days);
  }

  @Get(':id')
  @RequirePermissions(Permission.VEHICLE_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(user, id);
  }

  @Post()
  @RequirePermissions(Permission.VEHICLE_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createVehicleSchema)) body: CreateVehicleInput) {
    return this.vehicles.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.VEHICLE_WRITE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateVehicleSchema)) body: UpdateVehicleInput,
  ) {
    return this.vehicles.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.VEHICLE_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.vehicles.remove(user, id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(Permission.VEHICLE_WRITE)
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(changeVehicleStatusSchema)) body: ChangeVehicleStatusInput,
  ) {
    return this.vehicles.changeStatus(user, id, body);
  }

  @Post(':id/assignments')
  @RequirePermissions(Permission.VEHICLE_WRITE)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(assignVehicleSchema)) body: AssignVehicleInput,
  ) {
    return this.vehicles.assign(user, id, body);
  }

  @Delete(':id/assignments/current')
  @HttpCode(204)
  @RequirePermissions(Permission.VEHICLE_WRITE)
  async unassign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.vehicles.unassign(user, id);
  }

  @Get(':id/assignments')
  @RequirePermissions(Permission.VEHICLE_READ)
  assignments(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.assignmentHistory(user, id);
  }

  @Post(':id/documents')
  @RequirePermissions(Permission.VEHICLE_DOCUMENT_WRITE)
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createVehicleDocumentSchema)) body: CreateVehicleDocumentInput,
  ) {
    return this.vehicles.addDocument(user, id, body);
  }

  @Patch(':id/documents/:documentId')
  @RequirePermissions(Permission.VEHICLE_DOCUMENT_WRITE)
  updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(new ZodPipe(updateVehicleDocumentSchema)) body: UpdateVehicleDocumentInput,
  ) {
    return this.vehicles.updateDocument(user, id, documentId, body);
  }

  @Get(':id/history')
  @RequirePermissions(Permission.VEHICLE_READ)
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.history(user, id);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @RequirePermissions(Permission.VEHICLE_DOCUMENT_WRITE)
  async removeDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.vehicles.removeDocument(user, id, documentId);
  }
}
