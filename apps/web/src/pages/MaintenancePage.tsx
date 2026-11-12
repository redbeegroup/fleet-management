import { Paginated, Permission, WorkOrderType } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, session } from '../lib/api';
import { DUE_TONE, formatDate, formatDateTime, formatDuration, humanize, money, monthRange, SEVERITY_TONE, WO_TONE } from '../lib/format';
import type { MaintenancePlan, MaintenanceReport, RepairRequest, Vehicle, WorkOrder } from '../lib/types';

type Tab = 'plans' | 'orders' | 'requests' | 'report';

export function MaintenancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'plans';
  const setTab = (t: Tab) => setParams({ tab: t });
  const openRequests = useQuery({
    queryKey: ['maintenance', 'requests', 'OPEN'],
    queryFn: () => api<RepairRequest[]>('/maintenance/repair-requests?status=OPEN'),
  });
  return (
    <>
      <header className="page-head">
        <h1>Maintenance</h1>
      </header>
      <nav className="tabs">
        {(
          [
            ['plans', 'Preventive plans'],
            ['orders', 'Work orders'],
            ['requests', `Repair requests${openRequests.data?.length ? ` (${openRequests.data.length})` : ''}`],
            ['report', 'Cost & downtime'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'plans' && <PlansTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'report' && <ReportTab />}
    </>
  );
}

function useVehicles() {
  return useQuery({ queryKey: ['vehicles', 'all'], queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200') });
}

function errorText(e: Error) {
  return e instanceof ApiError && e.body.errors ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ') : e.message;
}

function PlansTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const vehicles = useVehicles();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const { data } = useQuery({ queryKey: ['maintenance', 'plans'], queryFn: () => api<MaintenancePlan[]>('/maintenance/plans') });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/maintenance/plans/bulk', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShow(false);
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['maintenance', 'plans'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const openWo = useMutation({
    mutationFn: (p: MaintenancePlan) =>
      api<WorkOrder>('/maintenance/work-orders', { method: 'POST', body: JSON.stringify({ vehicleId: p.vehicle.id, planId: p.id, type: 'PREVENTIVE', title: p.name }) }),
    onSuccess: (wo) => navigate(`/maintenance/work-orders/${wo.id}`),
    onError: (e) => setError(errorText(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => ((f.get(k) as string) ? Number(f.get(k)) : null);
    create.mutate({ vehicleIds: selected, name: f.get('name'), intervalKm: num('intervalKm'), intervalDays: num('intervalDays') });
  }

  const order = { OVERDUE: 0, DUE_SOON: 1, OK: 2 } as const;
  const plans = [...(data ?? [])].sort((a, b) => (a.due ? order[a.due.status] : 3) - (b.due ? order[b.due.status] : 3));

  return (
    <>
      {canWrite && (
        <div className="actions start">
          <button className="btn btn-primary" onClick={() => setShow((x) => !x)}>
            {show ? 'Close' : 'New plan'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {show && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Service *
            <input name="name" required placeholder="e.g. Engine oil & filter" />
          </label>
          <label>
            Every (km)
            <input name="intervalKm" type="number" min={100} placeholder="e.g. 5000" />
          </label>
          <label>
            Every (days)
            <input name="intervalDays" type="number" min={1} placeholder="e.g. 180" />
          </label>
          <fieldset className="span-2 vehicle-picker">
            <legend>Vehicles * (counting starts from today's odometer)</legend>
            {vehicles.data?.items.map((v) => (
              <label key={v.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(v.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, v.id] : s.filter((x) => x !== v.id)))}
                />
                {v.plateNumber} <span className="muted">{humanize(v.vehicleClass)}</span>
              </label>
            ))}
          </fieldset>
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={!selected.length || create.isPending}>
              Create {selected.length > 1 ? `${selected.length} plans` : 'plan'}
            </button>
          </div>
        </form>
      )}
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Service</th>
              <th>Interval</th>
              <th>Last done</th>
              <th>Next due</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No preventive maintenance plans yet.
                </td>
              </tr>
            )}
            {plans.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'inactive'}>
                <td>
                  <Link to={`/vehicles/${p.vehicle.id}`}>{p.vehicle.plateNumber}</Link>
                </td>
                <td>{p.name}</td>
                <td>{[p.intervalKm && `${p.intervalKm.toLocaleString()} km`, p.intervalDays && `${p.intervalDays} days`].filter(Boolean).join(' / ')}</td>
                <td>
                  {formatDate(p.lastDoneAt)}
                  {p.lastDoneOdometerKm && <span className="muted"> · {Number(p.lastDoneOdometerKm).toLocaleString()} km</span>}
                </td>
                <td>
                  {[
                    p.due?.nextDueKm != null && `${p.due.nextDueKm.toLocaleString()} km (${p.due.remainingKm! >= 0 ? `${p.due.remainingKm} left` : `${-p.due.remainingKm!} over`})`,
                    p.due?.nextDueAt && `${formatDate(p.due.nextDueAt)} (${p.due.remainingDays! >= 0 ? `${p.due.remainingDays} d` : `${-p.due.remainingDays!} d over`})`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td>{p.due ? <span className={`badge badge-${DUE_TONE[p.due.status]}`}>{humanize(p.due.status)}</span> : <span className="badge badge-muted">inactive</span>}</td>
                <td className="num">
                  {p.openWorkOrder ? (
                    <Link to={`/maintenance/work-orders/${p.openWorkOrder.id}`}>{p.openWorkOrder.woNo}</Link>
                  ) : (
                    canWrite &&
                    p.active && (
                      <button className="link" onClick={() => openWo.mutate(p)}>
                        Create work order
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OrdersTab() {
  const navigate = useNavigate();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const vehicles = useVehicles();
  const [status, setStatus] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['maintenance', 'orders', status],
    queryFn: () => api<Paginated<WorkOrder>>(`/maintenance/work-orders?pageSize=100${status ? `&status=${status}` : ''}`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<WorkOrder>('/maintenance/work-orders', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (wo) => navigate(`/maintenance/work-orders/${wo.id}`),
    onError: (e) => setError(errorText(e)),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    create.mutate({
      vehicleId: str('vehicleId'),
      type: str('type'),
      title: str('title'),
      description: str('description'),
      priority: str('priority'),
      workshop: str('workshop'),
      assignedTo: str('assignedTo'),
      offRoad: f.get('offRoad') === 'on',
    });
  }
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.keys(WO_TONE).map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setShow((x) => !x)}>
            {show ? 'Close' : 'New work order'}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {show && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Vehicle *
            <select name="vehicleId" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {vehicles.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type *
            <select name="type" defaultValue="CORRECTIVE">
              {Object.values(WorkOrderType).map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Title *
            <input name="title" required />
          </label>
          <label className="span-2">
            Description
            <textarea name="description" rows={2} />
          </label>
          <label>
            Priority
            <select name="priority" defaultValue="MEDIUM">
              {Object.keys(SEVERITY_TONE).map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Workshop
            <input name="workshop" placeholder="Internal / garage name" />
          </label>
          <label>
            Mechanic
            <input name="assignedTo" />
          </label>
          <label className="check">
            <input type="checkbox" name="offRoad" defaultChecked /> Vehicle off the road while in progress
          </label>
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={create.isPending}>
              Create
            </button>
          </div>
        </form>
      )}
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Work order</th>
              <th>Vehicle</th>
              <th>Title</th>
              <th>Type</th>
              <th>Opened</th>
              <th className="num">Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No work orders.
                </td>
              </tr>
            )}
            {data?.items.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link to={`/maintenance/work-orders/${w.id}`}>
                    <strong>{w.woNo}</strong>
                  </Link>
                </td>
                <td>{w.vehicle.plateNumber}</td>
                <td>{w.title}</td>
                <td>{humanize(w.type)}</td>
                <td>{formatDateTime(w.openedAt)}</td>
                <td className="num">{money(w.totalCost)}</td>
                <td>
                  <span className={`badge badge-${WO_TONE[w.status]}`}>{humanize(w.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const vehicles = useVehicles();
  const [status, setStatus] = useState('OPEN');
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['maintenance', 'requests', status],
    queryFn: () => api<RepairRequest[]>(`/maintenance/repair-requests${status ? `?status=${status}` : ''}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance'] });
  const report = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/maintenance/repair-requests', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });
  const convert = useMutation({
    mutationFn: (r: RepairRequest) =>
      api<WorkOrder>('/maintenance/work-orders', {
        method: 'POST',
        body: JSON.stringify({ vehicleId: r.vehicleId, type: 'CORRECTIVE', title: r.description.slice(0, 120), description: r.description, priority: r.severity, repairRequestIds: [r.id] }),
      }),
    onSuccess: (wo) => navigate(`/maintenance/work-orders/${wo.id}`),
    onError: (e) => setError(errorText(e)),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/maintenance/repair-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });
  return (
    <>
      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          report.mutate({ vehicleId: f.get('vehicleId'), description: f.get('description'), severity: f.get('severity') });
          e.currentTarget.reset();
        }}
      >
        <select name="vehicleId" required defaultValue="" aria-label="Vehicle">
          <option value="" disabled>
            Vehicle…
          </option>
          {vehicles.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber}
            </option>
          ))}
        </select>
        <input name="description" required minLength={5} placeholder="Describe the problem" size={40} />
        <select name="severity" defaultValue="MEDIUM" aria-label="Severity">
          {Object.keys(SEVERITY_TONE).map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Report problem</button>
      </form>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="OPEN">Open</option>
          <option value="CONVERTED">Converted</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Reported</th>
              <th>Vehicle</th>
              <th>Problem</th>
              <th>Severity</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing here.
                </td>
              </tr>
            )}
            {data?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.createdAt)}</td>
                <td>{r.vehicle?.plateNumber}</td>
                <td className="wrap">{r.description}</td>
                <td>
                  <span className={`badge badge-${SEVERITY_TONE[r.severity] ?? 'muted'}`}>{humanize(r.severity)}</span>
                </td>
                <td>
                  {r.workOrder ? <Link to={`/maintenance/work-orders/${r.workOrder.id}`}>{r.workOrder.woNo}</Link> : humanize(r.status)}
                  {r.resolution && <span className="muted"> · {r.resolution}</span>}
                </td>
                <td className="num">
                  {canWrite && r.status === 'OPEN' && (
                    <span className="actions">
                      <button className="link" onClick={() => convert.mutate(r)}>
                        Create work order
                      </button>
                      <button
                        className="link danger"
                        onClick={() => {
                          const reason = prompt('Reason for rejecting?');
                          if (reason && reason.trim().length >= 3) reject.mutate({ id: r.id, reason });
                        }}
                      >
                        Reject
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReportTab() {
  const [range, setRange] = useState(monthRange());
  const iso = (d: string) => new Date(`${d}T00:00`).toISOString();
  const { data } = useQuery({
    queryKey: ['maintenance', 'report', range],
    queryFn: () => api<MaintenanceReport>(`/maintenance/report?from=${iso(range.from)}&to=${iso(range.to)}`),
  });
  return (
    <>
      <div className="toolbar">
        <label className="mini">
          From
          <input type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
        </label>
        <label className="mini">
          To
          <input type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
        </label>
      </div>
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Maintenance cost</span>
          <span className="tile-value small">{data ? money(data.totals.cost) : '…'}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Work orders completed</span>
          <span className="tile-value small">{data?.totals.workOrders ?? '…'}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Total downtime</span>
          <span className="tile-value small">{data ? formatDuration(data.totals.downtimeMinutes) : '…'}</span>
        </div>
      </section>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th className="num">Work orders</th>
              <th className="num">Parts</th>
              <th className="num">Labour</th>
              <th className="num">External</th>
              <th className="num">Total cost</th>
              <th className="num">Downtime</th>
              <th className="num">Downtime %</th>
            </tr>
          </thead>
          <tbody>
            {data?.vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>
                </td>
                <td className="num">{v.workOrders}</td>
                <td className="num">{money(v.parts)}</td>
                <td className="num">{money(v.labour)}</td>
                <td className="num">{money(v.external)}</td>
                <td className="num">
                  <strong>{money(v.cost)}</strong>
                </td>
                <td className="num">{v.downtimeMinutes ? formatDuration(v.downtimeMinutes) : '—'}</td>
                <td className="num">{v.downtimePct ? `${v.downtimePct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
