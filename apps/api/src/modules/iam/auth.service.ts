import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { permissionsForRoles } from '@fms/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { AccessTokenPayload } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService } from '../../common/db/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; companyId: string; roles: string[]; permissions: string[] };
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async login(email: string, password: string): Promise<TokenPair> {
    // Login happens before we know the tenant, so the lookup bypasses RLS.
    const user = await this.db.system((tx) =>
      tx.user.findUnique({ where: { email: email.toLowerCase() }, include: { company: true } }),
    );
    const valid = user && user.active && user.company.active && (await argon2.verify(user.passwordHash, password));
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    await this.db.system((tx) => tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }));
    return this.issue(user);
  }

  /** Rotates the refresh token: the presented one is revoked and a new pair issued. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);
    // The transaction returns null instead of throwing so that the reuse-revocation
    // below is committed rather than rolled back.
    const pair = await this.db.system(async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
        // Reuse of a revoked token indicates theft: revoke every active token of that user.
        if (stored?.revokedAt) {
          await tx.refreshToken.updateMany({
            where: { userId: stored.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return null;
      }
      // Conditional update guards against two concurrent refreshes of the same token.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) return null;
      return this.issue(stored.user, tx);
    });
    if (!pair) throw new UnauthorizedException('Invalid refresh token');
    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.system((tx) =>
      tx.refreshToken.updateMany({
        where: { tokenHash: sha256(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  private async issue(
    user: { id: string; email: string; fullName: string; companyId: string; roles: string[] },
    tx?: Parameters<Parameters<PrismaService['system']>[0]>[0],
  ): Promise<TokenPair> {
    const payload: AccessTokenPayload = { sub: user.id, cid: user.companyId, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const data = {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 86_400_000),
    };
    if (tx) await tx.refreshToken.create({ data });
    else await this.db.system((t) => t.refreshToken.create({ data }));

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        companyId: user.companyId,
        roles: user.roles,
        permissions: permissionsForRoles(user.roles),
      },
    };
  }
}
