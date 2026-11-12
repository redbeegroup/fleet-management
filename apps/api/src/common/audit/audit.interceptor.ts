import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../db/prisma.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACT = new Set(['password', 'passwordHash', 'refreshToken', 'token']);

function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, REDACT.has(k) ? '***' : v]),
  );
}

/** Writes an audit_logs row for every successful mutating request. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly db: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        const res = ctx.switchToHttp().getResponse<Response>();
        const user = req.user;
        const entity = ctx.getClass().name.replace(/Controller$/, '');
        const entityId =
          (req.params?.id as string | undefined) ??
          (result && typeof result === 'object' && 'id' in result ? String((result as { id: unknown }).id) : null);
        this.db
          .system((tx) =>
            tx.auditLog.create({
              data: {
                companyId: user?.companyId ?? null,
                userId: user?.userId ?? null,
                action: `${ctx.getClass().name}.${ctx.getHandler().name}`,
                entity,
                entityId,
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                ip: req.ip,
                payload: redact(req.body) as object,
              },
            }),
          )
          .catch((err: Error) => this.logger.error(`Audit write failed: ${err.message}`));
      }),
    );
  }
}
