import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, SsoDomainInput, ssoDomainSchema, SsoProviderInput, ssoProviderSchema, updateSsoProviderSchema } from '@fms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../../common/auth/auth-user';
import { env } from '../../../common/config/env';
import { CurrentUser, Public, RequirePermissions } from '../../../common/auth/decorators';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { SsoRefused } from './sso-core';
import { SsoService } from './sso.service';

const startSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  provider: z.enum(['microsoft', 'google']).optional(),
  app: z.enum(['web', 'mobile']).optional(),
});

/** Single sign-on with Microsoft Entra ID or Google Workspace (invited users only). */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoAuthController {
  constructor(private readonly sso: SsoService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('options')
  options(@Query(new ZodPipe(z.object({ email: z.string().trim().toLowerCase().email().optional() }))) q: { email?: string }) {
    return this.sso.options(q.email);
  }

  /** Redirects to the identity provider. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('start')
  async start(@Query(new ZodPipe(startSchema)) q: z.infer<typeof startSchema>, @Res() res: Response) {
    try {
      res.redirect(302, await this.sso.start(q));
    } catch (e) {
      if (!(e instanceof SsoRefused)) throw e;
      const base = q.app === 'mobile' ? this.mobile() : this.web();
      res.redirect(302, `${base}?${new URLSearchParams({ error: e.message })}`);
    }
  }

  @Public()
  @Get('callback')
  async callback(@Query() q: Record<string, string | undefined>, @Res() res: Response) {
    res.redirect(302, await this.sso.callback(q));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('exchange')
  @HttpCode(200)
  exchange(@Body(new ZodPipe(z.object({ code: z.string().min(20).max(100) }))) body: { code: string }) {
    return this.sso.exchange(body.code);
  }

  private web = () => `${env().APP_URL.replace(/\/$/, '')}/sso`;
  private mobile = () => env().MOBILE_SSO_REDIRECT;
}

/** Company admins: their own identity providers and e-mail domains. */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('settings/sso')
export class SsoSettingsController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_WRITE)
  get(@CurrentUser() user: AuthUser) {
    return this.sso.settings(user);
  }

  @Post('providers')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  createProvider(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ssoProviderSchema)) body: SsoProviderInput) {
    return this.sso.createProvider(user, body);
  }

  @Patch('providers/:id')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  updateProvider(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSsoProviderSchema)) body: Partial<SsoProviderInput>) {
    return this.sso.updateProvider(user, id, body);
  }

  @Delete('providers/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.SETTINGS_WRITE)
  async deleteProvider(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.sso.deleteProvider(user, id);
  }

  @Post('providers/:id/test')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTINGS_WRITE)
  test(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sso.testProvider(user, id);
  }

  @Post('domains')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  addDomain(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ssoDomainSchema)) body: SsoDomainInput) {
    return this.sso.addDomain(user, body);
  }

  @Delete('domains/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.SETTINGS_WRITE)
  async deleteDomain(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.sso.deleteDomain(user, id);
  }
}

/** Super admins: approve domains for the group's shared Microsoft / Google sign-in. */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('admin/sso-domains')
export class SsoAdminController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  @RequirePermissions(Permission.COMPANY_MANAGE)
  list() {
    return this.sso.groupDomains();
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.COMPANY_MANAGE)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sso.approveDomain(user, id, true);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions(Permission.COMPANY_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sso.approveDomain(user, id, false);
  }
}

/** Company admins: unlink a user's SSO identity (e.g. after an account change at the provider). */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('users')
export class SsoUsersController {
  constructor(private readonly sso: SsoService) {}

  @Post(':id/unlink-sso')
  @HttpCode(200)
  @RequirePermissions(Permission.USER_WRITE)
  unlink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sso.unlink(user, id);
  }
}
