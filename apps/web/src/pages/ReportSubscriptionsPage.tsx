import { Permission, permissionsForRoles } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { accessToken, api, session } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';
import type { Branch } from '../lib/types';
import { errorText } from './IncidentsPage';

type Report = 'FLEET' | 'BUDGET' | 'DELIVERY' | 'SAFETY';
type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
interface Run {
  id: string;
  periodKey: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  recipients: number;
  error: string | null;
  updatedAt: string;
}
interface Subscription {
  id: string;
  report: Report;
  title: string;
  frequency: Frequency;
  branchId: string | null;
  userIds: string[];
  extraEmails: string[];
  enabled: boolean;
  runs: Run[];
}
interface UserRow {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  active: boolean;
}

const REPORTS: { key: Report; title: string; perm: string; about: string }[] = [
  { key: 'FLEET', title: 'Fleet overview', perm: Permission.COST_READ, about: 'Cost, cost per km, utilisation, availability, km/L, top vehicles by cost, change vs the previous period.' },
  { key: 'BUDGET', title: 'Budget vs actual & TCO', perm: Permission.BUDGET_READ, about: 'Budget lines over or at risk, total cost of ownership per vehicle, unallocated shared costs.' },
  { key: 'DELIVERY', title: 'Delivery performance', perm: Permission.LOGISTICS_READ, about: 'OTIF, success, cost per drop, fill rate, loading/unloading times, failed deliveries.' },
  { key: 'SAFETY', title: 'Safety & compliance', perm: Permission.SAFETY_READ, about: 'Fleet safety score, lowest drivers, incidents and claims, failed inspections, alerts, expiring documents.' },
];
const FREQ: Record<Frequency, string> = {
  DAILY: 'Daily (yesterday), 07:00',
  WEEKLY: 'Weekly (last Mon–Sun), Monday 07:00',
  MONTHLY: 'Monthly (last month), 1st at 07:00',
};
const RUN_TONE = { SENT: 'ok', SKIPPED: 'warn', FAILED: 'danger' } as const;

