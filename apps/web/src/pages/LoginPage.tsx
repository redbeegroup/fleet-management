import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, login } from '../lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [group, setGroup] = useState<{ microsoft: boolean; google: boolean }>({ microsoft: false, google: false });
  /** Single sign-on set up for the typed e-mail's domain. */
  const [sso, setSso] = useState<'microsoft' | 'google' | null>(null);
  useEffect(() => {
    if (params.get('error')) setError(params.get('error'));
    fetch('/api/auth/sso/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setGroup({ microsoft: o.microsoft, google: o.google }))
      .catch(() => undefined);
  }, [params]);
  async function checkSso(value: string) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return setSso(null);
    const r = await fetch(`/api/auth/sso/options?email=${encodeURIComponent(value)}`).catch(() => null);
    const o = r?.ok ? await r.json() : null;
    setSso(o?.sso?.provider ?? null);
  }
  const startSso = (provider: 'microsoft' | 'google') =>
    window.location.assign(
      `/api/auth/sso/start?${sso && email ? `email=${encodeURIComponent(email)}` : `provider=${provider}`}`,
    );
  const PROVIDER = { microsoft: 'Microsoft', google: 'Google' } as const;

  async function requestReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) throw new Error('Too many requests. Try again in a minute.');
      setSent((await res.json()).message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (forgot)
    return (
      <div className="login">
        <form className="card login-card" onSubmit={requestReset}>
          <div className="brand">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <span>Fleet Management</span>
          </div>
          <h2>Reset your password</h2>
          {sent ? (
            <p className="success">{sent}</p>
          ) : (
            <>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary" disabled={busy}>
                Send reset link
              </button>
            </>
          )}
          <button type="button" className="link" onClick={() => (setForgot(false), setSent(null))}>
            Back to sign-in
          </button>
        </form>
      </div>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const msg = err instanceof ApiError ? String((err.body as { message?: string })?.message ?? '') : '';
      setError(
        err instanceof ApiError && err.status === 401
          ? /single sign-on/i.test(msg)
            ? msg
            : 'Invalid email or password'
          : 'Sign-in failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>Fleet Management</span>
        </div>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => void checkSso(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        {sso && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => startSso(sso)}>
              Continue with {PROVIDER[sso]}
            </button>
            <p className="muted small">Your organisation signs in with {PROVIDER[sso]}.</p>
          </>
        )}
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className={sso ? 'btn' : 'btn btn-primary'} disabled={busy}>
          {busy ? 'Signing in…' : sso ? 'Sign in with password' : 'Sign in'}
        </button>
        <button type="button" className="link" onClick={() => setForgot(true)}>
          Forgot your password?
        </button>
        {!sso && (group.microsoft || group.google) && (
          <>
            <div className="divider">
              <span>or</span>
            </div>
            {group.microsoft && (
              <button type="button" className="btn sso-btn" onClick={() => startSso('microsoft')}>
                <MicrosoftMark /> Sign in with Microsoft
              </button>
            )}
            {group.google && (
              <button type="button" className="btn sso-btn" onClick={() => startSso('google')}>
                <GoogleMark /> Sign in with Google
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0" y="0" width="7.5" height="7.5" fill="#f25022" />
      <rect x="8.5" y="0" width="7.5" height="7.5" fill="#7fba00" />
      <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00a4ef" />
      <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#ffb900" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
