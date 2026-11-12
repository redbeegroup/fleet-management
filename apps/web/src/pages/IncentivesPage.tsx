import { AdjustmentCategory, Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { accessToken, api, session } from '../lib/api';
import { ADJ_TONE, humanize, money } from '../lib/format';
import type { Adjustment, AdjustmentSummary, Driver } from '../lib/types';
import { errorText } from './IncidentsPage';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function IncentivesPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? thisMonth();
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canWrite = session.can(Permission.INCENTIVE_WRITE);
  const canApprove = session.can(Permission.INCENTIVE_APPROVE);
  const me = session.user()?.id;

  const items = useQuery({
    queryKey: ['adjustments', period],
    queryFn: () => api<Adjustment[]>(`/adjustments?period=${period}`),
  });
  const summary = useQuery({
    queryKey: ['adjustments', 'summary', period],
    queryFn: () => api<AdjustmentSummary>(`/adjustments/summary?period=${period}`),
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'all'],
    queryFn: () => api<Paginated<Driver>>('/drivers?pageSize=200'),
    enabled: showForm,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['adjustments'] });
  const onError = (e: Error) => setMsg({ ok: false, text: errorText(e) });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/adjustments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShowForm(false);
      setMsg(null);
      refresh();
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: 'approve' | 'reject';
      note?: string;
    }) =>
      api(`/adjustments/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note: note ?? null }),
      }),
    onSuccess: () => {
      setMsg(null);
      refresh();
    },
    onError,
  });
  const runRule = useMutation({
    mutationFn: () =>
      api<{ created: number }>('/adjustments/propose-safety-bonuses', {
        method: 'POST',
        body: JSON.stringify({ period }),
      }),
    onSuccess: (r) => {
      setMsg({
        ok: true,
        text: r.created
          ? `${r.created} safety bonus proposal(s) created.`
          : 'No new proposals (rule disabled in Settings, nobody qualified, or already proposed).',
      });
      refresh();
    },
    onError,
  });

  async function downloadCsv() {
    const res = await fetch(`/api/adjustments/export.csv?period=${period}`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    if (!res.ok) return setMsg({ ok: false, text: `Export failed (${res.status})` });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `driver-pay-adjustments_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      driverId: f.get('driverId'),
      kind: f.get('kind'),
      category: f.get('category'),
      period,
      amount: Number(f.get('amount')),
      reason: f.get('reason'),
    });
  }

  const s = summary.data;
  return (
    <>
      <header className="page-head">
        <h1>Incentives & penalties</h1>
        <div className="actions">
          <input
            type="month"
            aria-label="Payroll month"
            value={period}
            onChange={(e) => e.target.value && setParams({ period: e.target.value })}
          />
          <button className="btn" onClick={downloadCsv}>
            Payroll CSV
          </button>
          {canWrite && (
            <>
              <button className="btn" onClick={() => runRule.mutate()} disabled={runRule.isPending}>
                Propose safety bonuses
              </button>
              <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : 'New item'}
              </button>
            </>
          )}
        </div>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {showForm && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Driver
            <select name="driverId" required>
              <option value="">Choose…</option>
              {drivers.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName} ({d.employeeNo})
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="kind">
              <option value="INCENTIVE">Incentive</option>
              <option value="PENALTY">Penalty / deduction</option>
            </select>
          </label>
          <label>
            Category
            <select name="category">
              {Object.values(AdjustmentCategory).map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount ({s?.currency ?? ''})
            <input name="amount" type="number" min={1} step="any" required />
          </label>
          <label className="span-all">
            Reason
            <input name="reason" required minLength={3} />
          </label>
          <div>
            <button className="btn btn-primary" disabled={create.isPending}>
              Propose for {period}
            </button>
          </div>
        </form>
      )}

      <section className="tiles">
        {[
          ['Incentives (approved)', s ? money(s.totals.incentives) : '…'],
          ['Penalties (approved)', s ? money(s.totals.penalties) : '…'],
          ['Net', s ? money(s.totals.net) : '…'],
          ['Awaiting approval', s ? s.totals.pending : '…'],
        ].map(([l, v]) => (
          <div className="card tile" key={l}>
            <span className="tile-label">
              {l} {l !== 'Awaiting approval' && s ? `· ${s.currency}` : ''}
            </span>
            <span className="tile-value small">{v}</span>
          </div>
        ))}
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Items · {period}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Type</th>
              <th>Category</th>
              <th className="num">Amount</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nothing for this month.
                </td>
              </tr>
            )}
            {items.data?.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/drivers/${a.driver.id}`}>{a.driver.fullName}</Link>
                </td>
                <td>
                  <span className={`badge badge-${a.kind === 'INCENTIVE' ? 'ok' : 'warn'}`}>
                    {a.kind === 'INCENTIVE' ? 'Incentive' : 'Penalty'}
                  </span>
                </td>
                <td>
                  {humanize(a.category)}
                  {a.source !== 'manual' && <span className="muted"> · auto</span>}
                </td>
                <td className="num">
                  {a.kind === 'PENALTY' ? '−' : ''}
                  {money(a.amount)}
                </td>
                <td>
                  {a.reason}
                  {a.decisionNote && <div className="muted">Decision: {a.decisionNote}</div>}
                </td>
                <td>
                  <span className={`badge badge-${ADJ_TONE[a.status]}`}>{humanize(a.status)}</span>
                </td>
                <td>
                  <span className="actions">
                    {canApprove && a.status === 'PROPOSED' && a.proposedBy !== me && (
                      <>
                        <button
                          className="link"
                          onClick={() => decide.mutate({ id: a.id, action: 'approve' })}
                        >
                          Approve
                        </button>
                        <button
                          className="link danger"
                          onClick={() => {
                            const note = prompt('Reason for rejecting');
                            if (note) decide.mutate({ id: a.id, action: 'reject', note });
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {canApprove && a.status === 'PROPOSED' && a.proposedBy === me && (
                      <span className="muted">needs another approver</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {s && s.drivers.length > 0 && (
        <section className="card table-card">
          <div className="card-head">
            <h2>Per driver · approved</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th className="num">Incentives</th>
                <th className="num">Penalties</th>
                <th className="num">Net</th>
                <th className="num">Pending</th>
              </tr>
            </thead>
            <tbody>
              {s.drivers.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.fullName} <span className="muted">{d.employeeNo}</span>
                  </td>
                  <td className="num">{money(d.incentives)}</td>
                  <td className="num">{money(d.penalties)}</td>
                  <td className="num">
                    <strong>{money(d.net)}</strong>
                  </td>
                  <td className="num">{d.pending || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
