import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, login } from '../lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

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
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid email or password'
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
            autoComplete="username"
            required
          />
        </label>
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
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="link" onClick={() => setForgot(true)}>
          Forgot your password?
        </button>
      </form>
    </div>
  );
}
