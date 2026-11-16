import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, ReportKind, ReportSubscriptionInput, reportSubscriptionSchema } from '@fms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ReportsService } from './reports.service';

const previewSchema = z.object({
  report: z.nativeEnum(ReportKind),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  branchId: z.string().uuid().optional(),
  format: z.enum(['html', 'pdf']).default('html'),
});

/** Scheduled management reports by e-mail. Managing subscriptions is for company admins (settings). */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('report-subscriptions')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.reports.list(user);
  }

  /** Renders the last period as it would be sent (HTML page or PDF download). */
  @Get('preview')
  async preview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(previewSchema)) q: z.infer<typeof previewSchema>, @Res() res: Response) {
    const r = await this.reports.preview(user, q);
    if ('pdf' in r) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
      return res.send(r.pdf);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The preview is shown in a sandboxed iframe; it has no scripts.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    return res.send(r.html);
  }

  @Post()
  @RequirePermissions(Permission.SETTINGS_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reportSubscriptionSchema)) body: ReportSubscriptionInput) {
    return this.reports.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reportSubscriptionSchema.partial())) body: Partial<ReportSubscriptionInput>) {
    return this.reports.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.SETTINGS_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.reports.remove(user, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTINGS_WRITE)
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.sendNow(user, id);
  }
}
