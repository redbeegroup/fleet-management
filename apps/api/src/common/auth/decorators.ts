import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@fms/shared';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';

/** Marks a route as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires ALL listed permissions. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS, perms);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const API_KEY_SCOPE = 'apiKeyScope';

/**
 * Route is for machine clients: authenticated ONLY by `X-API-Key` with the given scope.
 * User JWTs are not accepted here, and API keys are not accepted anywhere else.
 */
export const ApiKeyAuth = (scope: string) => SetMetadata(API_KEY_SCOPE, scope);

export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().client;
});