/** Scheduled management reports by e-mail: preview, subscriptions, delivery history. */
export function ReportSubscriptionsPage() {
  const qc = useQueryClient();
  const canManage = session.can(Permission.SETTINGS_WRITE);
  const mine = REPORTS.filter((r) => session.can(r.perm));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [report, setReport] = useState<Report>(mine[0]?.key ?? 'FLEET');
  const [frequency, setFrequency] = useState<Frequency>('WEEKLY');
  const [branchId, setBranchId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['report-subs'], queryFn: () => api<{ smtp: boolean; subscriptions: Subscription[] }>('/report-subscriptions') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: canManage });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['report-subs'] });
  const fail = (e: Error) => setMsg({ ok: false, text: errorText(e) });
  const create = useMutation({
    mutationFn: (b: unknown) => api('/report-subscriptions', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Subscription saved. The first report goes out after the next full period.' }), setRecipients([]), refresh()),
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ id, b }: { id: string; b: unknown }) => api(`/report-subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/report-subscriptions/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  const send = useMutation({
    mutationFn: (id: string) => api<Run>(`/report-subscriptions/${id}/send`, { method: 'POST' }),
    onSuccess: (r) => (
      setMsg(r.status === 'SENT' ? { ok: true, text: `Sent to ${r.recipients} recipients.` } : { ok: false, text: r.error ?? r.status }), refresh()
    ),
    onError: fail,
  });

  const q = (format: 'html' | 'pdf') =>
    `/api/report-subscriptions/preview?report=${report}&frequency=${frequency}&format=${format}${branchId ? `&branchId=${branchId}` : ''}`;
  async function open(format: 'html' | 'pdf') {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(q(format), { headers: { Authorization: `Bearer ${accessToken()}` } });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      if (format === 'html') return setPreview(await res.text());
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.toLowerCase()}-${frequency.toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const extra = String(new FormData(e.currentTarget).get('extra') ?? '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (!recipients.length && !extra.length) return setMsg({ ok: false, text: 'Choose at least one recipient' });
    create.mutate({ report, frequency, branchId: branchId || null, userIds: recipients, extraEmails: extra });
  }
  const perm = REPORTS.find((r) => r.key === report)!.perm;
  const userName = (id: string) => users.data?.find((u) => u.id === id)?.fullName ?? 'user';
  const branchName = (id: string | null) => (id ? (branches.data?.find((b) => b.id === id)?.name ?? 'branch') : 'All branches');

  return (
    <>
      <header className="page-head">
        <h1>Scheduled reports</h1>
      </header>
      <p className="muted">
        Management reports by e-mail with a PDF and CSV files attached. Each report covers the last full
        day, week or month in company time and is sent at 07:00. Recipients only receive reports they
        are allowed to see.
      </p>
      {list.data && !list.data.smtp && (
        <p className="error">E-mail is not configured on this server (SMTP): reports are prepared but not sent. Preview still works.</p>
      )}
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      <section className="card form-grid">
        <h2 className="span-2">Report</h2>
        <label>
          Report
          <select value={report} onChange={(e) => setReport(e.target.value as Report)}>
            {mine.map((r) => (
              <option key={r.key} value={r.key}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {Object.entries(FREQ).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{REPORTS.find((r) => r.key === report)?.about}</p>
        <div className="span-2 actions">
          <button className="btn" disabled={busy} onClick={() => void open('html')}>
            Preview
          </button>
          <button className="btn" disabled={busy} onClick={() => void open('pdf')}>
            Download PDF
          </button>
        </div>
        {canManage && (
          <form className="span-2 form-grid" onSubmit={submit}>
            <div className="span-2">
              <span className="muted small">Send to (only users who may see this report are listed)</span>
              <div className="chips">
                {users.data
                  ?.filter((u) => u.active && (permissionsForRoles(u.roles) as string[]).includes(perm))
                  .map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      className={recipients.includes(u.id) ? 'chip on' : 'chip'}
                      aria-pressed={recipients.includes(u.id)}
                      title={u.email}
                      onClick={() => setRecipients(recipients.includes(u.id) ? recipients.filter((x) => x !== u.id) : [...recipients, u.id])}
                    >
                      {u.fullName}
                    </button>
                  ))}
              </div>
            </div>
            <label className="span-2">
              Other e-mail addresses (e.g. owners or auditors without a login)
              <input name="extra" placeholder="cfo@example.com, owner@example.com" />
            </label>
            <div className="span-2">
              <button className="btn btn-primary" disabled={create.isPending}>
                Subscribe
              </button>
            </div>
          </form>
        )}
      </section>

      {preview && (
        <section className="card">
          <div className="card-head">
            <h2>Preview</h2>
            <button className="link" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          <iframe title="Report preview" className="report-preview" sandbox="" srcDoc={preview} />
        </section>
      )}

      <section className="card table-card">
        <div className="card-head">
          <h2>Subscriptions</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>Period</th>
              <th>Branch</th>
              <th>Recipients</th>
              <th>Last runs</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {list.data?.subscriptions.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No scheduled reports yet.
                </td>
              </tr>
            )}
            {list.data?.subscriptions.map((s) => (
              <tr key={s.id} className={s.enabled ? '' : 'muted'}>
                <td>{s.title}</td>
                <td>{humanize(s.frequency)}</td>
                <td>{branchName(s.branchId)}</td>
                <td className="small">{[...s.userIds.map(userName), ...s.extraEmails].join(', ')}</td>
                <td>
                  {s.runs.length === 0 && <span className="muted small">not sent yet</span>}
                  {s.runs.slice(0, 3).map((r) => (
                    <div key={r.id} className="small" title={r.error ?? undefined}>
                      <span className={`badge badge-${RUN_TONE[r.status]}`}>{humanize(r.status)}</span> {r.periodKey} ·{' '}
                      {formatDateTime(r.updatedAt)}
                    </div>
                  ))}
                </td>
                {canManage && (
                  <td>
                    <div className="row-actions">
                      <button className="link" disabled={send.isPending} onClick={() => send.mutate(s.id)}>
                        Send now
                      </button>
                      <button className="link" onClick={() => patch.mutate({ id: s.id, b: { enabled: !s.enabled } })}>
                        {s.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button className="link danger" onClick={() => confirm(`Delete the ${s.title} subscription?`) && remove.mutate(s.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
