import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SsoDomainInput, SsoProviderInput } from '@fms/shared';
import { randomBytes } from 'node:crypto';
import { BaseClient, custom, generators, Issuer } from 'openid-client';
import type { AuthUser } from '../../../common/auth/auth-user';
import { env } from '../../../common/config/env';
import { PrismaService } from '../../../common/db/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { AuthService, TokenPair } from '../auth.service';
import {
  decryptSecret,
  emailDomain,
  encryptSecret,
  entraIssuer,
  MULTI_TENANT,
  ProviderConfig,
  ProviderKey,
  sourceFor,
  SsoRefused,
  verifiedEmail,
} from './sso-core';

custom.setHttpOptionsDefaults({ timeout: 10_000 });

interface PendingLogin {
  providerKey: ProviderKey;
  state: string;
  nonce: string;
  verifier: string;
  app: 'web' | 'mobile';
}

const STATE_TTL = 600;
const CODE_TTL = 60;

/**
 * OpenID Connect single sign-on (authorization code + PKCE) with Microsoft Entra ID and
 * Google Workspace. Only existing, active users can sign in; their e-mail domain decides
 * the company and the identity provider. Tokens never travel in a URL: the callback hands
 * the browser (or the driver app) a one-time code that is exchanged for the usual pair.
 */
@Injectable()
export class SsoService {
  private readonly log = new Logger('SSO');
  private readonly issuers = new Map<string, Promise<Issuer<BaseClient>>>();

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private get encKey(): string {
    const e = env();
    return e.SSO_ENCRYPTION_KEY ?? `jwt:${e.JWT_ACCESS_SECRET}`;
  }

  redirectUri(): string {
    const e = env();
    return e.SSO_REDIRECT_URL ?? `${e.APP_URL.replace(/\/$/, '')}/api/auth/sso/callback`;
  }

  /** Group-level providers available from configuration. */
  groupProviders(): { microsoft: boolean; google: boolean } {
    const e = env();
    return {
      microsoft: !!(e.ENTRA_TENANT_ID && e.ENTRA_CLIENT_ID && e.ENTRA_CLIENT_SECRET),
      google: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    };
  }

  private async provider(key: ProviderKey): Promise<ProviderConfig> {
    const e = env();
    if (key === 'group-entra') {
      if (!this.groupProviders().microsoft) throw new SsoRefused('not_configured', 'Microsoft sign-in is not set up.');
      return { key, kind: 'ENTRA', tenant: null, clientId: e.ENTRA_CLIENT_ID!, clientSecret: e.ENTRA_CLIENT_SECRET!, issuerUrl: entraIssuer(e.ENTRA_AUTHORITY, e.ENTRA_TENANT_ID!), companyId: null };
    }
    if (key === 'group-google') {
      if (!this.groupProviders().google) throw new SsoRefused('not_configured', 'Google sign-in is not set up.');
      return { key, kind: 'GOOGLE', tenant: null, clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET!, issuerUrl: e.GOOGLE_ISSUER, companyId: null };
    }
    const p = await this.db.system((tx) => tx.ssoProvider.findUnique({ where: { id: key } }));
    if (!p || !p.enabled) throw new SsoRefused('not_configured', 'This sign-in method is not available.');
    return {
      key,
      kind: p.kind as 'ENTRA' | 'GOOGLE',
      tenant: p.tenant,
      clientId: p.clientId,
      clientSecret: decryptSecret(p.clientSecretEnc, this.encKey),
      issuerUrl: p.kind === 'ENTRA' ? entraIssuer(e.ENTRA_AUTHORITY, p.tenant) : e.GOOGLE_ISSUER,
      companyId: p.companyId,
    };
  }

  private discover(issuerUrl: string): Promise<Issuer<BaseClient>> {
    let p = this.issuers.get(issuerUrl);
    if (!p) {
      p = Issuer.discover(issuerUrl);
      this.issuers.set(issuerUrl, p);
      p.catch(() => this.issuers.delete(issuerUrl));
    }
    return p;
  }

