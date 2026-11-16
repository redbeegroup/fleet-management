import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

/** Public page behind the e-mailed link: accept an invitation or reset a password. */
export function SetPasswordPage() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = useQuery({
    queryKey: ['token-info', token],
    queryFn: async () => {
      const res = await fetch(`/api/auth/token-info?token=${encodeURIComponent(token)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'This link is invalid or has expired.');
      return body as { kind: 'INVITE' | 'RESET'; email: string; fullName: string };
    },
    enabled: token.length >= 20,
    retry: false,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords do not match');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(
          b.errors?.map((x: { message: string }) => x.message).join('; ') ??
            b.message ??
            'Could not set the password',
        );
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
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
        {!token || info.isError ? (
          <>
            <p className="error">
              {(info.error as Error | null)?.message ?? 'This link is incomplete.'}
            </p>
            <Link to="/login">Back to sign-in (you can ask for a new link there)</Link>
          </>
        ) : done ? (
          <>
            <p className="success">Your password is set.</p>
            <Link className="btn btn-primary" to="/login">
              Sign in
            </Link>
            <p className="muted small">
              Drivers and managers can now also sign in to the mobile app.
            </p>
          </>
        ) : (
          <>
            <h2>
              {info.data?.kind === 'INVITE'
                ? `Welcome, ${info.data.fullName}`
                : 'Choose a new password'}
            </h2>
            {info.data && <p className="muted">{info.data.email}</p>}
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </label>
            <label>
              Repeat the password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </label>
            <p className="muted small">
              At least 10 characters, with letters and at least one digit.
            </p>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy || !info.data}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
