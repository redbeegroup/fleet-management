import { createHmac } from 'node:crypto';
import { assertSafeTarget, isPrivateAddress, MAX_ATTEMPTS, nextAttempt, signPayload } from './webhook-delivery';

describe('webhook delivery helpers', () => {
  it('signs timestamp + body with HMAC-SHA256', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')}`);
  });
  it('backs off and gives up after the last attempt', () => {
    const now = new Date('2026-11-14T00:00:00Z');
    expect(nextAttempt(1, now)!.getTime() - now.getTime()).toBe(60_000);
    expect(nextAttempt(7, now)!.getTime() - now.getTime()).toBe(12 * 3_600_000);
    expect(nextAttempt(MAX_ATTEMPTS, now)).toBeNull();
  });
  it('detects private, loopback and link-local addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
  });
  it('refuses insecure, credentialed and private targets', async () => {
    const strict = { allowInsecure: false, allowPrivate: false };
    await expect(assertSafeTarget('http://example.com/h', strict)).rejects.toThrow(/https/);
    await expect(assertSafeTarget('https://u:p@example.com/h', strict)).rejects.toThrow(/Credentials/);
    await expect(assertSafeTarget('https://127.0.0.1/h', strict)).rejects.toThrow(/private/);
    await expect(assertSafeTarget('https://[::1]/h', strict)).rejects.toThrow(/private/);
    await expect(assertSafeTarget('http://127.0.0.1:9/h', { allowInsecure: true, allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
