import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';
import type { CompanySettings } from '../lib/types';
import { errorText } from './IncidentsPage';

type Advice = 'REPLACE_NOW' | 'PLAN' | 'OK';
interface Row {
  vehicle: { id: string; plateNumber: string; name: string; year: number | null; vehicleClass: string; status: string; ownership: string };
  inServiceAt: string | null;
  ageYears: number | null;
  odometerKm: number;
  km12m: number;
  runningPerKm12m: number | null;
  classMedianRunningPerKm: number | null;
  downtimePct12m: number;
  economicLife: { years: number; projected: boolean; avgCostPerKm: number } | null;
  bookValue: number | null;
  limits: { maxAgeYears: number | null; maxKm: number | null; maxDowntimePct: number | null };
  replacementPlannedFor: string | null;
  replacementNote: string | null;
  advice: Advice;
  reasons: string[];
  monthsToLimit: number | null;
  assetDataMissing: boolean;
}
interface Disposal {
  id: string;
  vehicleId: string;
  plateNumber: string;
  name: string;
  disposedAt: string;
  method: string;
  buyer: string | null;
  saleValue: string;
  bookValue: string | null;
  gainLoss: string | null;
}
interface Data {
  currency: string;
  totals: { replaceNow: number; plan: number; ok: number; planned: number; replaceNowBookValue: number };
  vehicles: Row[];
  disposals: Disposal[];
}

const ADVICE: Record<Advice, [string, string]> = { REPLACE_NOW: ['Replace', 'danger'], PLAN: ['Plan', 'warn'], OK: ['OK', 'ok'] };

