import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../db/prisma.service';

/** Machine client authenticated by an API key (never an AuthUser). */
export interface ApiClient {
  companyId: string;
  apiKeyId: string;
  scopes: string[];
}

const KEY_RE = /^fms_([a-z0-9]{12})_([A-Za-z0-9_-]{32,64})$/;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** New key: `fms_<prefix>_<secret>`. Only the hash is stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12);
  const key = `fms_${prefix}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix, hash: hashKey(key) };
}

export function parseApiKey(key: string): { prefix: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { prefix: m[1] } : null;
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class ApiKeyVerifier {
  private readonly logger = new Logger(ApiKeyVerifier.name);
  private readonly touched = new Map<string, number>();

  constructor(private readonly db: PrismaService) {}

  async verify(header: string | undefined, now = new Date()): Promise<ApiClient> {
    const parsed = header ? parseApiKey(header.trim()) : null;
    if (!parsed) throw new UnauthorizedException('Missing or malformed X-API-Key');
    const row = await this.db.system((tx) => tx.apiKey.findUnique({ where: { prefix: parsed.prefix } }));
    if (!row || !sameHash(row.keyHash, hashKey(header!.trim()))) throw new UnauthorizedException('Invalid API key');
    if (row.revokedAt) throw new UnauthorizedException('API key revoked');
    if (row.expiresAt && row.expiresAt <= now) throw new UnauthorizedException('API key expired');
    // Record usage at most once a minute per key.
    if ((this.touched.get(row.id) ?? 0) < now.getTime() - 60_000) {
      this.touched.set(row.id, now.getTime());
      void this.db.system((tx) => tx.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } })).catch((e: Error) => this.logger.warn(e.message));
    }
    return { companyId: row.companyId, apiKeyId: row.id, scopes: row.scopes };
  }
}
