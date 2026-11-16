import { decryptSecret, emailDomain, encryptSecret, sourceFor, SsoRefused, verifiedEmail } from './sso-core';

describe('sso-core', () => {
  it('encrypts and decrypts secrets; a wrong key fails', () => {
    const enc = encryptSecret('s3cr3t-value', 'key-aaaaaaaaaaaaaaaa');
    expect(enc).not.toContain('s3cr3t');
    expect(decryptSecret(enc, 'key-aaaaaaaaaaaaaaaa')).toBe('s3cr3t-value');
    expect(() => decryptSecret(enc, 'key-bbbbbbbbbbbbbbbb')).toThrow();
    expect(encryptSecret('x', 'k'.repeat(16))).not.toBe(encryptSecret('x', 'k'.repeat(16)));
  });

  it('parses e-mail domains', () => {
    expect(emailDomain('A.B@Example.COM')).toBe('example.com');
    expect(emailDomain('nope')).toBeNull();
    expect(emailDomain('a@localhost')).toBeNull();
  });

  const entra = { kind: 'ENTRA' as const, tenant: 'tid-1', key: 'p1' };
  it('Entra: tenant must match; email or preferred_username', () => {
    expect(verifiedEmail(entra, { tid: 'TID-1', preferred_username: 'Ann@corp.com' })).toBe('ann@corp.com');
    expect(verifiedEmail(entra, { tid: 'tid-1', email: 'b@corp.com', preferred_username: 'x@y.com' })).toBe('b@corp.com');
    expect(() => verifiedEmail(entra, { tid: 'other', email: 'b@corp.com' })).toThrow(SsoRefused);
    expect(() => verifiedEmail(entra, { tid: 'tid-1' })).toThrow(/no e-mail/);
    const group = { kind: 'ENTRA' as const, tenant: null, key: 'group-entra' };
    expect(verifiedEmail(group, { tid: 'g', email: 'c@grp.com' }, 'g')).toBe('c@grp.com');
    expect(() => verifiedEmail(group, { tid: 'g', email: 'c@grp.com' })).toThrow(/another organisation/);
  });

  it('Google: verified e-mail and Workspace domain (hd)', () => {
    const company = { kind: 'GOOGLE' as const, tenant: 'shop.com', key: 'p2' };
    expect(verifiedEmail(company, { email: 'a@shop.com', email_verified: true, hd: 'shop.com' })).toBe('a@shop.com');
    expect(() => verifiedEmail(company, { email: 'a@shop.com', email_verified: false, hd: 'shop.com' })).toThrow(/not verified/);
    expect(() => verifiedEmail(company, { email: 'a@gmail.com', email_verified: true })).toThrow(/Workspace/);
    const group = { kind: 'GOOGLE' as const, tenant: null, key: 'group-google' };
    expect(verifiedEmail(group, { email: 'z@grp.com', email_verified: true, hd: 'grp.com' })).toBe('z@grp.com');
    expect(() => verifiedEmail(group, { email: 'z@grp.com', email_verified: true, hd: 'other.com' })).toThrow(SsoRefused);
  });

  it('maps providers to domain sources', () => {
    expect(sourceFor('group-entra')).toBe('GROUP_ENTRA');
    expect(sourceFor('group-google')).toBe('GROUP_GOOGLE');
    expect(sourceFor('uuid')).toBe('COMPANY');
  });
});
