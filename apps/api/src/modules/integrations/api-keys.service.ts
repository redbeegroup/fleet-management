import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateApiKeyInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { generateApiKey } from '../../common/auth/api-key';
import { PrismaService } from '../../common/db/prisma.service';

const select = { id: true, name: true, prefix: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true };

@Injectable()
export class ApiKeysService {
  constructor(private readonly db: PrismaService) {}

  list(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.apiKey.findMany({ select, orderBy: { createdAt: 'desc' } }));
  }

  /** Returns the full key exactly once. */
  create(user: AuthUser, input: CreateApiKeyInput) {
    const { key, prefix, hash } = generateApiKey();
    return this.db.tenant(user.companyId, async (tx) => {
      const row = await tx.apiKey.create({
        data: { companyId: user.companyId, name: input.name, scopes: input.scopes, expiresAt: input.expiresAt ?? null, prefix, keyHash: hash, createdBy: user.userId },
        select,
      });
      return { ...row, key };
    });
  }

  revoke(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const k = await tx.apiKey.findFirst({ where: { id } });
      if (!k) throw new NotFoundException('API key not found');
      return tx.apiKey.update({ where: { id }, data: { revokedAt: k.revokedAt ?? new Date() }, select });
    });
  }
}
