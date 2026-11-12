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
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { MetricsInterceptor } from './common/observability/metrics';
import { MetricsController } from './common/observability/metrics.controller';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FilesModule } from './modules/files/files.module';
import { FuelModule } from './modules/fuel/fuel.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { SafetyModule } from './modules/safety/safety.module';
import { InspectionsModule } from './modules/inspections/inspections.module';
import { TrainingModule } from './modules/training/training.module';
import { IncentivesModule } from './modules/incentives/incentives.module';
import { IamModule } from './modules/iam/iam.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TelematicsLiveModule, TelematicsModule } from './modules/telematics/telematics.module';
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
    FilesModule,
    VehiclesModule,
    DriversModule,
    TelematicsModule,
    TelematicsLiveModule,
    DispatchModule,
    FuelModule,
    MaintenanceModule,
    ExpensesModule,
    AnalyticsModule,
    SafetyModule,
    InspectionsModule,
    TrainingModule,
    IncentivesModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
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
    MaintenanceModule,
    AnalyticsModule,
    SafetyModule,
    TrainingModule,
    IncentivesModule,
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

/** One-shot job runner (MODE=job JOB=<name>): ops tooling and Kubernetes CronJobs. */
@Module({
  imports: [...core, TelematicsModule, MaintenanceModule, AnalyticsModule, SafetyModule, TrainingModule, IncentivesModule],
  providers: [ComplianceAlertsJob],
})
export class JobAppModule {}
