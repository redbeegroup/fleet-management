import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, Observable } from 'rxjs';
import { Idempotency } from '../../modules/integrations/idempotency';
import type { AuthUser } from '../auth/auth-user';
import { RedisService } from '../redis/redis.service';

const IDEMPOTENT = 'fms:idempotent';

/**
 * Marks a POST route as safe to retry with an `Idempotency-Key` header (driver app offline queue):
 * the first response is stored for 24 h per user + key and returned again for a repeat; a repeat with
 * a different body is a 422. Requests without the header behave as before.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly idem: Idempotency;

  constructor(
    private readonly reflector: Reflector,
    redis: RedisService,
  ) {
    this.idem = new Idempotency(redis);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http' || !this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser; method: string; originalUrl: string; body: unknown; file?: { size: number; originalname: string } }>();
    const key = req.headers['idempotency-key'];
    if (!key || !req.user) return next.handle();
    const request = { method: req.method, url: req.originalUrl, body: req.body ?? null, file: req.file ? { size: req.file.size, name: req.file.originalname } : null };
    return from(this.idem.run(req.user.companyId, key, request, () => lastValueFrom(next.handle(), { defaultValue: null }), `u:${req.user.userId}`));
  }
}
