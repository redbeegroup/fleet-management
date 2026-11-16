import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Pure helpers for single sign-on: secret encryption, domain parsing and ID-token claim checks. */

export type SsoKind = 'ENTRA' | 'GOOGLE';
/** 'group-entra' | 'group-google' | a company provider id. */
export type ProviderKey = string;

export interface ProviderConfig {
  key: ProviderKey;
  kind: SsoKind;
  /** Entra tenant id, or the Google Workspace domain (company providers only). */
  tenant: string | null;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  companyId: string | null;
}

const keyOf = (secret: string) => createHash('sha256').update(`fms-sso:${secret}`).digest();

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(value: string, secret: string): string {
  const [iv, tag, enc] = value.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !enc) throw new Error('Malformed secret');
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function emailDomain(email: string): string | null {
  const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  return m ? m[1] : null;
}

/** Entra tenants that are not a single organisation cannot be used: anyone could sign in. */
export const MULTI_TENANT = ['common', 'organizations', 'consumers'];

export function entraIssuer(authority: string, tenant: string): string {
  return `${authority.replace(/\/$/, '')}/${tenant}/v2.0`;
}

export class SsoRefused extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checks the ID token claims that openid-client does not know about (it already checked
 * signature, issuer, audience, expiry and nonce) and returns the verified e-mail.
 */
export function verifiedEmail(provider: Pick<ProviderConfig, 'kind' | 'tenant' | 'key'>, claims: Record<string, unknown>, groupEntraTenant?: string): string {
  const str = (k: string) => (typeof claims[k] === 'string' ? (claims[k] as string) : undefined);
  if (provider.kind === 'ENTRA') {
    const tid = str('tid');
    const expected = provider.key === 'group-entra' ? groupEntraTenant : provider.tenant;
    if (!tid || !expected || tid.toLowerCase() !== expected.toLowerCase()) {
      throw new SsoRefused('wrong_tenant', 'This Microsoft account belongs to another organisation.');
    }
    const email = (str('email') ?? str('preferred_username'))?.toLowerCase();
    if (!email || !emailDomain(email)) throw new SsoRefused('no_email', 'Your Microsoft account has no e-mail address.');
    return email;
  }
  const email = str('email')?.toLowerCase();
  if (!email || !emailDomain(email)) throw new SsoRefused('no_email', 'Your Google account has no e-mail address.');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new SsoRefused('unverified_email', 'Your Google e-mail address is not verified.');
  }
  const hd = str('hd')?.toLowerCase();
  // Only Google Workspace accounts of the organisation's own domain (not personal Gmail).
  const expectedHd = provider.key === 'group-google' ? emailDomain(email) : provider.tenant?.toLowerCase();
  if (!hd || hd !== expectedHd) {
    throw new SsoRefused('wrong_tenant', 'Sign in with your organisation Google Workspace account.');
  }
  return email;
}

/** Domain record source that a provider may serve. */
export function sourceFor(key: ProviderKey): 'GROUP_ENTRA' | 'GROUP_GOOGLE' | 'COMPANY' {
  return key === 'group-entra' ? 'GROUP_ENTRA' : key === 'group-google' ? 'GROUP_GOOGLE' : 'COMPANY';
}
