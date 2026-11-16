import { Module } from '@nestjs/common';
import { AccountMailer, AccountsService } from './accounts.service';
import { AccountAuthController, CompaniesAdminController, UsersAdminController } from './admin.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrganizationController } from './organization.controller';
import { SsoAdminController, SsoAuthController, SsoSettingsController, SsoUsersController } from './sso/sso.controller';
import { SsoService } from './sso/sso.service';

@Module({
  controllers: [AuthController, OrganizationController, AccountAuthController, UsersAdminController, CompaniesAdminController, SsoAuthController, SsoSettingsController, SsoAdminController, SsoUsersController],
  providers: [AuthService, AccountsService, AccountMailer, SsoService],
  exports: [AuthService, AccountsService],
})
export class IamModule {}
