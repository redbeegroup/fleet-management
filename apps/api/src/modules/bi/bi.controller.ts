import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { biLoginSchema, Permission } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { BiService } from './bi.service';

/** Super admins: read-only database logins for BI tools. */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('admin/bi-logins')
export class BiController {
  constructor(private readonly bi: BiService) {}

  @Get()
  @RequirePermissions(Permission.COMPANY_MANAGE)
  list() {
    return this.bi.list();
  }

  @Post()
  @RequirePermissions(Permission.COMPANY_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(biLoginSchema)) body: { companyId: string | null }) {
    return this.bi.create(user, body.companyId);
  }

  @Post(':role/rotate')
  @HttpCode(200)
  @RequirePermissions(Permission.COMPANY_MANAGE)
  rotate(@CurrentUser() user: AuthUser, @Param('role') role: string) {
    return this.bi.rotate(user, role);
  }

  @Delete(':role')
  @HttpCode(204)
  @RequirePermissions(Permission.COMPANY_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('role') role: string) {
    await this.bi.remove(user, role);
  }
}
