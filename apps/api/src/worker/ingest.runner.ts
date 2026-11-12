import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../common/config/env';
import { RedisService } from '../common/redis/redis.service';
import { TELEMATICS_PROVIDER, TelematicsProvider } from '../modules/telematics/providers/telematics-provider';
import { TelematicsService } from '../modules/telematics/telematics.service';

const LOCK_KEY = 'fms:ingest:leader';

/**
 * Polls the telematics provider on an interval. Several replicas may run; a
 * Redis lock elects a single leader so positions are fetched once.
 */
@Injectable()
export class IngestRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IngestRunner.name);
  private readonly instanceId = randomUUID();
  private timer?: NodeJS.Timeout;
  private since?: Date;
  private running = false;

  constructor(
    @Inject(TELEMATICS_PROVIDER) private readonly provider: TelematicsProvider,
    private readonly telematics: TelematicsService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = env().WATCHTOWER_POLL_SECONDS;
    this.logger.log(`Polling ${this.provider.name} every ${seconds}s`);
    this.timer = setInterval(() => void this.tick(seconds), seconds * 1000);
    void this.tick(seconds);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async isLeader(ttlSeconds: number): Promise<boolean> {
    const r = this.redis.client;
    if (r.status === 'wait') await r.connect();
    const acquired = await r.set(LOCK_KEY, this.instanceId, 'EX', ttlSeconds, 'NX');
    if (acquired) return true;
    if ((await r.get(LOCK_KEY)) === this.instanceId) {
      await r.expire(LOCK_KEY, ttlSeconds);
      return true;
    }
    return false;
  }

  private async tick(seconds: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.isLeader(seconds * 3))) return;
      const started = new Date();
      const fixes = await this.provider.fetchPositions(this.since);
      const stored = await this.telematics.ingest(fixes);
      this.since = started;
      if (fixes.length) this.logger.debug(`Fetched ${fixes.length} fixes, stored ${stored}`);
    } catch (err) {
      this.logger.error(`Ingest tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
