import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { permissionsForRoles } from '@fms/shared';
import type { Request } from 'express';
import type { AccessTokenPayload, AuthUser } from './auth-user';
import { ApiClient, ApiKeyVerifier } from './api-key';
import { API_KEY_SCOPE, IS_PUBLIC, PERMISSIONS } from './decorators';

/**
 * Global guard: validates the bearer JWT, attaches `req.user`, then enforces
 * `@RequirePermissions(...)` metadata (RBAC).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser; client?: ApiClient }>();
    const scope = this.reflector.getAllAndOverride<string>(API_KEY_SCOPE, targets);
    if (scope) {
      const client = await this.apiKeys.verify(req.header('x-api-key'));
      if (!client.scopes.includes(scope)) throw new ForbiddenException(`API key lacks scope ${scope}`);
      req.client = client;
      return true;
    }
    if (req.header('x-api-key')) throw new UnauthorizedException('API keys are only accepted on /api/integrations/v1 endpoints');

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user: AuthUser = {
      userId: payload.sub,
      companyId: payload.cid,
      email: payload.email,
      roles: payload.roles,
      permissions: permissionsForRoles(payload.roles),
    };
    req.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
