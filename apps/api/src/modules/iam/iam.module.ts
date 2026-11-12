import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrganizationController } from './organization.controller';

@Module({
  controllers: [AuthController, OrganizationController],
  providers: [AuthService],
  exports: [AuthService],
})
export class IamModule {}