/** Fleet lifecycle: replacement advice from limits and the cost curve, plans, disposals. */
export function LifecyclePage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.VEHICLE_WRITE);
  const [filter, setFilter] = useState<Advice | ''>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({ queryKey: ['lifecycle'], queryFn: () => api<Data>('/lifecycle/replacement') });
  const plan = useMutation({
    mutationFn: ({ id, b }: { id: string; b: unknown }) => api(`/vehicles/${id}/replacement-plan`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lifecycle'] }),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const d = q.data;
  const rows = (d?.vehicles ?? []).filter((r) => !filter || r.advice === filter);
  return (
    <>
      <header className="page-head">
        <h1>Lifecycle & replacement</h1>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <section className="tiles">
        {(
          [
            ['REPLACE_NOW', 'Replace now', d ? `book value ${money(d.totals.replaceNowBookValue)}` : ''],
            ['PLAN', 'Plan replacement', 'a limit is reached within the planning window'],
            ['OK', 'OK', ''],
          ] as [Advice, string, string][]
        ).map(([k, label, sub]) => (
          <button key={k} className={`card tile tile-button${filter === k ? ' sel' : ''}`} onClick={() => setFilter(filter === k ? '' : k)} aria-pressed={filter === k}>
            <span className="tile-label">{label}</span>
            <span className="tile-value small">{d ? d.totals[k === 'REPLACE_NOW' ? 'replaceNow' : k === 'PLAN' ? 'plan' : 'ok'] : '…'}</span>
            <span className="muted small">{sub}</span>
          </button>
        ))}
        <div className="card tile">
          <span className="tile-label">Replacements planned</span>
          <span className="tile-value small">{d?.totals.planned ?? '…'}</span>
        </div>
      </section>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Advice</th>
                <th>Why</th>
                <th className="num">Age</th>
                <th className="num">Odometer</th>
                <th className="num">Running cost / km (class)</th>
                <th className="num">Downtime 12 m</th>
                <th className="num">Economic life</th>
                <th className="num">Book value</th>
                <th>Planned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [label, tone] = ADVICE[r.advice];
                return (
                  <tr key={r.vehicle.id}>
                    <td>
                      <Link to={`/vehicles/${r.vehicle.id}`}>{r.vehicle.plateNumber}</Link>
                      <div className="muted small">
                        {r.vehicle.name}
                        {r.vehicle.year ? ` · ${r.vehicle.year}` : ''} · {humanize(r.vehicle.vehicleClass)}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${tone}`}>{label}</span>
                    </td>
                    <td className="small">{r.reasons.join('; ') || (r.monthsToLimit != null ? `next limit in ${r.monthsToLimit} months` : '—')}</td>
                    <td className="num">{r.ageYears != null ? `${r.ageYears} y` : '—'}</td>
                    <td className="num">{r.odometerKm.toLocaleString()} km</td>
                    <td className="num">
                      {r.runningPerKm12m != null ? money(r.runningPerKm12m) : '—'}
                      <span className="muted small"> ({r.classMedianRunningPerKm != null ? money(r.classMedianRunningPerKm) : '—'})</span>
                    </td>
                    <td className="num">{r.downtimePct12m} %</td>
                    <td className="num" title={r.economicLife ? `Lowest average cost ${money(r.economicLife.avgCostPerKm)} per km` : 'Needs purchase data and two full years of history'}>
                      {r.economicLife ? `${r.economicLife.years} y${r.economicLife.projected ? ' (projected)' : ''}` : r.assetDataMissing ? 'no asset data' : '—'}
                    </td>
                    <td className="num">{r.bookValue != null ? money(r.bookValue) : '—'}</td>
                    <td>
                      {canWrite ? (
                        <input
                          type="month"
                          aria-label={`Replacement month for ${r.vehicle.plateNumber}`}
                          defaultValue={r.replacementPlannedFor?.slice(0, 7) ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if ((v || null) !== (r.replacementPlannedFor?.slice(0, 7) ?? null)) plan.mutate({ id: r.vehicle.id, b: { replacementPlannedFor: v ? `${v}-01` : null, replacementNote: r.replacementNote } });
                          }}
                        />
                      ) : r.replacementPlannedFor ? (
                        formatDate(r.replacementPlannedFor)
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Running cost: everything except depreciation or lease over the last 12 months. Economic life: the year of service with the lowest average cost per km (falling market value + running costs), projected
          from the cost trend when it lies ahead. Limits per class are in the settings below.
        </p>
      </section>
      {session.can(Permission.SETTINGS_WRITE) && <LimitsCard classes={[...new Set((d?.vehicles ?? []).map((r) => r.vehicle.vehicleClass))]} rows={d?.vehicles ?? []} setMsg={setMsg} />}
      <section className="card table-card">
        <div className="card-head">
          <h2>Disposals</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th>How</th>
              <th>Buyer</th>
              <th className="num">Sale value</th>
              <th className="num">Book value</th>
              <th className="num">Gain / loss</th>
            </tr>
          </thead>
          <tbody>
            {d?.disposals.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  None yet. Dispose of a vehicle from its page.
                </td>
              </tr>
            )}
            {d?.disposals.map((x) => (
              <tr key={x.id}>
                <td>{formatDate(x.disposedAt)}</td>
                <td>
                  <Link to={`/vehicles/${x.vehicleId}`}>{x.plateNumber}</Link> <span className="muted small">{x.name}</span>
                </td>
                <td>{humanize(x.method)}</td>
                <td>{x.buyer ?? '—'}</td>
                <td className="num">{money(x.saleValue)}</td>
                <td className="num">{money(x.bookValue)}</td>
                <td className="num">{x.gainLoss == null ? '—' : `${Number(x.gainLoss) >= 0 ? '+' : ''}${money(x.gainLoss)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function LimitsCard({ classes, rows, setMsg }: { classes: string[]; rows: Row[]; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<CompanySettings & { lifecycle: { costAboveClassPct: number; planWithinMonths: number } }>('/company/settings') });
  const save = useMutation({
    mutationFn: (lifecycle: unknown) => api('/company/settings', { method: 'PATCH', body: JSON.stringify({ lifecycle }) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Limits saved.' }), void qc.invalidateQueries({ queryKey: ['lifecycle'] }), void qc.invalidateQueries({ queryKey: ['settings'] })),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const s = settings.data?.lifecycle;
  if (!s || !classes.length) return null;
  const current = (cls: string) => rows.find((r) => r.vehicle.vehicleClass === cls)?.limits;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const num = (k: string) => (f.get(k) === '' ? null : Number(f.get(k)));
        save.mutate({
          costAboveClassPct: num('costAboveClassPct') ?? 30,
          planWithinMonths: num('planWithinMonths') ?? 12,
          limits: Object.fromEntries(classes.map((c) => [c, { maxAgeYears: num(`${c}.age`), maxKm: num(`${c}.km`), maxDowntimePct: num(`${c}.down`) }])),
        });
      }}
    >
      <h2>Replacement limits</h2>
      <table>
        <thead>
          <tr>
            <th>Class</th>
            <th>Max age (years)</th>
            <th>Max km</th>
            <th>Max downtime (%)</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => {
            const l = current(c);
            return (
              <tr key={c}>
                <td>{humanize(c)}</td>
                <td>
                  <input name={`${c}.age`} type="number" min={1} max={40} defaultValue={l?.maxAgeYears ?? ''} aria-label={`${c} max age`} />
                </td>
                <td>
                  <input name={`${c}.km`} type="number" min={10000} step={1000} defaultValue={l?.maxKm ?? ''} aria-label={`${c} max km`} />
                </td>
                <td>
                  <input name={`${c}.down`} type="number" min={1} max={100} defaultValue={l?.maxDowntimePct ?? ''} aria-label={`${c} max downtime`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-grid">
        <label>
          Running cost above the class median (%)
          <input name="costAboveClassPct" type="number" min={5} max={500} defaultValue={s.costAboveClassPct} />
        </label>
        <label>
          Planning window (months)
          <input name="planWithinMonths" type="number" min={1} max={60} defaultValue={s.planWithinMonths} />
        </label>
      </div>
      <p className="muted small">Empty = not used for that class.</p>
      <button className="btn btn-primary" disabled={save.isPending}>
        Save limits
      </button>
    </form>
  );
}
