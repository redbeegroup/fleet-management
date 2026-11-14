import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { stableStringify } from './order-mapping';

const TTL_S = 24 * 3600;

/** `Idempotency-Key` support for POST endpoints: same key + same request → same stored response for 24 h. */
@Injectable()
export class Idempotency {
  constructor(private readonly redis: RedisService) {}

  async run<T>(companyId: string, key: string | undefined, request: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new UnprocessableEntityException('Idempotency-Key must be 8–128 characters [A-Za-z0-9._:-]');
    const r = this.redis.client;
    if (r.status === 'wait') await r.connect();
    const hash = createHash('sha256').update(stableStringify(request)).digest('hex');
    const base = `idem:${companyId}:${key}`;
    const stored = await r.get(base);
    if (stored) {
      const s = JSON.parse(stored) as { hash: string; body: T };
      if (s.hash !== hash) throw new UnprocessableEntityException('Idempotency-Key was already used with a different request');
      return s.body;
    }
    if ((await r.set(`${base}:lock`, '1', 'EX', 60, 'NX')) !== 'OK') throw new ConflictException('A request with this Idempotency-Key is in progress');
    try {
      const body = await fn();
      await r.set(base, JSON.stringify({ hash, body }), 'EX', TTL_S);
      return body;
    } finally {
      await r.del(`${base}:lock`);
    }
  }
}
