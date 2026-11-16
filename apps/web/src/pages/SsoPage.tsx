import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ssoExchange } from '../lib/api';

/** Landing page after Microsoft / Google sign-in: exchanges the one-time code for a session. */
export function SsoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(params.get('error'));
  const started = useRef(false);
  useEffect(() => {
    const code = params.get('code');
    if (!code || started.current) return;
    started.current = true;
    ssoExchange(code)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setError('The sign-in link expired. Please try again.'));
  }, [params, navigate]);
  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>Fleet Management</span>
        </div>
        {error ? (
          <>
            <h2>Sign-in did not work</h2>
            <p className="error">{error}</p>
            <Link className="btn btn-primary" to="/login">
              Back to sign-in
            </Link>
          </>
        ) : (
          <p className="muted">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
