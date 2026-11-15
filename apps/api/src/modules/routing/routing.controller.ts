import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@fms/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { RoutingService } from './routing.service';

@ApiTags('routing')
@ApiBearerAuth()
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  /** Whether OSRM/VROOM are configured and reachable (otherwise straight-line estimates are used). */
  @Get('status')
  @RequirePermissions(Permission.LOGISTICS_READ)
  status() {
    return this.routing.status();
  }
}
