import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateClaimInput,
  createClaimSchema,
  CreateIncidentInput,
  createIncidentSchema,
  paginationSchema,
  Permission,
  UpdateClaimInput,
  updateClaimSchema,
  UpdateIncidentInput,
  updateIncidentSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { IncidentsService } from './incidents.service';
import { SafetyService } from './safety.service';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: isoDay, to: isoDay }).refine((r) => r.from <= r.to, { path: ['to'], message: '`to` must not be before `from`' });
const listSchema = paginationSchema.extend({
  status: z.enum(['REPORTED', 'INVESTIGATING', 'CLOSED']).optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});

@ApiTags('safety')
@ApiBearerAuth()
@Controller()
export class SafetyController {
  constructor(
    private readonly safety: SafetyService,
    private readonly incidents: IncidentsService,
  ) {}

  @Get('safety/scores')
  @RequirePermissions(Permission.SAFETY_READ)
  scores(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeSchema)) q: { from: string; to: string }) {
    return this.safety.scores(user, q);
  }

  @Get('safety/drivers/:id')
  @RequirePermissions(Permission.SAFETY_READ)
  driver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(rangeSchema)) q: { from: string; to: string }) {
    return this.safety.driver(user, id, q);
  }

  @Get('incidents')
  @RequirePermissions(Permission.SAFETY_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.incidents.list(user, q);
  }

  @Get('incidents/:id')
  @RequirePermissions(Permission.SAFETY_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.get(user, id);
  }

  @Post('incidents')
  @RequirePermissions(Permission.INCIDENT_REPORT)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createIncidentSchema)) body: CreateIncidentInput) {
    return this.incidents.create(user, body);
  }

  @Patch('incidents/:id')
  @RequirePermissions(Permission.SAFETY_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateIncidentSchema)) body: UpdateIncidentInput) {
    return this.incidents.update(user, id, body);
  }

  @Post('incidents/:id/claims')
  @RequirePermissions(Permission.SAFETY_WRITE)
  createClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createClaimSchema)) body: CreateClaimInput) {
    return this.incidents.createClaim(user, id, body);
  }

  @Get('claims')
  @RequirePermissions(Permission.SAFETY_READ)
  claims(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.incidents.claims(user, status);
  }

  @Patch('claims/:id')
  @RequirePermissions(Permission.SAFETY_WRITE)
  updateClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateClaimSchema)) body: UpdateClaimInput) {
    return this.incidents.updateClaim(user, id, body);
  }
}
