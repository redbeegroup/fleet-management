import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller()
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Get('compliance')
  @RequirePermissions(Permission.VEHICLE_READ)
  dashboard(@CurrentUser() user: AuthUser) {
    return this.svc.dashboard(user);
  }

  @Get('vehicles/:id/compliance')
  @RequirePermissions(Permission.VEHICLE_READ)
  vehicle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.vehicle(user, id);
  }
}
