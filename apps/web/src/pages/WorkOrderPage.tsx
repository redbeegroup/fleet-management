import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, session } from '../lib/api';
import {
  formatDateTime,
  formatDuration,
  humanize,
  money,
  SEVERITY_TONE,
  WO_TONE,
} from '../lib/format';
import type { WorkOrder, CompanySettings } from '../lib/types';

export function WorkOrderPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'complete' | 'cancel'>('none');
  const { data: w } = useQuery({
    queryKey: ['wo', id],
    queryFn: () => api<WorkOrder>(`/maintenance/work-orders/${id}`),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<CompanySettings>('/company/settings'),
  });
  const act = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) =>
      api(`/maintenance/work-orders/${id}${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: () => {
      setError(null);
      setPanel('none');
      void qc.invalidateQueries({ queryKey: ['wo', id] });
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.body.errors
          ? e.body.errors.map((x) => x.message).join('; ')
          : e.message,
      ),
  });
  if (!w) return <p className="muted">Loading…</p>;
  const editable = canWrite && (w.status === 'OPEN' || w.status === 'IN_PROGRESS');
  const limit = settings.data?.approvals.workOrderAbove ?? null;
  const cost = Math.max(Number(w.totalCost), Number(w.estimatedCost ?? 0));
  const overLimit = limit != null && cost > limit;
  const downtime =
    w.offRoad && w.startedAt
      ? Math.round(
          ((w.completedAt ? new Date(w.completedAt) : new Date()).getTime() -
            new Date(w.startedAt).getTime()) /
            60_000,
        )
      : null;

  function addLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    act.mutate(
      {
        path: '/lines',
        body: {
          kind: f.get('kind'),
          description: f.get('description'),
          quantity: Number(f.get('quantity')),
          unitCost: Number(f.get('unitCost')),
        },
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {w.woNo}{' '}
            <span className={`badge badge-${WO_TONE[w.status]}`}>{humanize(w.status)}</span>
          </h1>
          {w.status === 'AWAITING_APPROVAL' && (
            <p className="muted">
              Waiting for approval — see the Approvals inbox. It can start once approved.
            </p>
          )}
          {w.estimatedCost && <p className="muted">Estimated cost {money(w.estimatedCost)}</p>}
          <p className="muted">
            {w.title} · <Link to={`/vehicles/${w.vehicle.id}`}>{w.vehicle.plateNumber}</Link> ·{' '}
            {humanize(w.type)}
            {w.plan && <> · plan “{w.plan.name}”</>}
          </p>
        </div>
        {canWrite && w.status === 'AWAITING_APPROVAL' && (
          <div className="actions">
            <button className="btn" onClick={() => setPanel('cancel')}>
              Cancel
            </button>
          </div>
        )}
        {editable && (
          <div className="actions">
            {w.status === 'OPEN' && (
              <button className="btn" onClick={() => act.mutate({ path: '/start' })}>
                Start work{w.offRoad ? ' (vehicle off road)' : ''}
              </button>
            )}
            {overLimit && (
              <button
                className="btn"
                onClick={() => act.mutate({ path: '/request-approval' })}
                title={`Cost ${money(cost)} is above the approval limit ${money(limit)}`}
              >
                Request approval
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setPanel('complete')}>
              Complete
            </button>
            <button className="btn" onClick={() => setPanel('cancel')}>
              Cancel
            </button>
          </div>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {panel !== 'none' && (
        <form
          className="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (panel === 'complete') {
              const odo = f.get('odometerKm') as string;
              act.mutate({
                path: '/complete',
                body: { resolution: f.get('text'), ...(odo && { odometerKm: Number(odo) }) },
              });
            } else act.mutate({ path: '/cancel', body: { reason: f.get('text') } });
          }}
        >
          <input
            name="text"
            required
            minLength={3}
            size={50}
            placeholder={panel === 'complete' ? 'What was done?' : 'Reason for cancelling'}
          />
          {panel === 'complete' && (
            <input name="odometerKm" type="number" min={0} step="any" placeholder="Odometer (km)" />
          )}
          <button className="btn btn-primary">Confirm</button>
          <button type="button" className="btn" onClick={() => setPanel('none')}>
            Close
          </button>
        </form>
      )}
      <section className="grid-2">
        <div className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>Priority</dt>
            <dd>
              <span className={`badge badge-${SEVERITY_TONE[w.priority] ?? 'muted'}`}>
                {humanize(w.priority)}
              </span>
            </dd>
            <dt>Workshop</dt>
            <dd>{w.workshop ?? '—'}</dd>
            <dt>Mechanic</dt>
            <dd>{w.assignedTo ?? '—'}</dd>
            <dt>Opened</dt>
            <dd>{formatDateTime(w.openedAt)}</dd>
            <dt>Started</dt>
            <dd>{formatDateTime(w.startedAt)}</dd>
            <dt>Completed</dt>
            <dd>{formatDateTime(w.completedAt)}</dd>
            <dt>Downtime</dt>
            <dd>
              {downtime !== null
                ? formatDuration(downtime)
                : w.offRoad
                  ? '—'
                  : 'vehicle stays in service'}
            </dd>
            <dt>Odometer</dt>
            <dd>{w.odometerKm ? `${Number(w.odometerKm).toLocaleString()} km` : '—'}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Description</h2>
          <p className="pre">{w.description ?? '—'}</p>
          {w.resolution && (
            <>
              <h2>Resolution</h2>
              <p className="pre">{w.resolution}</p>
            </>
          )}
          {!!w.repairRequests?.length && (
            <>
              <h2>From repair requests</h2>
              <ul>
                {w.repairRequests.map((r) => (
                  <li key={r.id}>{r.description}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      <section className="card">
        <h2>Costs</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Unit cost</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {w.lines?.map((l) => (
              <tr key={l.id}>
                <td>{humanize(l.kind)}</td>
                <td>{l.description}</td>
                <td className="num">{Number(l.quantity)}</td>
                <td className="num">{money(l.unitCost)}</td>
                <td className="num">{money(l.total)}</td>
                <td className="num">
                  {editable && (
                    <button
                      className="link danger"
                      onClick={() => act.mutate({ path: `/lines/${l.id}`, method: 'DELETE' })}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}>
                <strong>Total</strong>
              </td>
              <td className="num">
                <strong>{money(w.totalCost)}</strong>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        {editable && (
          <form className="inline-form" onSubmit={addLine}>
            <select name="kind" defaultValue="PART" aria-label="Type">
              <option value="PART">Part</option>
              <option value="LABOUR">Labour</option>
              <option value="EXTERNAL">External service</option>
              <option value="OTHER">Other</option>
            </select>
            <input name="description" required placeholder="Description" size={30} />
            <input
              name="quantity"
              type="number"
              min={0.01}
              step="any"
              required
              placeholder="Qty"
              defaultValue={1}
            />
            <input
              name="unitCost"
              type="number"
              min={0}
              step="any"
              required
              placeholder="Unit cost"
            />
            <button className="btn btn-primary">Add line</button>
          </form>
        )}
      </section>
    </>
  );
}
