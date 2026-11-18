import { Permission, VehicleClass } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { accessToken, api, session } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';
import { errorText } from './IncidentsPage';

type GroupBy = 'trip' | 'vehicle' | 'customer' | 'branch';
interface Row {
  key: string;
  label: string;
  sub: string | null;
  trips: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  billed: number | null;
  fullCost?: number;
  fullMargin?: number;
  kind?: string;
  endedAt?: string;
  rated?: boolean;
  customers?: string[];
}
interface Data {
  range: { from: string; to: string; currency: string; groupBy: GroupBy };
  totals: { trips: number; revenue: number; cost: number; margin: number; marginPct: number | null; unrated: number; lossMaking: number; billed: number | null; fullCost: number | null };
  rows: Row[];
  method: string;
}
const today = () => new Date(Date.now() + 6.5 * 3_600_000).toISOString().slice(0, 10);
const tone = (m: number | null) => (m == null ? 'muted' : m < 0 ? 'danger' : m < 10 ? 'warn' : 'ok');

/** Fleet profitability: rate-card revenue against trip cost (and the full ledger cost for vehicles and branches). */
export function ProfitabilityPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const groupBy = (sp.get('by') as GroupBy) ?? 'trip';
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const qs = `from=${range.from}&to=${range.to}&groupBy=${groupBy}`;
  const q = useQuery({ queryKey: ['profitability', qs], queryFn: () => api<Data>(`/analytics/profitability?${qs}`) });
  const rerate = useMutation({
    mutationFn: () => api<{ trips: number; revenue: number }>('/rate-cards/rerate', { method: 'POST', body: JSON.stringify(range) }),
    onSuccess: (r) => (setMsg({ ok: true, text: `${r.trips} trips re-rated: ${money(r.revenue)}` }), void qc.invalidateQueries({ queryKey: ['profitability'] })),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  async function csv() {
    const res = await fetch(`/api/analytics/profitability.csv?${qs}`, { headers: { Authorization: `Bearer ${accessToken()}` } });
    if (!res.ok) return setMsg({ ok: false, text: `Export failed (${res.status})` });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `profitability-${groupBy}_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const d = q.data;
  const t = d?.totals;
  const full = groupBy === 'vehicle' || groupBy === 'branch';
  return (
    <>
      <header className="page-head">
        <h1>Profitability</h1>
        <div className="inline-form" style={{ marginTop: 0 }}>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
          <button className="btn" onClick={() => void csv()}>
            CSV
          </button>
          {session.can(Permission.RATE_CARD_WRITE) && (
            <button className="btn" disabled={rerate.isPending} onClick={() => rerate.mutate()} title="Apply the current rate cards to every completed trip in the period">
              Re-rate period
            </button>
          )}
        </div>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Revenue</span>
          <span className="tile-value small">{t ? money(t.revenue) : '…'}</span>
          <span className="muted small">{t ? `${t.trips} completed trips${t.unrated ? ` · ${t.unrated} without a rate card` : ''}` : ''}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Trip cost</span>
          <span className="tile-value small">{t ? money(t.cost) : '…'}</span>
          <span className="muted small">{t?.fullCost != null ? `full fleet cost ${money(t.fullCost)}` : 'km × cost per km + trip expenses'}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Margin</span>
          <span className="tile-value small">{t ? money(t.margin) : '…'}</span>
          {t && <span className={`badge badge-${tone(t.marginPct)}`}>{t.marginPct != null ? `${t.marginPct} %` : '—'}</span>}
        </div>
        <div className="card tile">
          <span className="tile-label">Loss-making</span>
          <span className="tile-value small">{t?.lossMaking ?? '…'}</span>
          <span className="muted small">{groupBy}s{t?.billed != null ? ` · billed in SAP ${money(t.billed)}` : ''}</span>
        </div>
      </section>
      <nav className="tabs" role="tablist" aria-label="Group by">
        {(['trip', 'customer', 'vehicle', 'branch'] as GroupBy[]).map((g) => (
          <button key={g} role="tab" aria-selected={groupBy === g} className={groupBy === g ? 'active' : ''} onClick={() => setSp(g === 'trip' ? {} : { by: g })}>
            By {g}
          </button>
        ))}
      </nav>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{humanize(groupBy)}</th>
                <th className="num">Trips</th>
                <th className="num">Revenue</th>
                <th className="num">Trip cost</th>
                <th className="num">Margin</th>
                {full && <th className="num">Full cost</th>}
                {full && <th className="num">Margin after fixed costs</th>}
                {t?.billed != null && <th className="num">Billed (SAP)</th>}
              </tr>
            </thead>
            <tbody>
              {d?.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No completed trips in the period.
                  </td>
                </tr>
              )}
              {d?.rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {groupBy === 'trip' ? <Link to={`/trips/${r.key}`}>{r.label}</Link> : groupBy === 'vehicle' ? <Link to={`/vehicles/${r.key}`}>{r.label}</Link> : r.label}
                    <div className="muted small">
                      {groupBy === 'trip' ? [r.sub, r.endedAt && formatDate(r.endedAt), r.customers?.join(', ')].filter(Boolean).join(' · ') : r.sub && (groupBy === 'vehicle' ? humanize(r.sub) : r.sub)}
                      {groupBy === 'trip' && r.rated === false && <span className="badge badge-warn"> no rate card</span>}
                    </div>
                  </td>
                  <td className="num">{r.trips}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className="num">{money(r.cost)}</td>
                  <td className="num">
                    {money(r.margin)} <span className={`badge badge-${tone(r.marginPct)}`}>{r.marginPct != null ? `${r.marginPct} %` : '—'}</span>
                  </td>
                  {full && <td className="num">{money(r.fullCost ?? 0)}</td>}
                  {full && <td className={`num${(r.fullMargin ?? 0) < 0 ? ' text-danger' : ''}`}>{money(r.fullMargin ?? 0)}</td>}
                  {t?.billed != null && <td className="num">{r.billed != null ? money(r.billed) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{d?.method} Rows with the lowest margin come first.</p>
      </section>
    </>
  );
}

interface Card {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  vehicleClass: string | null;
  branchId: string | null;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  priority: number;
  perTrip: string;
  perKm: string;
  perKg: string;
  perDrop: string;
  perPallet: string;
  minCharge: string;
  fuelSurchargePct: string;
  waitingPerHour: string;
  freeWaitMinutes: number;
  notes: string | null;
}
const CHARGES: [keyof Card, string][] = [
  ['perTrip', 'Per trip'],
  ['perKm', 'Per km'],
  ['perKg', 'Per kg'],
  ['perDrop', 'Per drop'],
  ['perPallet', 'Per pallet'],
  ['minCharge', 'Minimum'],
  ['fuelSurchargePct', 'Fuel surcharge %'],
  ['waitingPerHour', 'Waiting per hour'],
];

/** Freight rate cards: the most specific valid card prices each trip (customer + class > customer > class > default). */
export function RateCardsPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.RATE_CARD_WRITE);
  const [edit, setEdit] = useState<Card | 'new' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; amount: number; breakdown: Record<string, number> } | null>(null);
  const cards = useQuery({ queryKey: ['rate-cards'], queryFn: () => api<Card[]>('/rate-cards') });
  const customers = useQuery({ queryKey: ['customers', 'all'], queryFn: () => api<{ items: { id: string; name: string; code: string }[] }>('/customers?pageSize=200'), enabled: !!edit });
  const save = useMutation({
    mutationFn: (b: { id?: string; body: unknown }) => api(b.id ? `/rate-cards/${b.id}` : '/rate-cards', { method: b.id ? 'PATCH' : 'POST', body: JSON.stringify(b.body) }),
    onSuccess: () => (setEdit(null), setMsg({ ok: true, text: 'Rate card saved. Use “Re-rate period” on Profitability to apply it to past trips.' }), void qc.invalidateQueries({ queryKey: ['rate-cards'] })),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const pv = useMutation({
    mutationFn: ({ id, b }: { id: string; b: unknown }) => api<{ amount: number; breakdown: Record<string, number> }>(`/rate-cards/${id}/preview`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (r, v) => setPreview({ id: v.id, ...r }),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k) || 0);
    const c = edit === 'new' ? null : edit;
    save.mutate({
      id: c?.id,
      body: {
        name: f.get('name'),
        customerId: f.get('customerId') || null,
        vehicleClass: f.get('vehicleClass') || null,
        validFrom: f.get('validFrom'),
        validTo: f.get('validTo') || null,
        active: f.get('active') === 'on',
        priority: num('priority'),
        ...Object.fromEntries(CHARGES.map(([k]) => [k, num(k)])),
        freeWaitMinutes: num('freeWaitMinutes'),
        notes: f.get('notes') || null,
      },
    });
  }
  const c = edit && edit !== 'new' ? edit : null;
  const scope = (x: Card) => [x.customerName ?? (x.customerId ? 'customer' : null), x.vehicleClass && humanize(x.vehicleClass)].filter(Boolean).join(' · ') || 'Default (all customers and classes)';
  return (
    <>
      <header className="page-head">
        <h1>Rate cards</h1>
        {canWrite && !edit && (
          <button className="btn btn-primary" onClick={() => setEdit('new')}>
            New rate card
          </button>
        )}
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {edit && (
        <form className="card form-grid" onSubmit={submit} key={c?.id ?? 'new'}>
          <label>
            Name
            <input name="name" required defaultValue={c?.name ?? ''} />
          </label>
          <label>
            Customer
            <select name="customerId" defaultValue={c?.customerId ?? ''} key={customers.data ? 'ready' : 'loading'}>
              <option value="">All customers</option>
              {customers.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle class
            <select name="vehicleClass" defaultValue={c?.vehicleClass ?? ''}>
              <option value="">All classes</option>
              {Object.values(VehicleClass).map((v) => (
                <option key={v} value={v}>
                  {humanize(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valid from
            <input name="validFrom" type="date" required defaultValue={c?.validFrom.slice(0, 10) ?? today()} />
          </label>
          <label>
            Valid to
            <input name="validTo" type="date" defaultValue={c?.validTo?.slice(0, 10) ?? ''} />
          </label>
          <label title="Breaks ties between cards that are equally specific">
            Priority
            <input name="priority" type="number" min={0} max={100} defaultValue={c?.priority ?? 0} />
          </label>
          {CHARGES.map(([k, label]) => (
            <label key={k}>
              {label}
              <input name={k} type="number" min={0} step="any" defaultValue={c ? Number(c[k]) : 0} />
            </label>
          ))}
          <label>
            Free waiting (minutes)
            <input name="freeWaitMinutes" type="number" min={0} defaultValue={c?.freeWaitMinutes ?? 0} />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={c?.active ?? true} /> Active
          </label>
          <label className="span-all">
            Notes
            <input name="notes" defaultValue={c?.notes ?? ''} />
          </label>
          <div className="span-all">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save
            </button>{' '}
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th>Applies to</th>
                <th>Valid</th>
                <th>Charges</th>
                <th>Try it</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cards.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No rate cards yet: trips get no revenue until a card applies.
                  </td>
                </tr>
              )}
              {cards.data?.map((x) => (
                <tr key={x.id} className={x.active ? '' : 'muted'}>
                  <td>
                    {x.name}
                    {!x.active && <span className="badge badge-muted"> inactive</span>}
                  </td>
                  <td>{scope(x)}</td>
                  <td className="small">
                    {formatDate(x.validFrom)} – {x.validTo ? formatDate(x.validTo) : 'open'}
                  </td>
                  <td className="small">
                    {CHARGES.filter(([k]) => Number(x[k]) > 0)
                      .map(([k, label]) => `${label} ${k === 'fuelSurchargePct' ? Number(x[k]) : money(x[k] as string)}`)
                      .join(' · ')}
                    {x.waitingPerHour !== '0' && x.freeWaitMinutes ? ` (after ${x.freeWaitMinutes} min)` : ''}
                  </td>
                  <td>
                    <form
                      className="inline-form"
                      style={{ marginTop: 0 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        pv.mutate({ id: x.id, b: { km: Number(f.get('km') || 0), kg: Number(f.get('kg') || 0), drops: Number(f.get('drops') || 0) } });
                      }}
                    >
                      <input name="km" type="number" min={0} placeholder="km" style={{ width: 70 }} aria-label="km" />
                      <input name="kg" type="number" min={0} placeholder="kg" style={{ width: 80 }} aria-label="kg" />
                      <input name="drops" type="number" min={0} placeholder="drops" style={{ width: 70 }} aria-label="drops" />
                      <button className="btn btn-ghost">=</button>
                      {preview?.id === x.id && <strong>{money(preview.amount)}</strong>}
                    </form>
                  </td>
                  <td>
                    {canWrite && (
                      <button className="btn btn-ghost" onClick={() => setEdit(x)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Each completed trip is priced by the most specific valid card: customer + vehicle class, then customer, then vehicle class, then the default. Delivery trips are priced per customer: km and the per-trip charge
          follow the customer’s weight share; failed drops are not charged.
        </p>
      </section>
    </>
  );
}
