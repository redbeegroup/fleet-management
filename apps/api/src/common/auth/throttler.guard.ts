import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { parseApiKey } from './api-key';

/** Rate limits machine clients per API key (prefix) and everyone else per IP. */
@Injectable()
export class FmsThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown> & { ip?: string; headers: Record<string, string | undefined> }): Promise<string> {
    const key = req.headers['x-api-key'];
    const parsed = key ? parseApiKey(key.trim()) : null;
    return parsed ? `key:${parsed.prefix}` : (req.ip ?? 'unknown');
  }
}
