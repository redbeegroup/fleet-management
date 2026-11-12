import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { registry } from './metrics';

/**
 * Prometheus scrape endpoint at /metrics (outside the /api prefix, so the
 * public ingress, which only routes /api and /, does not expose it).
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', registry.contentType)
  metrics() {
    return registry.metrics();
  }
}
