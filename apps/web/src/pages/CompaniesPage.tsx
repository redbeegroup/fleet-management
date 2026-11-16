import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import { formatDate } from '../lib/format';
import { errorText } from './IncidentsPage';

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currency: string;
  active: boolean;
  createdAt: string;
  users: number;
  vehicles: number;
}

interface GroupDomain {
  id: string;
  domain: string;
  source: string;
  approvedAt: string | null;
  company: { code: string; name: string } | null;
}

/** Domains that companies want to use with the group's shared Microsoft / Google sign-in. */
function GroupSsoDomains() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-sso-domains'], queryFn: () => api<GroupDomain[]>('/admin/sso-domains') });
  const act = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api(`/admin/sso-domains/${id}/${approve ? 'approve' : 'revoke'}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-sso-domains'] }),
  });
  return (
    <section className="card table-card">
      <div className="card-head">
        <h2>Group single sign-on domains</h2>
      </div>
      <p className="muted small">
        Approve a domain only if it really belongs to that company: its users can then sign in with
        the group's Microsoft or Google account.
      </p>
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Company</th>
            <th>Sign-in</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No company has asked for the group sign-in yet.
              </td>
            </tr>
          )}
          {list.data?.map((d) => (
            <tr key={d.id}>
              <td>{d.domain}</td>
              <td>{d.company ? `${d.company.code} · ${d.company.name}` : '—'}</td>
              <td>{d.source === 'GROUP_ENTRA' ? 'Microsoft' : 'Google'}</td>
              <td>
                <span className={`badge badge-${d.approvedAt ? 'ok' : 'warn'}`}>
                  {d.approvedAt ? `approved ${formatDate(d.approvedAt)}` : 'waiting'}
                </span>
              </td>
              <td>
                <button
                  className={d.approvedAt ? 'link danger' : 'link'}
                  onClick={() => act.mutate({ id: d.id, approve: !d.approvedAt })}
                >
                  {d.approvedAt ? 'Revoke' : 'Approve'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Group administration (super admins): companies of the group and their first admin. */
export function CompaniesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<CompanyRow[]>('/admin/companies'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-companies'] });
  const create = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api<CompanyRow & { admin: { email: string } }>('/admin/companies', {
        method: 'POST',
        body: JSON.stringify(b),
      }),
    onSuccess: (c) => (
      setMsg({ ok: true, text: `${c.name} created. An invitation was sent to ${c.admin.email}.` }),
      refresh()
    ),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: string; b: Record<string, unknown> }) =>
      api(`/admin/companies/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Saved.' }), refresh()),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      code: f.get('code'),
      name: f.get('name'),
      timezone: f.get('timezone'),
      currency: f.get('currency'),
      admin: { email: f.get('email'), fullName: f.get('fullName') },
    });
  }
  return (
    <>
      <header className="page-head">
        <h1>Group companies</h1>
      </header>
      <p className="muted">
        Each company's data is fully separated. Its first admin is invited by e-mail and then
        manages users, branches and settings.
      </p>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <form className="card form-grid" onSubmit={submit}>
        <h2 className="span-2">New company</h2>
        <label>
          Code
          <input name="code" required pattern="[A-Za-z0-9-]{2,20}" placeholder="e.g. MZL" />
        </label>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Time zone
          <input name="timezone" defaultValue="Asia/Yangon" required />
        </label>
        <label>
          Currency
          <input name="currency" defaultValue="MMK" maxLength={3} required />
        </label>
        <label>
          First admin e-mail
          <input name="email" type="email" required />
        </label>
        <label>
          First admin name
          <input name="fullName" required />
        </label>
        <div className="span-2">
          <button className="btn btn-primary" disabled={create.isPending}>
            Create company and invite admin
          </button>
        </div>
      </form>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Time zone</th>
              <th className="num">Users</th>
              <th className="num">Vehicles</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>
                  {c.timezone} · {c.currency}
                </td>
                <td className="num">{c.users}</td>
                <td className="num">{c.vehicles}</td>
                <td>{formatDate(c.createdAt)}</td>
                <td>
                  <span className={`badge badge-${c.active ? 'ok' : 'muted'}`}>
                    {c.active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td>
                  {c.id !== session.user()?.companyId && (
                    <button
                      className={c.active ? 'link danger' : 'link'}
                      onClick={() =>
                        (!c.active ||
                          confirm(
                            `Deactivate ${c.name}? All its users are signed out and cannot sign in.`,
                          )) &&
                        update.mutate({ id: c.id, b: { active: !c.active } })
                      }
                    >
                      {c.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <GroupSsoDomains />
    </>
  );
}
