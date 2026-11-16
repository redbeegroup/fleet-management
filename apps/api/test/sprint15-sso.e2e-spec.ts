/**
 * Sprint 15: single sign-on (OpenID Connect) against a fake identity provider that plays
 * Microsoft Entra ID (per-tenant issuers) and Google (hd + email_verified claims).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { ApiAppModule } from '../src/app.module';
import { resetEnvCache } from '../src/common/config/env';

const PASSWORD = 'E2ePassword123!';
const run = `s15${Date.now().toString(36)}`;
const GROUP_TENANT = '11111111-2222-3333-4444-555555555555';
const B_TENANT = `${run}b.test`;
const dom = (tag: string) => `${tag}-${run}.test`;

/** A minimal OpenID provider: discovery, JWKS, token endpoint; the test plays the user at /authorize. */
class FakeIdp {
  server!: Server;
  base = '';
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly codes = new Map<string, { iss: string; aud: string; challenge: string; claims: Record<string, unknown> }>();
  readonly clients = new Map<string, string>(); // client id → secret

  async listen() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => this.handle(req.method!, req.url!, req.headers.authorization, body, res));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private json(res: import('node:http').ServerResponse, status: number, v: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v));
  }

  private handle(method: string, url: string, authz: string | undefined, body: string, res: import('node:http').ServerResponse) {
    const path = url.split('?')[0];
    const disc = /^\/(entra\/[^/]+\/v2\.0|google)\/\.well-known\/openid-configuration$/.exec(path);
    if (disc) {
      return this.json(res, 200, {
        issuer: `${this.base}/${disc[1]}`,
        authorization_endpoint: `${this.base}/authorize`,
        token_endpoint: `${this.base}/token`,
        jwks_uri: `${this.base}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (path === '/jwks') return this.json(res, 200, { keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    if (path === '/token' && method === 'POST') {
      const p = new URLSearchParams(body);
      const [id, secret] = Buffer.from((authz ?? '').replace(/^Basic /, ''), 'base64').toString().split(':').map(decodeURIComponent);
      const c = this.codes.get(p.get('code') ?? '');
      this.codes.delete(p.get('code') ?? '');
      if (!c || this.clients.get(id) !== secret || c.aud !== id) return this.json(res, 400, { error: 'invalid_grant' });
      const verifier = p.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return this.json(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
      return this.json(res, 200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: this.idToken(c) });
    }
    this.json(res, 404, { error: 'not_found' });
  }

  private idToken(c: { iss: string; aud: string; claims: Record<string, unknown> }) {
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const payload = enc({ iss: c.iss, aud: c.aud, iat: now, exp: now + 300, ...c.claims });
    const sig = sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), this.keys.privateKey).toString('base64url');
    return `${head}.${payload}.${sig}`;
  }

  /**
   * The user signs in at the provider. Returns the callback query for the FMS callback.
   * `issuerPath` is 'entra/<tenant>/v2.0' or 'google'.
   */
  authorize(location: string, issuerPath: string, claims: Record<string, unknown>) {
    const u = new URL(location);
    expect(u.origin + u.pathname).toBe(`${this.base}/authorize`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, {
      iss: `${this.base}/${issuerPath}`,
      aud: u.searchParams.get('client_id')!,
      challenge: u.searchParams.get('code_challenge')!,
      claims: { nonce: u.searchParams.get('nonce'), ...claims },
    });
    return { code, state: u.searchParams.get('state')! };
  }
}

describe('Sprint 15 single sign-on (e2e)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  const idp = new FakeIdp();
  const companyIds: string[] = [];
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (k: string) => ({ Authorization: `Bearer ${t[k]}` });
  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });
  const APP_URL = 'http://fms.test';
  const saved = { ...process.env };

  /** start → provider → callback; returns the final redirect URL. */
  async function ssoFlow(start: string, issuerPath: string, claims: Record<string, unknown>) {
    const s = await http().get(`/api/auth/sso/start?${start}`).expect(302);
    if (!s.headers.location.startsWith(idp.base)) return new URL(s.headers.location);
    const q = idp.authorize(s.headers.location, issuerPath, claims);
    const cb = await http().get(`/api/auth/sso/callback?${new URLSearchParams(q)}`).expect(302);
    return new URL(cb.headers.location);
  }

  beforeAll(async () => {
    await idp.listen();
    idp.clients.set('group-entra-client', 'group-entra-secret');
    idp.clients.set('group-google-client', 'group-google-secret');
    idp.clients.set('b-google-client', 'b-google-secret');
    Object.assign(process.env, {
      APP_URL,
      ENTRA_AUTHORITY: `${idp.base}/entra`,
      GOOGLE_ISSUER: `${idp.base}/google`,
      ENTRA_TENANT_ID: GROUP_TENANT,
      ENTRA_CLIENT_ID: 'group-entra-client',
      ENTRA_CLIENT_SECRET: 'group-entra-secret',
      GOOGLE_CLIENT_ID: 'group-google-client',
      GOOGLE_CLIENT_SECRET: 'group-google-secret',
      SSO_ENCRYPTION_KEY: 'e2e-sso-encryption-key-0123456789',
    });
    resetEnvCache();

    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
    const passwordHash = await argon2.hash(PASSWORD);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const tag of ['A', 'B']) {
        const c = await tx.company.create({ data: { code: `${run}${tag}`.toUpperCase(), name: `S15 ${tag}` } });
        companyIds.push(c.id);
        await tx.user.create({ data: { companyId: c.id, email: `${tag.toLowerCase()}-${run}@e2e.local`, fullName: `${tag} admin`, passwordHash, roles: ['COMPANY_ADMIN'] } });
      }
      const [a, b] = companyIds;
      await tx.user.create({ data: { companyId: a, email: `s-${run}@e2e.local`, fullName: 'Super', passwordHash, roles: ['SUPER_ADMIN'] } });
      // Invited users (no password yet) of each company at their SSO domains.
      id.ua = (await tx.user.create({ data: { companyId: a, email: `ann@${dom('a')}`, fullName: 'Ann', passwordHash: '!', roles: ['DISPATCHER'], invitedAt: new Date() } })).id;
      id.ua2 = (await tx.user.create({ data: { companyId: a, email: `off@${dom('a')}`, fullName: 'Off', passwordHash: '!', roles: ['VIEWER'], active: false } })).id;
      id.ub = (await tx.user.create({ data: { companyId: b, email: `bob@${B_TENANT}`, fullName: 'Bob', passwordHash, roles: ['FLEET_MANAGER'] } })).id;
    });
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    for (const k of ['a', 'b', 's']) t[k] = (await login(`${k}-${run}@e2e.local`).expect(200)).body.accessToken;
  });

  beforeEach(() => {
    const store = app.get<ThrottlerStorageService>(getStorageToken());
    store.storage.clear();
    (store as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  });

  afterAll(async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      for (const companyId of companyIds) {
        await tx.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1::uuid)`, companyId);
        for (const tbl of ['sso_domains', 'sso_providers', 'auth_tokens', 'audit_logs', 'users']) {
          await tx.$executeRawUnsafe(`DELETE FROM ${tbl} WHERE company_id = $1::uuid`, companyId);
        }
        await tx.company.delete({ where: { id: companyId } });
      }
    });
    await admin.$disconnect();
    await app?.close();
    idp.server.closeAllConnections();
    idp.server.close();
    process.env = saved;
    resetEnvCache();
  });

  it('offers the group providers; no SSO for an unknown domain', async () => {
    const o = await http().get(`/api/auth/sso/options?email=x@${dom('a')}`).expect(200);
    expect(o.body).toEqual({ microsoft: true, google: true, sso: null });
    const u = await ssoFlow(`email=ann@${dom('a')}`, '', {});
    expect(u.origin + u.pathname).toBe(`${APP_URL}/sso`);
    expect(u.searchParams.get('error')).toMatch(/not set up/);
  });

  it('a group Entra domain needs a super admin approval', async () => {
    const d = await http().post('/api/settings/sso/domains').set(auth('a')).send({ domain: dom('a'), source: 'GROUP_ENTRA' }).expect(201);
    expect(d.body.approvedAt).toBeNull();
    id.domA = d.body.id;
    expect((await http().get(`/api/auth/sso/options?email=x@${dom('a')}`)).body.sso).toBeNull();
    await http().get('/api/admin/sso-domains').set(auth('a')).expect(403);
    const list = await http().get('/api/admin/sso-domains').set(auth('s')).expect(200);
    expect(list.body.find((r: { id: string }) => r.id === id.domA).company.code).toBe(`${run}A`.toUpperCase());
    await http().post(`/api/admin/sso-domains/${id.domA}/approve`).set(auth('s')).expect(200);
    expect((await http().get(`/api/auth/sso/options?email=x@${dom('a')}`)).body.sso).toEqual({ provider: 'microsoft' });
  });

  it('an invited user signs in with the group Entra tenant; the subject is linked', async () => {
    const u = await ssoFlow(`email=ann@${dom('a')}`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'ann-sub', tid: GROUP_TENANT, preferred_username: `Ann@${dom('a')}` });
    expect(u.origin + u.pathname).toBe(`${APP_URL}/sso`);
    const code = u.searchParams.get('code')!;
    expect(code).toBeTruthy();
    const pair = await http().post('/api/auth/sso/exchange').send({ code }).expect(200);
    expect(pair.body.user.email).toBe(`ann@${dom('a')}`);
    expect(pair.body.refreshToken).toBeTruthy();
    await http().get('/api/auth/me').set({ Authorization: `Bearer ${pair.body.accessToken}` }).expect(200);
    // The one-time code works once.
    await http().post('/api/auth/sso/exchange').send({ code }).expect(400);
    const users = await http().get('/api/users').set(auth('a')).expect(200);
    expect(users.body.find((x: { id: string }) => x.id === id.ua).ssoLinkedAt).toBeTruthy();
    const logs = await admin.$queryRawUnsafe<{ action: string }[]>(`SELECT action FROM audit_logs WHERE user_id = $1::uuid ORDER BY id`, id.ua);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['sso.link', 'sso.login']));
  });

  it('refuses another tenant, another subject, unknown and inactive users', async () => {
    const wrongTenant = await ssoFlow(`email=ann@${dom('a')}`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'ann-sub', tid: '99999999-2222-3333-4444-555555555555', email: `ann@${dom('a')}` });
    expect(wrongTenant.searchParams.get('error')).toMatch(/another organisation/);
    const otherSub = await ssoFlow(`email=ann@${dom('a')}`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'someone-else', tid: GROUP_TENANT, email: `ann@${dom('a')}` });
    expect(otherSub.searchParams.get('error')).toMatch(/different sign-in identity/);
    const unknown = await ssoFlow(`provider=microsoft`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'x1', tid: GROUP_TENANT, email: `nobody@${dom('a')}` });
    expect(unknown.searchParams.get('error')).toMatch(/no Fleet Management account/);
    const inactive = await ssoFlow(`email=off@${dom('a')}`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'x2', tid: GROUP_TENANT, email: `off@${dom('a')}` });
    expect(inactive.searchParams.get('error')).toMatch(/deactivated/);
    // A user of another company cannot come in through company A's domain route.
    const foreign = await ssoFlow(`provider=microsoft`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'x3', tid: GROUP_TENANT, email: `bob@${B_TENANT}` });
    expect(foreign.searchParams.get('error')).toMatch(/not set up/);
    // Tampered or replayed state.
    const bad = await http().get('/api/auth/sso/callback?code=x&state=nope').expect(302);
    expect(new URL(bad.headers.location).searchParams.get('error')).toMatch(/expired/);
  });

  it('unlinking lets the user link a new identity', async () => {
    await http().post(`/api/users/${id.ua}/unlink-sso`).set(auth('b')).expect(404);
    await http().post(`/api/users/${id.ua}/unlink-sso`).set(auth('a')).expect(200);
    const u = await ssoFlow(`email=ann@${dom('a')}`, `entra/${GROUP_TENANT}/v2.0`, { sub: 'ann-new', tid: GROUP_TENANT, email: `ann@${dom('a')}` });
    expect(u.searchParams.get('code')).toBeTruthy();
  });

  it("a company's own Google Workspace provider; secrets are never returned", async () => {
    await http().post('/api/settings/sso/providers').set(auth('b')).send({ kind: 'ENTRA', tenant: 'common', clientId: 'x-client', clientSecret: 'x-secret' }).expect(400);
    const p = await http().post('/api/settings/sso/providers').set(auth('b')).send({ kind: 'GOOGLE', tenant: B_TENANT, clientId: 'b-google-client', clientSecret: 'b-google-secret' }).expect(201);
    expect(JSON.stringify(p.body)).not.toContain('b-google-secret');
    id.provB = p.body.id;
    const row = await admin.$queryRawUnsafe<{ client_secret_enc: string }[]>(`SELECT client_secret_enc FROM sso_providers WHERE id = $1::uuid`, id.provB);
    expect(row[0].client_secret_enc).not.toContain('b-google-secret');
    expect((await http().post(`/api/settings/sso/providers/${id.provB}/test`).set(auth('b')).expect(200)).body).toEqual({ ok: true, issuer: `${idp.base}/google` });
    const d = await http().post('/api/settings/sso/domains').set(auth('b')).send({ domain: B_TENANT, source: 'COMPANY', providerId: id.provB }).expect(201);
    expect(d.body.approvedAt).toBeTruthy();

    const unverified = await ssoFlow(`email=bob@${B_TENANT}`, 'google', { sub: 'bob', email: `bob@${B_TENANT}`, email_verified: false, hd: B_TENANT });
    expect(unverified.searchParams.get('error')).toMatch(/not verified/);
    const personal = await ssoFlow(`email=bob@${B_TENANT}`, 'google', { sub: 'bob', email: `bob@${B_TENANT}`, email_verified: true });
    expect(personal.searchParams.get('error')).toMatch(/Workspace/);
    // The driver app gets the one-time code on its deep link.
    const mobile = await ssoFlow(`email=bob@${B_TENANT}&app=mobile`, 'google', { sub: 'bob', email: `bob@${B_TENANT}`, email_verified: true, hd: B_TENANT });
    expect(mobile.protocol).toBe('fmsdriver:');
    const pair = await http().post('/api/auth/sso/exchange').send({ code: mobile.searchParams.get('code') }).expect(200);
    expect(pair.body.user.id).toBe(id.ub);
  });

  it('keeps providers and domains per company', async () => {
    const a = await http().get('/api/settings/sso').set(auth('a')).expect(200);
    expect(a.body.providers).toEqual([]);
    expect(a.body.domains.map((d: { domain: string }) => d.domain)).toEqual([dom('a')]);
    expect(a.body.redirectUri).toBe(`${APP_URL}/api/auth/sso/callback`);
    await http().post('/api/settings/sso/domains').set(auth('b')).send({ domain: dom('a'), source: 'GROUP_ENTRA' }).expect(409);
    await http().delete(`/api/settings/sso/domains/${id.domA}`).set(auth('b')).expect(404);
    await http().patch(`/api/settings/sso/providers/${id.provB}`).set(auth('a')).send({ enabled: false }).expect(404);
    await http().post('/api/settings/sso/domains').set(auth('a')).send({ domain: `x.${dom('a')}`, source: 'COMPANY', providerId: id.provB }).expect(400);
    await http().get('/api/settings/sso').set({ Authorization: `Bearer ${(await login(`bob@${B_TENANT}`).expect(200)).body.accessToken}` }).expect(403);
  });

  it('a company can switch off password sign-in (not for super admins)', async () => {
    await http().patch('/api/company/settings').set(auth('b')).send({ security: { passwordLogin: false } }).expect(200);
    const r = await login(`bob@${B_TENANT}`).expect(401);
    expect(r.body.message).toMatch(/single sign-on/);
    await http().patch('/api/company/settings').set(auth('b')).send({ security: { passwordLogin: true } }).expect(200);
    await login(`bob@${B_TENANT}`).expect(200);
    await http().patch('/api/company/settings').set(auth('a')).send({ security: { passwordLogin: false } }).expect(200);
    await login(`s-${run}@e2e.local`).expect(200);
    await login(`a-${run}@e2e.local`).expect(401);
  });
});
