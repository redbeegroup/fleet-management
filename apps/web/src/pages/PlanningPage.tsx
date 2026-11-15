import { loadTotals } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CapBars } from '../components/CapBars';
import { api } from '../lib/api';
import { formatDateTime, humanize, isoDay, money, TRIP_TONE } from '../lib/format';
import type { AutofillProposal, Branch, CompanySettings, PlanningData } from '../lib/types';
import { errorText } from './IncidentsPage';

const tomorrow = () => isoDay(new Date(Date.now() + 86_400_000));
const PRIORITY_TONE: Record<string, string> = {
  URGENT: 'danger',
  HIGH: 'warn',
  NORMAL: 'muted',
  LOW: 'muted',
};
const q = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function PlanningPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(tomorrow);
  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [proposal, setProposal] = useState<AutofillProposal | null>(null);
  const [proposalDrivers, setProposalDrivers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const routing = useQuery({
    queryKey: ['routing-status'],
    queryFn: () => api<{ source: string; configured: boolean }>('/routing/status'),
    staleTime: 60_000,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<CompanySettings>('/company/settings'),
  });
  useEffect(() => {
    if (!branchId && branches.data?.length)
      setBranchId(settings.data?.logistics.defaultBranchId ?? branches.data[0].id);
  }, [branches.data, settings.data, branchId]);

  const plan = useQuery({
    queryKey: ['planning', date, branchId],
    queryFn: () => api<PlanningData>(`/logistics/planning?date=${date}&branchId=${branchId}`),
    enabled: !!branchId,
  });
  const p = plan.data;
  useEffect(() => {
    setSelected(new Set());
    setProposal(null);
  }, [date, branchId]);

  const chosen = useMemo(() => (p?.orders ?? []).filter((o) => selected.has(o.id)), [p, selected]);
  const chosenTotals = loadTotals(chosen.map((o) => o.item));
  const vehicle = p?.vehicles.find((v) => v.id === vehicleId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['planning'] });
    void qc.invalidateQueries({ queryKey: ['loads'] });
  };
  const create = useMutation({
    mutationFn: (body: { vehicleId: string; driverId: string; orderIds: string[] }) =>
      api<{ tripNo: string }>('/logistics/loads', {
        method: 'POST',
        body: JSON.stringify({ ...body, date, branchId }),
      }),
    onSuccess: (r, body) => {
      setMsg({ ok: true, text: `Load ${r.tripNo} created.` });
      setSelected(new Set());
      setProposal((pr) =>
        pr ? { ...pr, loads: pr.loads.filter((l) => l.vehicleId !== body.vehicleId) } : pr,
      );
      refresh();
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const auto = useMutation({
    mutationFn: () =>
      api<AutofillProposal>('/logistics/autofill', {
        method: 'POST',
        body: JSON.stringify({ date, branchId }),
      }),
    onSuccess: (r) => {
      setProposal(r);
      setMsg(null);
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const allSelected = !!p?.orders.length && selected.size === p.orders.length;
  const ref = (id: string) => p?.orders.find((o) => o.id === id)?.externalRef ?? id;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Delivery planning</h1>
          <p className="muted">
            Choose orders, pick a vehicle and driver, create the load. Auto-fill suggests loads by
            area within each vehicle's capacity.
          </p>
          <p className="small">
            <span className={`badge badge-${routing.data?.source === 'osrm' ? 'ok' : 'muted'}`}>
              {routing.data?.source === 'osrm'
                ? 'Road routing (OSRM/VROOM) on'
                : routing.data?.configured
                  ? 'Road routing unreachable — straight-line estimates'
                  : 'Straight-line estimates (no routing engine)'}
            </span>
          </p>
        </div>
        <div className="actions">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Delivery date"
          />
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Depot">
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => auto.mutate()}
            disabled={!p?.orders.length || auto.isPending}
          >
            Auto-fill
          </button>
        </div>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {p && p.depot.latitude == null && (
        <p className="muted">
          Tip: set the depot's coordinates in Settings → Depots for better stop order and auto-fill.
        </p>
      )}

      {proposal && (
        <section className="card">
          <div className="card-head">
            <h2>Auto-fill proposal</h2>
            <button className="btn" onClick={() => setProposal(null)}>
              Close
            </button>
          </div>
          {proposal.loads.length === 0 && <p className="muted">No loads could be proposed.</p>}
          <div className="grid-2">
            {proposal.loads.map((l) => {
              const v = p?.vehicles.find((x) => x.id === l.vehicleId);
              return (
                <div key={l.vehicleId} className="card plan-card">
                  <strong>
                    {l.plateNumber} · {l.orderIds.length} orders · {l.totals.stops} stops
                  </strong>
                  {v && (
                    <CapBars
                      vehicle={v}
                      totals={l.totals}
                      defaultMaxStops={p?.settings.defaultMaxStops ?? null}
                    />
                  )}
                  <p className="muted small">{l.orderIds.map(ref).join(', ')}</p>
                  <div className="actions">
                    <select
                      value={proposalDrivers[l.vehicleId] ?? ''}
                      onChange={(e) =>
                        setProposalDrivers((d) => ({ ...d, [l.vehicleId]: e.target.value }))
                      }
                      aria-label="Driver"
                    >
                      <option value="">Driver…</option>
                      {p?.drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.fullName}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      disabled={!proposalDrivers[l.vehicleId] || create.isPending}
                      onClick={() =>
                        create.mutate({
                          vehicleId: l.vehicleId,
                          driverId: proposalDrivers[l.vehicleId],
                          orderIds: l.orderIds,
                        })
                      }
                    >
                      Create load
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSelected(new Set(l.orderIds));
                        setVehicleId(l.vehicleId);
                      }}
                    >
                      Edit selection
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {proposal.unplaced.length > 0 && (
            <>
              <h3>Not placed</h3>
              <ul>
                {proposal.unplaced.map((u) => (
                  <li key={u.orderId}>
                    {u.externalRef}: <span className="muted">{u.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="planning">
        <section className="card table-card">
          <div className="card-head">
            <h2>Orders to plan {p ? `(${p.orders.length})` : ''}</h2>
            {selected.size > 0 && (
              <span className="muted">
                {selected.size} selected · {q(chosenTotals.kg)} kg · {q(chosenTotals.m3)} m³ ·{' '}
                {q(chosenTotals.cases)} cases · {q(chosenTotals.pallets)} pallets ·{' '}
                {chosenTotals.stops} stops
              </span>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(p?.orders.map((o) => o.id)))
                      }
                    />
                  </th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Window</th>
                  <th className="num">kg</th>
                  <th className="num">m³</th>
                  <th className="num">Cases</th>
                  <th className="num">Pallets</th>
                  <th className="num">COD</th>
                </tr>
              </thead>
              <tbody>
                {p?.orders.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      Nothing left to plan for this day and depot.
                    </td>
                  </tr>
                )}
                {p?.orders.map((o) => (
                  <tr
                    key={o.id}
                    className={selected.has(o.id) ? 'selected' : ''}
                    onClick={() => toggle(o.id)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${o.externalRef}`}
                      />
                    </td>
                    <td>
                      {o.externalRef}
                      {o.priority !== 'NORMAL' && (
                        <span className={`badge badge-${PRIORITY_TONE[o.priority]}`}>
                          {' '}
                          {humanize(o.priority)}
                        </span>
                      )}
                      {o.status === 'FAILED' && (
                        <div className="text-danger small" title={o.failureReason ?? ''}>
                          re-plan: {o.failureReason}
                        </div>
                      )}
                    </td>
                    <td>
                      {o.customer.name}
                      <div className="muted">
                        {[o.customer.township, o.customer.city].filter(Boolean).join(', ')}
                        {o.customer.latitude == null && ' · no location'}
                      </div>
                    </td>
                    <td>
                      {o.window
                        ? `${formatDateTime(o.window.start).split(', ').pop()}–${formatDateTime(o.window.end).split(', ').pop()}`
                        : '—'}
                    </td>
                    <td className="num">{q(o.weightKg)}</td>
                    <td className="num">{q(o.volumeM3)}</td>
                    <td className="num">{q(o.cases)}</td>
                    <td className="num">{q(o.pallets)}</td>
                    <td className="num">{o.codAmount ? money(o.codAmount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="plan-side">
          <h2>Vehicles</h2>
          {p?.vehicles.map((v) => (
            <div
              key={v.id}
              className={`card plan-card ${v.id === vehicleId ? 'active' : ''}`}
              onClick={() => setVehicleId(v.id)}
              role="button"
              tabIndex={0}
            >
              <div className="card-head">
                <strong>
                  {v.plateNumber} <span className="muted">{humanize(v.vehicleClass)}</span>
                </strong>
                {v.loads.length > 0 && (
                  <span className="badge badge-info">{v.loads.length} load(s) today</span>
                )}
              </div>
              <CapBars
                vehicle={v}
                totals={v.id === vehicleId ? chosenTotals : loadTotals([])}
                defaultMaxStops={p.settings.defaultMaxStops}
              />
              {v.id === vehicleId && (
                <div className="actions" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    aria-label="Driver"
                  >
                    <option value="">Driver…</option>
                    {p.drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={!selected.size || !driverId || create.isPending}
                    onClick={() =>
                      create.mutate({ vehicleId: v.id, driverId, orderIds: [...selected] })
                    }
                  >
                    Create load ({selected.size})
                  </button>
                </div>
              )}
            </div>
          ))}
          {vehicle == null && p?.vehicles.length ? (
            <p className="muted small">Click a vehicle to load the selected orders onto it.</p>
          ) : null}

          <h2>Loads on {date}</h2>
          {p?.loads.length === 0 && <p className="muted">None yet.</p>}
          <ul className="load-list">
            {p?.loads.map((l) => (
              <li key={l.tripId}>
                <Link to={`/loads/${l.tripId}`}>{l.tripNo}</Link> · {l.plateNumber} · {l.driver} ·{' '}
                {l.stops} stops{' '}
                <span className={`badge badge-${TRIP_TONE[l.status] ?? 'muted'}`}>
                  {humanize(l.status)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
