import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DecisionInput, decisionSchema, Permission } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ApprovalsService } from './approvals.service';

const listSchema = z.object({
  scope: z.enum(['pending', 'mine', 'all']).default('pending'),
  kind: z.enum(['WORK_ORDER', 'EXPENSE', 'FUEL', 'VEHICLE_REQUEST', 'CLAIM']).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** Anyone signed in sees their own requests; `pending` and `all` need approval:decide. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const scope = user.permissions.includes(Permission.APPROVAL_DECIDE) ? q.scope : 'mine';
    return this.approvals.list(user, { ...q, scope });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.get(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.APPROVAL_DECIDE)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput) {
    return this.approvals.decide(user, id, 'APPROVED', body.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.APPROVAL_DECIDE)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput) {
    return this.approvals.decide(user, id, 'REJECTED', body.note);
  }
}
