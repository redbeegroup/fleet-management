import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateInspectionInput,
  createInspectionSchema,
  CreateInspectionTemplateInput,
  createInspectionTemplateSchema,
  paginationSchema,
  Permission,
  UpdateInspectionTemplateInput,
  updateInspectionTemplateSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { InspectionsService } from './inspections.service';

const listSchema = paginationSchema.extend({
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  kind: z.enum(['PRE_TRIP', 'POST_TRIP', 'PERIODIC']).optional(),
  result: z.enum(['PASS', 'DEFECTS', 'FAIL']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('inspections')
@ApiBearerAuth()
@Controller()
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get('inspection-templates')
  @RequirePermissions(Permission.INSPECTION_READ)
  templates(@CurrentUser() user: AuthUser) {
    return this.inspections.templates(user);
  }

  @Post('inspection-templates')
  @RequirePermissions(Permission.INSPECTION_WRITE)
  createTemplate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createInspectionTemplateSchema)) body: CreateInspectionTemplateInput) {
    return this.inspections.createTemplate(user, body);
  }

  @Patch('inspection-templates/:id')
  @RequirePermissions(Permission.INSPECTION_WRITE)
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateInspectionTemplateSchema)) body: UpdateInspectionTemplateInput) {
    return this.inspections.updateTemplate(user, id, body);
  }

  @Get('inspections')
  @RequirePermissions(Permission.INSPECTION_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.inspections.list(user, q);
  }

  @Get('inspections/:id')
  @RequirePermissions(Permission.INSPECTION_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.get(user, id);
  }

  @Post('inspections')
  @RequirePermissions(Permission.INSPECTION_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createInspectionSchema)) body: CreateInspectionInput) {
    return this.inspections.create(user, body);
  }
}
