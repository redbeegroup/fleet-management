import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/** One registry per process; scraped at /metrics. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'fms_' });

export const httpDuration = new Histogram({
  name: 'fms_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const positionsIngested = new Counter({
  name: 'fms_positions_ingested_total',
  help: 'GPS positions stored',
  registers: [registry],
});

export const telemetryEvents = new Counter({
  name: 'fms_telemetry_events_total',
  help: 'Telematics events detected',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const notificationsSent = new Counter({
  name: 'fms_notifications_total',
  help: 'Notifications created / delivered per channel',
  labelNames: ['channel', 'result'] as const,
  registers: [registry],
});

export const jobRuns = new Counter({
  name: 'fms_job_runs_total',
  help: 'Background job runs',
  labelNames: ['job', 'result'] as const,
  registers: [registry],
});

/** Records request latency by route template (not raw URL, to keep cardinality low). */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const end = httpDuration.startTimer();
    const done = () => {
      const res = ctx.switchToHttp().getResponse<Response>();
      end({ method: req.method, route: (req.route?.path as string | undefined) ?? 'unknown', status: String(res.statusCode) });
    };
    return next.handle().pipe(tap({ next: done, error: done }));
  }
}

/** Standalone /metrics endpoint for processes without an HTTP server (worker, ingest). */
export function startMetricsServer(port: number): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } else if (req.url === '/healthz') {
      res.end('ok');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port, '0.0.0.0');
  return server;
}
