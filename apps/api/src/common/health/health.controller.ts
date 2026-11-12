import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { PrismaService } from '../db/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Used by K8s readinessProbe. */
  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};
    try {
      await this.db.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    checks.redis = (await this.redis.ping()) ? 'ok' : 'down';
    const ok = Object.values(checks).every((v) => v === 'ok');
    if (!ok) throw new ServiceUnavailableException({ status: 'error', checks });
    return { status: 'ok', checks };
  }
}
