import { Permission, Role } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import { formatDate } from '../lib/format';
import type { CompanySettings } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

interface Provider {
  id: string;
  kind: 'ENTRA' | 'GOOGLE';
  tenant: string;
  clientId: string;
  enabled: boolean;
}
interface Domain {
  id: string;
  domain: string;
  source: 'GROUP_ENTRA' | 'GROUP_GOOGLE' | 'COMPANY';
  providerId: string | null;
  approvedAt: string | null;
}
interface SsoConfig {
  group: { microsoft: boolean; google: boolean };
  redirectUri: string;
  mobileRedirect: string;
  providers: Provider[];
  domains: Domain[];
}

const KIND = { ENTRA: 'Microsoft Entra ID', GOOGLE: 'Google Workspace' };

/** Settings → Sign-in: single sign-on providers, e-mail domains and the password switch. */
export function SsoSettings({ settings }: { settings: CompanySettings }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.SETTINGS_WRITE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kind, setKind] = useState<'ENTRA' | 'GOOGLE'>('ENTRA');
  const [source, setSource] = useState<Domain['source']>('GROUP_ENTRA');
  const cfg = useQuery({ queryKey: ['sso'], queryFn: () => api<SsoConfig>('/settings/sso'), enabled: canWrite });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sso'] });
  const done = (text: string) => () => (setMsg({ ok: true, text }), refresh());
  const fail = (e: Error) => setMsg({ ok: false, text: errorText(e) });
  const call = (path: string, method: string, body?: unknown) =>
    api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  const addProvider = useMutation({ mutationFn: (b: unknown) => call('/settings/sso/providers', 'POST', b), onSuccess: done('Provider added. Now add its e-mail domains.'), onError: fail });
  const patchProvider = useMutation({ mutationFn: ({ id, b }: { id: string; b: unknown }) => call(`/settings/sso/providers/${id}`, 'PATCH', b), onSuccess: done('Saved.'), onError: fail });
  const delProvider = useMutation({ mutationFn: (id: string) => call(`/settings/sso/providers/${id}`, 'DELETE'), onSuccess: done('Provider removed.'), onError: fail });
  const test = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean; issuer?: string; error?: string }>(`/settings/sso/providers/${id}/test`, { method: 'POST' }),
    onSuccess: (r) => setMsg(r.ok ? { ok: true, text: `Connection works: ${r.issuer}` } : { ok: false, text: `Could not reach the provider: ${r.error}` }),
    onError: fail,
  });
  const addDomain = useMutation({ mutationFn: (b: unknown) => call('/settings/sso/domains', 'POST', b), onSuccess: done('Domain added.'), onError: fail });
  const delDomain = useMutation({ mutationFn: (id: string) => call(`/settings/sso/domains/${id}`, 'DELETE'), onSuccess: done('Domain removed.'), onError: fail });
  const savePassword = useMutation({
    mutationFn: (passwordLogin: boolean) =>
      api<CompanySettings>('/company/settings', { method: 'PATCH', body: JSON.stringify({ security: { passwordLogin } }) }),
    onSuccess: (d) => (qc.setQueryData(['settings'], d), setMsg({ ok: true, text: 'Sign-in rule saved.' })),
    onError: fail,
  });
  if (!canWrite) return null;
  const c = cfg.data;
  const isSuper = session.user()?.roles.includes(Role.SUPER_ADMIN) ?? false;
  const hasRoute = !!c?.domains.some((d) => d.approvedAt);

  function submitProvider(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addProvider.mutate({ kind, tenant: f.get('tenant'), clientId: f.get('clientId'), clientSecret: f.get('clientSecret') });
    e.currentTarget.reset();
  }
  function submitDomain(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addDomain.mutate({ domain: f.get('domain'), source, providerId: source === 'COMPANY' ? f.get('providerId') : null });
    e.currentTarget.reset();
  }
  const sourceLabel = (d: Domain) =>
    d.source === 'COMPANY'
      ? (() => {
          const p = c?.providers.find((x) => x.id === d.providerId);
          return p ? `${KIND[p.kind]} (${p.tenant})` : 'Company provider';
        })()
      : d.source === 'GROUP_ENTRA'
        ? 'Group Microsoft sign-in'
        : 'Group Google sign-in';

  return (
    <section className="card">
      <h2>Sign-in (single sign-on)</h2>
      <p className="muted small">
        Users sign in with their Microsoft or Google work account. Only users who were invited here
        can sign in; their roles stay managed on the Users page. The e-mail domain decides which
        sign-in is used.
      </p>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      <h3>E-mail domains</h3>
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Signs in with</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c?.domains.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No domains yet: everybody signs in with a password.
              </td>
            </tr>
          )}
          {c?.domains.map((d) => (
            <tr key={d.id}>
              <td>{d.domain}</td>
              <td>{sourceLabel(d)}</td>
              <td>
                {d.approvedAt ? (
                  <span className="badge badge-ok">active since {formatDate(d.approvedAt)}</span>
                ) : (
                  <span className="badge badge-warn">waiting for group approval</span>
                )}
              </td>
              <td>
                <button className="link danger" onClick={() => confirm(`Remove ${d.domain}?`) && delDomain.mutate(d.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="form-grid" onSubmit={submitDomain}>
        <label>
          Domain
          <input name="domain" required placeholder="example.com" />
        </label>
        <label>
          Signs in with
          <select value={source} onChange={(e) => setSource(e.target.value as Domain['source'])}>
            <option value="GROUP_ENTRA" disabled={!c?.group.microsoft}>
              Group Microsoft sign-in{c?.group.microsoft ? '' : ' (not set up)'}
            </option>
            <option value="GROUP_GOOGLE" disabled={!c?.group.google}>
              Group Google sign-in{c?.group.google ? '' : ' (not set up)'}
            </option>
            <option value="COMPANY" disabled={!c?.providers.length}>
              Our own provider (below)
            </option>
          </select>
        </label>
        {source === 'COMPANY' && (
          <label>
            Provider
            <select name="providerId" required>
              {c?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {KIND[p.kind]} · {p.tenant}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="muted small span-2">
          {source === 'COMPANY'
            ? 'Domains of your own provider are active at once.'
            : `A group super admin approves domains for the group sign-in${isSuper ? ' (Group companies page)' : ''}.`}
        </p>
        <div className="span-2">
          <button className="btn" disabled={addDomain.isPending}>
            Add domain
          </button>
        </div>
      </form>

      <h3>Our own identity provider</h3>
      <p className="muted small">
        Only needed if this company has its own Microsoft tenant or Google Workspace. Register an
        app there with the redirect URI <code>{c?.redirectUri}</code>
        {kind === 'ENTRA' ? ' (Web platform), single tenant' : ' (OAuth client, Web application)'}.
      </p>
      {c?.providers.map((p) => (
        <div className="row-actions card-row" key={p.id}>
          <strong>{KIND[p.kind]}</strong>
          <span>{p.tenant}</span>
          <span className="muted small">client {p.clientId}</span>
          <span className={`badge badge-${p.enabled ? 'ok' : 'muted'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
          <button className="link" onClick={() => test.mutate(p.id)}>
            Test
          </button>
          <button className="link" onClick={() => patchProvider.mutate({ id: p.id, b: { enabled: !p.enabled } })}>
            {p.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            className="link"
            onClick={() => {
              const s = prompt('New client secret');
              if (s) patchProvider.mutate({ id: p.id, b: { clientSecret: s } });
            }}
          >
            New secret
          </button>
          <button className="link danger" onClick={() => confirm('Remove this provider and its domains?') && delProvider.mutate(p.id)}>
            Remove
          </button>
        </div>
      ))}
      <form className="form-grid" onSubmit={submitProvider}>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as 'ENTRA' | 'GOOGLE')}>
            <option value="ENTRA">Microsoft Entra ID</option>
            <option value="GOOGLE">Google Workspace</option>
          </select>
        </label>
        <label>
          {kind === 'ENTRA' ? 'Directory (tenant) ID' : 'Workspace domain'}
          <input name="tenant" required placeholder={kind === 'ENTRA' ? '00000000-0000-…' : 'example.com'} />
        </label>
        <label>
          {kind === 'ENTRA' ? 'Application (client) ID' : 'Client ID'}
          <input name="clientId" required />
        </label>
        <label>
          Client secret
          <input name="clientSecret" type="password" required autoComplete="off" />
        </label>
        <p className="muted small span-2">The secret is stored encrypted and is never shown again.</p>
        <div className="span-2">
          <button className="btn" disabled={addProvider.isPending}>
            Add provider
          </button>
        </div>
      </form>

      <h3>Password sign-in</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={!settings.security.passwordLogin}
          disabled={!hasRoute && settings.security.passwordLogin}
          onChange={(e) =>
            (!e.target.checked || confirm('Users of this company can then only sign in with Microsoft or Google. Continue?')) &&
            savePassword.mutate(!e.target.checked)
          }
        />
        Require single sign-on (password sign-in off). Group super admins can always use their password.
      </label>
      {!hasRoute && <p className="muted small">Add an active domain first.</p>}
      <p className="muted small">Driver app: the same buttons open the browser and return to <code>{c?.mobileRedirect}</code>.</p>
    </section>
  );
}
