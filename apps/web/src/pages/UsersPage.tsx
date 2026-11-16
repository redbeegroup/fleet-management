import { Permission, Role } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';
import type { Branch } from '../lib/types';
import { errorText } from './IncidentsPage';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  branchId: string | null;
  active: boolean;
  lastLoginAt: string | null;
  invitedAt: string | null;
  passwordSetAt: string | null;
}

const ROLE_HELP: Record<string, string> = {
  COMPANY_ADMIN: 'everything in this company',
  FLEET_MANAGER: 'fleet, costs, approvals',
  DISPATCHER: 'trips, planning, deliveries',
  DRIVER: 'mobile app',
  EXECUTIVE: 'read-only, all reports',
  VIEWER: 'vehicles and map',
  REQUESTER: 'vehicle requests only',
  SUPER_ADMIN: 'all companies of the group',
};

/** Users of the company: invite by e-mail, change roles, deactivate, resend links. */
export function UsersPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.USER_WRITE);
  const isSuper = session.user()?.roles.includes(Role.SUPER_ADMIN) ?? false;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>(['DISPATCHER']);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const roleList = Object.values(Role).filter((r) => isSuper || r !== Role.SUPER_ADMIN);
  const ok = (text: string) => () => {
    setMsg({ ok: true, text });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
  const fail = (e: Error) => setMsg({ ok: false, text: errorText(e) });

  const invite = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api<UserRow>('/users/invite', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: ok('Invitation sent.'),
    onError: fail,
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: string; b: Record<string, unknown> }) =>
      api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: ok('Saved.'),
    onError: fail,
  });
  const resend = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/resend-invite`, { method: 'POST' }),
    onSuccess: ok('Invitation sent again.'),
    onError: fail,
  });
  const reset = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: ok('Password reset link sent.'),
    onError: fail,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!roles.length) return setMsg({ ok: false, text: 'Choose at least one role' });
    invite.mutate({
      email: f.get('email'),
      fullName: f.get('fullName'),
      roles,
      branchId: f.get('branchId') || null,
    });
    e.currentTarget.reset();
  }
  const status = (u: UserRow) =>
    !u.active
      ? ['inactive', 'muted']
      : u.invitedAt && !u.passwordSetAt
        ? ['invited', 'warn']
        : ['active', 'ok'];
  const roleChips = (value: string[], onChange: (v: string[]) => void) => (
    <div className="chips">
      {roleList.map((r) => (
        <button
          type="button"
          key={r}
          className={value.includes(r) ? 'chip on' : 'chip'}
          title={ROLE_HELP[r]}
          aria-pressed={value.includes(r)}
          onClick={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])}
        >
          {humanize(r)}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <header className="page-head">
        <h1>Users</h1>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {canWrite && (
        <form className="card form-grid" onSubmit={submit}>
          <h2 className="span-2">Invite a user</h2>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Full name
            <input name="fullName" required />
          </label>
          <label>
            Branch
            <select name="branchId" defaultValue="" key={branches.data ? 'ready' : 'loading'}>
              <option value="">—</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="span-2">
            <span className="muted small">Roles (hover for what each can do)</span>
            {roleChips(roles, setRoles)}
          </div>
          <p className="muted small span-2">
            The user gets an e-mail with a link to choose a password (valid 72 hours). Drivers also
            need a driver profile under Drivers, linked to this login.
          </p>
          <div className="span-2">
            <button className="btn btn-primary" disabled={invite.isPending}>
              Send invitation
            </button>
          </div>
        </form>
      )}
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Roles</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Last sign-in</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => {
                const [label, tone] = status(u);
                const me = u.id === session.user()?.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.fullName}
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>
                      {editing === u.id
                        ? roleChips(u.roles, (v) =>
                            update.mutate({ id: u.id, b: { roles: v.length ? v : u.roles } }),
                          )
                        : u.roles.map(humanize).join(', ')}
                    </td>
                    <td>
                      {canWrite ? (
                        <select
                          aria-label={`Branch of ${u.fullName}`}
                          value={u.branchId ?? ''}
                          onChange={(e) =>
                            update.mutate({ id: u.id, b: { branchId: e.target.value || null } })
                          }
                        >
                          <option value="">—</option>
                          {branches.data?.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (branches.data?.find((b) => b.id === u.branchId)?.name ?? '—')
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${tone}`}>{label}</span>
                    </td>
                    <td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</td>
                    {canWrite && (
                      <td>
                        <div className="row-actions">
                          {!me && (
                            <button
                              className="link"
                              onClick={() => setEditing(editing === u.id ? null : u.id)}
                            >
                              {editing === u.id ? 'Done' : 'Roles'}
                            </button>
                          )}
                          {u.active && u.invitedAt && !u.passwordSetAt && (
                            <button className="link" onClick={() => resend.mutate(u.id)}>
                              Resend invite
                            </button>
                          )}
                          {u.active && (u.passwordSetAt || !u.invitedAt) && (
                            <button
                              className="link"
                              onClick={() =>
                                confirm(`Send ${u.fullName} a password reset link?`) &&
                                reset.mutate(u.id)
                              }
                            >
                              Reset password
                            </button>
                          )}
                          {!me && (
                            <button
                              className={u.active ? 'link danger' : 'link'}
                              onClick={() =>
                                (!u.active ||
                                  confirm(
                                    `Deactivate ${u.fullName}? They are signed out everywhere.`,
                                  )) &&
                                update.mutate({ id: u.id, b: { active: !u.active } })
                              }
                            >
                              {u.active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