  private async client(cfg: ProviderConfig): Promise<BaseClient> {
    const issuer = await this.discover(cfg.issuerUrl);
    return new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [this.redirectUri()],
      response_types: ['code'],
    });
  }

  /** The domain route for an e-mail, if single sign-on is set up (and approved) for it. */
  private async route(domain: string) {
    const d = await this.db.system((tx) =>
      tx.ssoDomain.findUnique({ where: { domain } }).then(async (r) => {
        if (!r) return null;
        const company = await tx.company.findUnique({ where: { id: r.companyId }, select: { active: true, settings: true } });
        return { ...r, companyActive: !!company?.active };
      }),
    );
    if (!d || !d.approvedAt || !d.companyActive) return null;
    const key: ProviderKey = d.source === 'GROUP_ENTRA' ? 'group-entra' : d.source === 'GROUP_GOOGLE' ? 'group-google' : d.providerId!;
    if (key === 'group-entra' && !this.groupProviders().microsoft) return null;
    if (key === 'group-google' && !this.groupProviders().google) return null;
    if (d.source === 'COMPANY') {
      const p = await this.db.system((tx) => tx.ssoProvider.findUnique({ where: { id: key } }));
      if (!p?.enabled) return null;
      return { ...d, key, kind: p.kind };
    }
    return { ...d, key, kind: d.source === 'GROUP_ENTRA' ? 'ENTRA' : 'GOOGLE' };
  }

  /** What the login page should offer for an e-mail address (does not reveal whether the user exists). */
  async options(email?: string) {
    const group = this.groupProviders();
    const domain = email ? emailDomain(email) : null;
    const r = domain ? await this.route(domain) : null;
    return {
      microsoft: group.microsoft,
      google: group.google,
      sso: r ? { provider: r.kind === 'ENTRA' ? 'microsoft' : 'google' } : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Sign-in flow
  // ---------------------------------------------------------------------------

  /** Returns the identity provider URL to redirect the browser to. */
  async start(q: { email?: string; provider?: 'microsoft' | 'google'; app?: 'web' | 'mobile' }): Promise<string> {
    let key: ProviderKey;
    const domain = q.email ? emailDomain(q.email) : null;
    if (domain) {
      const r = await this.route(domain);
      if (!r) throw new SsoRefused('no_sso', 'Single sign-on is not set up for this e-mail domain. Sign in with your password.');
      key = r.key;
    } else if (q.provider) {
      key = q.provider === 'microsoft' ? 'group-entra' : 'group-google';
    } else {
      throw new BadRequestException('Give an e-mail address or a provider');
    }
    const cfg = await this.provider(key);
    const client = await this.client(cfg);
    const pending: PendingLogin = {
      providerKey: key,
      state: generators.state(),
      nonce: generators.nonce(),
      verifier: generators.codeVerifier(),
      app: q.app === 'mobile' ? 'mobile' : 'web',
    };
    await this.redis.client.set(`sso:state:${pending.state}`, JSON.stringify(pending), 'EX', STATE_TTL);
    return client.authorizationUrl({
      scope: 'openid email profile',
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: generators.codeChallenge(pending.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(q.email ? { login_hint: q.email } : {}),
      ...(cfg.kind === 'GOOGLE' ? { hd: cfg.tenant ?? domain ?? '*' } : {}),
    });
  }

  /**
   * Handles the identity provider's redirect and returns where to send the browser next:
   * the web app (or the driver app) with a one-time code, or with an error message.
   */
  async callback(params: Record<string, string | undefined>): Promise<string> {
    const raw = params.state ? await this.redis.client.getdel(`sso:state:${params.state}`) : null;
    const pending = raw ? (JSON.parse(raw) as PendingLogin) : null;
    const target = (app: 'web' | 'mobile', q: Record<string, string>) => {
      const base = app === 'mobile' ? env().MOBILE_SSO_REDIRECT : `${env().APP_URL.replace(/\/$/, '')}/sso`;
      return `${base}?${new URLSearchParams(q).toString()}`;
    };
    if (!pending) return target('web', { error: 'The sign-in link expired. Please try again.' });
    try {
      if (params.error) throw new SsoRefused('provider_error', params.error_description ?? 'Sign-in was cancelled.');
      const cfg = await this.provider(pending.providerKey);
      const client = await this.client(cfg);
      const tokens = await client.callback(
        this.redirectUri(),
        { code: params.code, state: params.state, iss: params.iss } as never,
        { state: pending.state, nonce: pending.nonce, code_verifier: pending.verifier },
      );
      const claims = tokens.claims() as unknown as Record<string, unknown>;
      const email = verifiedEmail(cfg, claims, env().ENTRA_TENANT_ID);
      const userId = await this.match(cfg, email, `${claims.iss as string}|${claims.sub as string}`);
      const code = randomBytes(32).toString('base64url');
      await this.redis.client.set(`sso:code:${code}`, userId, 'EX', CODE_TTL);
      return target(pending.app, { code });
    } catch (e) {
      const refused = e instanceof SsoRefused ? e : new SsoRefused('error', 'Single sign-on failed. Please try again or sign in with your password.');
      if (!(e instanceof SsoRefused)) this.log.warn(`SSO callback failed: ${(e as Error).message}`);
      await this.audit(null, null, 'sso.refused', { reason: refused.reason, provider: pending.providerKey });
      return target(pending.app, { error: refused.message });
    }
  }

  /** Finds the invited/active user for the verified e-mail and links (or checks) the SSO subject. */
  private async match(cfg: ProviderConfig, email: string, subject: string): Promise<string> {
    const domain = emailDomain(email)!;
    const route = await this.route(domain);
    if (!route || route.key !== cfg.key || route.source !== sourceFor(cfg.key)) {
      throw new SsoRefused('domain_not_allowed', `Single sign-on with this account is not set up for ${domain}.`);
    }
    if (cfg.companyId && cfg.companyId !== route.companyId) {
      throw new SsoRefused('domain_not_allowed', `Single sign-on with this account is not set up for ${domain}.`);
    }
    const user = await this.db.system((tx) => tx.user.findUnique({ where: { email }, include: { company: true } }));
    if (!user || user.companyId !== route.companyId) {
      await this.audit(route.companyId, null, 'sso.refused', { reason: 'unknown_user', email });
      throw new SsoRefused('unknown_user', 'There is no Fleet Management account for this e-mail. Ask your administrator for an invitation.');
    }
    if (!user.active || !user.company.active) {
      await this.audit(user.companyId, user.id, 'sso.refused', { reason: 'inactive' });
      throw new SsoRefused('inactive', 'Your account is deactivated. Contact your administrator.');
    }
    if (user.ssoSubject && user.ssoSubject !== subject) {
      await this.audit(user.companyId, user.id, 'sso.refused', { reason: 'subject_mismatch' });
      throw new SsoRefused('subject_mismatch', 'Your account is linked to a different sign-in identity. Ask your administrator to unlink it.');
    }
    const now = new Date();
    if (!user.ssoSubject) {
      const taken = await this.db.system((tx) => tx.user.findUnique({ where: { ssoSubject: subject }, select: { id: true } }));
      if (taken) throw new SsoRefused('subject_mismatch', 'This sign-in identity is already linked to another account.');
      await this.db.system((tx) => tx.user.update({ where: { id: user.id }, data: { ssoSubject: subject, ssoLinkedAt: now, lastLoginAt: now } }));
      await this.audit(user.companyId, user.id, 'sso.link', { provider: cfg.key, kind: cfg.kind });
    } else {
      await this.db.system((tx) => tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }));
    }
    await this.audit(user.companyId, user.id, 'sso.login', { provider: cfg.key, kind: cfg.kind });
    return user.id;
  }

  /** Exchanges the one-time code from the callback for the usual token pair. */
  async exchange(code: string): Promise<TokenPair> {
    const userId = await this.redis.client.getdel(`sso:code:${code}`);
    const user = userId
      ? await this.db.system((tx) => tx.user.findUnique({ where: { id: userId }, include: { company: true } }))
      : null;
    if (!user || !user.active || !user.company.active) throw new BadRequestException('The sign-in code is invalid or expired. Please sign in again.');
    return this.auth.issue(user);
  }

  private async audit(companyId: string | null, userId: string | null, action: string, payload: Record<string, unknown>) {
    if (!companyId) {
      this.log.log(`${action} ${JSON.stringify(payload)}`);
      return;
    }
    await this.db.system((tx) => tx.auditLog.create({ data: { companyId, userId, action, entity: 'user', entityId: userId, payload: payload as never } }));
  }

  // ---------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------

  private publicProvider = (p: { id: string; kind: string; tenant: string; clientId: string; enabled: boolean; createdAt: Date; updatedAt: Date }) => ({
    id: p.id,
    kind: p.kind,
    tenant: p.tenant,
    clientId: p.clientId,
    enabled: p.enabled,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });

  private checkTenant(kind: string, tenant: string) {
    if (kind === 'ENTRA' && (MULTI_TENANT.includes(tenant.toLowerCase()) || !/^[0-9a-f-]{36}$/i.test(tenant))) {
      throw new BadRequestException('Use the directory (tenant) ID of your organisation, a GUID like 1b2c…');
    }
    if (kind === 'GOOGLE' && !emailDomain(`x@${tenant}`)) throw new BadRequestException('Use your Google Workspace domain, e.g. example.com');
  }

  async settings(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [providers, domains] = await Promise.all([
        tx.ssoProvider.findMany({ orderBy: { createdAt: 'asc' } }),
        tx.ssoDomain.findMany({ orderBy: { domain: 'asc' } }),
      ]);
      return {
        group: this.groupProviders(),
        redirectUri: this.redirectUri(),
        mobileRedirect: env().MOBILE_SSO_REDIRECT,
        providers: providers.map(this.publicProvider),
        domains,
      };
    });
  }

  async createProvider(user: AuthUser, body: SsoProviderInput) {
    this.checkTenant(body.kind, body.tenant);
    return this.db.tenant(user.companyId, async (tx) => {
      const p = await tx.ssoProvider.create({
        data: {
          companyId: user.companyId,
          kind: body.kind,
          tenant: body.kind === 'GOOGLE' ? body.tenant.toLowerCase() : body.tenant.toLowerCase(),
          clientId: body.clientId,
          clientSecretEnc: encryptSecret(body.clientSecret, this.encKey),
          enabled: body.enabled,
        },
      });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.provider.create', entity: 'sso_provider', entityId: p.id, payload: { kind: p.kind, tenant: p.tenant, clientId: p.clientId } } });
      return this.publicProvider(p);
    });
  }

  async updateProvider(user: AuthUser, id: string, body: Partial<SsoProviderInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      const p = await tx.ssoProvider.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Provider not found');
      const kind = body.kind ?? p.kind;
      const tenant = body.tenant ?? p.tenant;
      this.checkTenant(kind, tenant);
      const next = await tx.ssoProvider.update({
        where: { id },
        data: {
          kind,
          tenant: tenant.toLowerCase(),
          ...(body.clientId ? { clientId: body.clientId } : {}),
          ...(body.clientSecret ? { clientSecretEnc: encryptSecret(body.clientSecret, this.encKey) } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
      });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.provider.update', entity: 'sso_provider', entityId: id, payload: { kind, tenant, enabled: next.enabled, secretChanged: !!body.clientSecret } } });
      return this.publicProvider(next);
    });
  }

  async deleteProvider(user: AuthUser, id: string) {
    await this.db.tenant(user.companyId, async (tx) => {
      const p = await tx.ssoProvider.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Provider not found');
      await tx.ssoDomain.deleteMany({ where: { providerId: id } });
      await tx.ssoProvider.delete({ where: { id } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.provider.delete', entity: 'sso_provider', entityId: id, payload: { kind: p.kind, tenant: p.tenant } } });
    });
  }

  /** Checks that the provider's discovery document can be loaded. */
  async testProvider(user: AuthUser, id: string) {
    const p = await this.db.tenant(user.companyId, (tx) => tx.ssoProvider.findUnique({ where: { id } }));
    if (!p) throw new NotFoundException('Provider not found');
    try {
      const cfg = await this.provider(id);
      const issuer = await this.discover(cfg.issuerUrl);
      return { ok: true, issuer: issuer.issuer as string };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async addDomain(user: AuthUser, body: SsoDomainInput) {
    const exists = await this.db.system((tx) => tx.ssoDomain.findUnique({ where: { domain: body.domain }, select: { companyId: true } }));
    if (exists) throw new ConflictException(exists.companyId === user.companyId ? 'This domain is already set up' : 'This domain is used by another company of the group');
    return this.db.tenant(user.companyId, async (tx) => {
      if (body.source === 'COMPANY') {
        const p = await tx.ssoProvider.findUnique({ where: { id: body.providerId! } });
        if (!p) throw new BadRequestException('Provider not found');
      }
      // A company's own identity provider is trusted for its domains; the group's shared
      // providers need a super admin's approval so one company cannot claim another's domain.
      const d = await tx.ssoDomain.create({
        data: {
          companyId: user.companyId,
          domain: body.domain,
          source: body.source,
          providerId: body.source === 'COMPANY' ? body.providerId! : null,
          approvedAt: body.source === 'COMPANY' ? new Date() : null,
          approvedBy: body.source === 'COMPANY' ? user.userId : null,
        },
      });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.domain.create', entity: 'sso_domain', entityId: d.id, payload: { domain: d.domain, source: d.source } } });
      return d;
    });
  }

  async deleteDomain(user: AuthUser, id: string) {
    await this.db.tenant(user.companyId, async (tx) => {
      const d = await tx.ssoDomain.findUnique({ where: { id } });
      if (!d) throw new NotFoundException('Domain not found');
      await tx.ssoDomain.delete({ where: { id } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.domain.delete', entity: 'sso_domain', entityId: id, payload: { domain: d.domain } } });
    });
  }

  /** Super admins: domains of all companies using the group providers. */
  async groupDomains() {
    return this.db.system(async (tx) => {
      const rows = await tx.ssoDomain.findMany({ where: { source: { in: ['GROUP_ENTRA', 'GROUP_GOOGLE'] } }, orderBy: [{ approvedAt: { sort: 'asc', nulls: 'first' } }, { domain: 'asc' }] });
      const companies = await tx.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, code: true, name: true } });
      const byId = new Map(companies.map((c) => [c.id, c]));
      return rows.map((r) => ({ ...r, company: byId.get(r.companyId) ?? null }));
    });
  }

  async approveDomain(user: AuthUser, id: string, approve: boolean) {
    return this.db.system(async (tx) => {
      const d = await tx.ssoDomain.findUnique({ where: { id } });
      if (!d || d.source === 'COMPANY') throw new NotFoundException('Domain not found');
      const next = await tx.ssoDomain.update({ where: { id }, data: approve ? { approvedAt: new Date(), approvedBy: user.userId } : { approvedAt: null, approvedBy: null } });
      await tx.auditLog.create({ data: { companyId: d.companyId, userId: user.userId, action: approve ? 'sso.domain.approve' : 'sso.domain.revoke', entity: 'sso_domain', entityId: id, payload: { domain: d.domain, source: d.source } } });
      return next;
    });
  }

  async unlink(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundException('User not found');
      await tx.user.update({ where: { id }, data: { ssoSubject: null, ssoLinkedAt: null } });
      await tx.auditLog.create({ data: { companyId: user.companyId, userId: user.userId, action: 'sso.unlink', entity: 'user', entityId: id, payload: { email: u.email } } });
      return { ok: true };
    });
  }
}
