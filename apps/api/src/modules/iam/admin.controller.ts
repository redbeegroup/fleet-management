import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateCompanyInput,
  createCompanySchema,
  forgotPasswordSchema,
  InviteUserInput,
  inviteUserSchema,
  Permission,
  setPasswordSchema,
  updateCompanySchema,
  UpdateUserInput,
  updateUserSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AccountsService } from './accounts.service';

/** Self-service: invitations and password resets by e-mail link. */
@ApiTags('auth')
@Controller('auth')
export class AccountAuthController {
  constructor(private readonly accounts: AccountsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.accounts.forgot(body.email);
    return { message: 'If this e-mail belongs to an active account, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('token-info')
  tokenInfo(@Query(new ZodPipe(z.object({ token: z.string().min(20).max(200) }))) q: { token: string }) {
    return this.accounts.tokenInfo(q.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('set-password')
  @HttpCode(204)
  async setPassword(@Body(new ZodPipe(setPasswordSchema)) body: { token: string; password: string }) {
    await this.accounts.setPassword(body.token, body.password);
  }
}

/** Company admins manage their users. */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('users')
export class UsersAdminController {
  constructor(private readonly accounts: AccountsService) {}

  @Post('invite')
  @RequirePermissions(Permission.USER_WRITE)
  invite(@CurrentUser() user: AuthUser, @Body(new ZodPipe(inviteUserSchema)) body: InviteUserInput) {
    return this.accounts.invite(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput) {
    return this.accounts.update(user, id, body);
  }

  @Post(':id/resend-invite')
  @RequirePermissions(Permission.USER_WRITE)
  resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.resendInvite(user, id);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.USER_WRITE)
  reset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.adminReset(user, id);
  }
}

/** Group administration (super admins): the companies of the group. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/companies')
export class CompaniesAdminController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions(Permission.COMPANY_MANAGE)
  list() {
    return this.accounts.companies();
  }

  @Post()
  @RequirePermissions(Permission.COMPANY_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createCompanySchema)) body: CreateCompanyInput) {
    return this.accounts.createCompany(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.COMPANY_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCompanySchema)) body: { name?: string; active?: boolean }) {
    return this.accounts.updateCompany(user, id, body);
  }
}
