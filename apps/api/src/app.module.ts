import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthGuard } from './common/auth/auth.guard';
import { env } from './common/config/env';
import { DbModule } from './common/db/db.module';
import { HealthController } from './common/health/health.controller';
import { PrismaExceptionFilter } from './common/http/prisma-exception.filter';
import { RedisModule } from './common/redis/redis.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { IamModule } from './modules/iam/iam.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TelematicsModule } from './modules/telematics/telematics.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { ComplianceAlertsJob } from './worker/compliance-alerts.job';
import { IngestRunner } from './worker/ingest.runner';
import { MAINTENANCE_QUEUE, WorkerProcessor } from './worker/worker.processor';

const core: Array<Type | DynamicModule> = [DbModule, RedisModule, NotificationsModule];

/** HTTP API process. */
@Module({
  imports: [
    ...core,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: env().JWT_ACCESS_SECRET,
        signOptions: { expiresIn: env().JWT_ACCESS_TTL },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    IamModule,
    VehiclesModule,
    DriversModule,
    TelematicsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class ApiAppModule {}

const redisConnection = () => {
  const u = new URL(env().REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
  };
};

/** Background job process (BullMQ). */
@Module({
  imports: [
    ...core,
    TelematicsModule,
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
  ],
  providers: [ComplianceAlertsJob, WorkerProcessor],
})
export class WorkerAppModule {}

/** Telemetry ingestion process (Watch Tower poller). */
@Module({
  imports: [...core, TelematicsModule],
  providers: [IngestRunner],
})
export class IngestAppModule {}
