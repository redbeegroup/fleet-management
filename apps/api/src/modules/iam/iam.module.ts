import { Module } from '@nestjs/common';
import { AccountMailer, AccountsService } from './accounts.service';
import { AccountAuthController, CompaniesAdminController, UsersAdminController } from './admin.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrganizationController } from './organization.controller';

@Module({
  controllers: [AuthController, OrganizationController, AccountAuthController, UsersAdminController, CompaniesAdminController],
  providers: [AuthService, AccountsService, AccountMailer],
  exports: [AuthService, AccountsService],
})
export class IamModule {}
