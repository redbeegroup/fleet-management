import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assetMatchSchema, costPostingSchema, Permission, SapCredentialInput, sapCredentialSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { SapService } from './sap.service';

const periodQuery = z.object({ period: costPostingSchema.shape.period });
const rangeQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@ApiTags('sap')
@ApiBearerAuth()
@Controller('sap')
export class SapController {
  constructor(private readonly sap: SapService) {}

  @Get()
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  status(@CurrentUser() user: AuthUser) {
    return this.sap.status(user);
  }

  @Put('connection')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  connection(@CurrentUser() user: AuthUser, @Body(new ZodPipe(sapCredentialSchema)) body: SapCredentialInput) {
    return this.sap.saveConnection(user, body);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  test(@CurrentUser() user: AuthUser) {
    return this.sap.test(user);
  }

  @Post('sync')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  sync(@CurrentUser() user: AuthUser) {
    return this.sap.syncMaster(user.companyId, user.userId);
  }

  @Post('assets/match')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  match(@CurrentUser() user: AuthUser, @Body(new ZodPipe(assetMatchSchema)) body: z.infer<typeof assetMatchSchema>) {
    return this.sap.matchAsset(user, body.vehicleId, body.sapAssetNo);
  }

  @Get('postings')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  postings(@CurrentUser() user: AuthUser) {
    return this.sap.postings(user);
  }

  @Get('postings/preview')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  preview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>) {
    return this.sap.previewPosting(user, q.period);
  }

  @Post('postings')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  post(@CurrentUser() user: AuthUser, @Body(new ZodPipe(costPostingSchema)) body: z.infer<typeof costPostingSchema>) {
    return this.sap.post(user.companyId, body.period, user.userId);
  }

  @Get('documents')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  documents(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.sap.documents(user, status);
  }

  @Post('documents/:id/redeliver')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  redeliver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sap.redeliver(user, id);
  }

  @Get('receipts')
  @RequirePermissions(Permission.INVENTORY_READ)
  receipts(@CurrentUser() user: AuthUser) {
    return this.sap.receipts(user);
  }

  @Post('billing/import')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  importBilling(@CurrentUser() user: AuthUser) {
    return this.sap.importBilling(user.companyId, user.userId);
  }

  @Get('billing')
  @RequirePermissions(Permission.COST_READ)
  billing(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.sap.billing(user, q.from, q.to);
  }
}
