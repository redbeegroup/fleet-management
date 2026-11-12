import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './common/config/env';
import { ApiAppModule, IngestAppModule, WorkerAppModule } from './app.module';

async function bootstrapApi() {
  const cfg = env();
  const app = await NestFactory.create(ApiAppModule, { bufferLogs: false });
  app.setGlobalPrefix('api', { exclude: [] });
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
  const app = await NestFactory.createApplicationContext(module);
  app.enableShutdownHooks();
  Logger.log(`${label} started`, 'Bootstrap');
}

const mode = env().MODE;
const run =
  mode === 'worker'
    ? bootstrapBackground(WorkerAppModule, 'Worker')
    : mode === 'ingest'
      ? bootstrapBackground(IngestAppModule, 'Ingest')
      : bootstrapApi();

run.catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
