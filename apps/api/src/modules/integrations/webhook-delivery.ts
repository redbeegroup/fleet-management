import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Delays after failed attempt 1..7; the 8th failure is final (~22 h in total). */
export const RETRY_DELAYS_S = [60, 300, 900, 3_600, 10_800, 21_600, 43_200];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;
/** Consecutive failed deliveries after which an endpoint is switched off. */
export const DISABLE_AFTER = 20;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** `X-FMS-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Next attempt time after `attempts` failed attempts, or null when retries are exhausted. */
export function nextAttempt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + RETRY_DELAYS_S[attempts - 1] * 1000);
}

/** Loopback, private (RFC 1918 / ULA), link-local, CGNAT, unspecified and metadata addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
  }
  return true;
}

/** Throws when the URL is not an allowed webhook target. */
export async function assertSafeTarget(raw: string, opts: { allowInsecure: boolean; allowPrivate: boolean }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && opts.allowInsecure)) throw new Error('Webhook URLs must use https');
  if (url.username || url.password) throw new Error('Credentials in the URL are not allowed');
  if (!opts.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('Webhook URL resolves to a private or local address');
  }
  return url;
}
