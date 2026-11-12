import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './common/config/env';
import { ApiAppModule, IngestAppModule, JobAppModule, WorkerAppModule } from './app.module';
import { JsonLogger, logLevels } from './common/observability/json-logger';
import { startMetricsServer } from './common/observability/metrics';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { MaintenanceService } from './modules/maintenance/maintenance.service';
import { TelematicsService } from './modules/telematics/telematics.service';
import { ComplianceAlertsJob } from './worker/compliance-alerts.job';

function logger() {
  const cfg = env();
  const levels = logLevels(cfg.LOG_LEVEL);
  return cfg.LOG_FORMAT === 'json' ? new JsonLogger('FMS', { logLevels: levels }) : levels;
}

async function bootstrapApi() {
  const cfg = env();
  const app = await NestFactory.create(ApiAppModule, { logger: logger() });
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  if (cfg.SWAGGER_ENABLED) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fleet Management System API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  await app.listen(cfg.PORT, '0.0.0.0');
  Logger.log(`API listening on :${cfg.PORT}`, 'Bootstrap');
}

async function bootstrapBackground(module: typeof WorkerAppModule | typeof IngestAppModule, label: string) {
  const app = await NestFactory.createApplicationContext(module, { logger: logger() });
  app.enableShutdownHooks();
  const port = env().METRICS_PORT;
  if (port) {
    startMetricsServer(port);
    Logger.log(`Metrics on :${port}/metrics`, 'Bootstrap');
  }
  Logger.log(`${label} started`, 'Bootstrap');
}

async function runJob(name: string | undefined) {
  const app = await NestFactory.createApplicationContext(JobAppModule, { logger: logger() });
  const jobs: Record<string, () => Promise<unknown>> = {
    'compliance-alerts': () => app.get(ComplianceAlertsJob).run(),
    'position-partitions': () => app.get(TelematicsService).maintainPartitions(),
    'gps-offline': () => app.get(TelematicsService).checkOffline(),
    'maintenance-due': () => app.get(MaintenanceService).dueAlerts(),
    'daily-stats': () => app.get(AnalyticsService).rollup(process.env.JOB_FROM, process.env.JOB_TO),
  };
  const job = name ? jobs[name] : undefined;
  if (!job) throw new Error(`Unknown JOB "${name}". Available: ${Object.keys(jobs).join(', ')}`);
  const result = await job();
  Logger.log(`Job ${name} finished: ${JSON.stringify(result ?? {})}`, 'Job');
  await app.close();
}

const { MODE: mode, JOB: jobName } = env();
const run =
  mode === 'worker'
    ? bootstrapBackground(WorkerAppModule, 'Worker')
    : mode === 'ingest'
      ? bootstrapBackground(IngestAppModule, 'Ingest')
      : mode === 'job'
        ? runJob(jobName)
        : bootstrapApi();

run.catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
