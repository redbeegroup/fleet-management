import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditTemplateInput, auditTemplateSchema, CreateAuditInput, createAuditSchema, correctiveActionSchema, Permission, UpdateCorrectiveActionInput, updateCorrectiveActionSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AuditsService } from './audits.service';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

@ApiTags('safety-audits')
@ApiBearerAuth()
@Controller()
export class AuditsController {
  constructor(private readonly svc: AuditsService) {}

  @Get('audit-templates')
  @RequirePermissions(Permission.AUDIT_SAFETY_READ)
  templates(@CurrentUser() user: AuthUser) {
    return this.svc.templates(user);
  }

  @Post('audit-templates')
  @RequirePermissions(Permission.AUDIT_SAFETY_WRITE)
  createTemplate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(auditTemplateSchema)) body: AuditTemplateInput) {
    return this.svc.createTemplate(user, body);
  }

  @Patch('audit-templates/:id')
  @RequirePermissions(Permission.AUDIT_SAFETY_WRITE)
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(auditTemplateSchema.partial())) body: Partial<AuditTemplateInput>) {
    return this.svc.updateTemplate(user, id, body);
  }

  @Get('safety-audits')
  @RequirePermissions(Permission.AUDIT_SAFETY_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ target: z.enum(['BRANCH', 'VEHICLE']).optional(), branchId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional() }))) q: { target?: string; branchId?: string; vehicleId?: string }) {
    return this.svc.list(user, q);
  }

  @Get('safety-audits/trend')
  @RequirePermissions(Permission.AUDIT_SAFETY_READ)
  trend(@CurrentUser() user: AuthUser) {
    return this.svc.trend(user);
  }

  @Get('safety-audits/:id')
  @RequirePermissions(Permission.AUDIT_SAFETY_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Post('safety-audits')
  @RequirePermissions(Permission.AUDIT_SAFETY_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createAuditSchema)) body: CreateAuditInput) {
    return this.svc.create(user, body);
  }

  @Post('safety-audits/:id/actions')
  @RequirePermissions(Permission.AUDIT_SAFETY_WRITE)
  addAction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(correctiveActionSchema)) body: { description: string; ownerUserId?: string | null; dueDate: Date; questionKey?: string | null }) {
    return this.svc.addAction(user, id, body);
  }

  /** Everyone can list their own actions (?mine=true); safety readers see all. */
  @Get('corrective-actions')
  actions(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ status: z.enum(['OPEN', 'DONE', 'VERIFIED']).optional(), mine: bool, overdue: bool }))) q: { status?: string; mine?: boolean; overdue?: boolean }) {
    return this.svc.actions(user, q);
  }

  /** Owners close their actions; safety managers verify, reopen and edit (checked in the service). */
  @Patch('corrective-actions/:id')
  updateAction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCorrectiveActionSchema)) body: UpdateCorrectiveActionInput) {
    return this.svc.updateAction(user, id, body);
  }
}
