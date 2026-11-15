import { CostCategory, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ColumnChart } from '../components/ColumnChart';
import { RangePicker } from '../components/RangePicker';
import { accessToken, api, session } from '../lib/api';
import { formatDateTime, humanize, isoDay, monthRange, money } from '../lib/format';
import type { Branch, BudgetGrid, SharedCost, Tco, TripCosts } from '../lib/types';
import { errorText } from './IncidentsPage';

const GROUPS = [
  { key: 'fuel', label: 'Fuel', color: 'var(--series-1)', cats: ['FUEL'] },
  { key: 'maintenance', label: 'Maintenance', color: 'var(--series-2)', cats: ['MAINTENANCE'] },
  {
    key: 'ownership',
    label: 'Depreciation & lease',
    color: 'var(--series-3)',
    cats: ['DEPRECIATION', 'LEASE'],
  },
  { key: 'other', label: 'Other costs', color: 'var(--series-4)', cats: [] as string[] },
];
const groupOf = (c: string) => GROUPS.find((g) => g.cats.includes(c))?.key ?? 'other';

/** Total cost of ownership, cost per trip, shared costs and the monthly cost trend. */
export function CostsPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.COST_WRITE);
  // Month to date (inclusive days, as the ledger expects)
  const [range, setRange] = useState(() => ({ from: monthRange(0).from, to: isoDay(new Date()) }));
  const [error, setError] = useState<string | null>(null);
  const year = Number(range.to.slice(0, 4));
  const q = `from=${range.from}&to=${range.to}`;
  const tco = useQuery({
    queryKey: ['tco', range],
    queryFn: () => api<Tco>(`/analytics/tco?${q}`),
  });
  const trips = useQuery({
    queryKey: ['trip-costs', range],
    queryFn: () => api<TripCosts>(`/analytics/trip-costs?${q}`),
  });
  const shared = useQuery({
    queryKey: ['shared-costs', range],
    queryFn: () => api<SharedCost[]>(`/costs/shared?${q}`),
  });
  const trend = useQuery({
    queryKey: ['budgets', year, 'company'],
    queryFn: () => api<BudgetGrid>(`/costs/budgets?year=${year}&dimension=company`),
    enabled: session.can(Permission.BUDGET_READ),
  });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const t = tco.data;
  const cur = t?.range.currency ?? '';

  const addShared = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/costs/shared', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['shared-costs'] });
      void qc.invalidateQueries({ queryKey: ['tco'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const delShared = useMutation({
    mutationFn: (id: string) => api(`/costs/shared/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shared-costs'] });
      void qc.invalidateQueries({ queryKey: ['tco'] });
    },
  });
  function submitShared(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addShared.mutate({
      period: f.get('period'),
      branchId: f.get('branchId') || null,
      category: f.get('category'),
      description: String(f.get('description')).trim(),
      amount: Number(f.get('amount')),
    });
    e.currentTarget.reset();
  }

  async function csv() {
    const res = await fetch(`/api/analytics/tco.csv?${q}`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    if (!res.ok) return setError(`Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle-tco_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const months = trend.data?.scopes[0];
  const series = trend.data
    ? trend.data.periods
        .map((p, i) => {
          const values: Record<string, number> = {
            fuel: 0,
            maintenance: 0,
            ownership: 0,
            other: 0,
          };
          for (const l of months?.lines ?? []) values[groupOf(l.category)] += l.months[i].actual;
          return { label: p, values };
        })
        .filter((d) => d.label <= new Date().toISOString().slice(0, 7))
    : [];
  const missing = t?.vehicles.filter((v) => v.assetDataMissing).length ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>Costs & TCO</h1>
        <div className="actions">
          <RangePicker value={range} onChange={setRange} />
          <button className="btn" onClick={csv}>
            CSV
          </button>
          <Link className="btn" to="/budgets">
            Budgets
          </Link>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {t && (
        <section className="tiles">
          {[
            ['Total cost', `${money(t.totals.total)} ${cur}`, `${t.vehicles.length} vehicles`],
            [
              'Cost per km',
              t.totals.perKm != null ? `${money(t.totals.perKm)} ${cur}` : '—',
              `${money(t.totals.km)} km driven`,
            ],
            [
              'Ownership',
              `${money((t.totals.byCategory.DEPRECIATION ?? 0) + (t.totals.byCategory.LEASE ?? 0))} ${cur}`,
              'depreciation + lease',
            ],
            ['Fuel', `${money(t.totals.byCategory.FUEL ?? 0)} ${cur}`, ''],
            ['Maintenance', `${money(t.totals.byCategory.MAINTENANCE ?? 0)} ${cur}`, ''],
            [
              'Not allocated',
              `${money(t.totals.unallocated)} ${cur}`,
              'shared costs with no km in scope',
            ],
          ].map(([label, value, hint]) => (
            <div className="card tile" key={label}>
              <span className="tile-label">{label}</span>
              <span className="tile-value small">{value}</span>
              <span className="muted small">{hint}</span>
            </div>
          ))}
        </section>
      )}
      {series.length > 0 && (
        <section className="card">
          <ColumnChart
            title={`Cost per month, ${year} (${cur})`}
            data={series}
            series={GROUPS.map(({ key, label, color }) => ({ key, label, color }))}
            format={(v) => money(v)}
            formatX={(p) =>
              new Date(`${p}-01T00:00`).toLocaleDateString('en-GB', { month: 'short' })
            }
          />
        </section>
      )}
      {missing > 0 && (
        <p className="muted">
          {missing} vehicle(s) have no purchase price / useful life (owned) or monthly lease cost:
          their TCO has no ownership cost. Add it on the vehicle (Edit → Cost of ownership).
        </p>
      )}
      <section className="card table-card">
        <div className="card-head">
          <h2>Total cost of ownership by vehicle</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Branch</th>
                <th className="num">km</th>
                <th className="num">Ownership</th>
                <th className="num">Running</th>
                <th className="num">Shared</th>
                <th className="num">Total</th>
                <th className="num">Per km</th>
                <th className="num">Per month</th>
                <th className="num">Book value</th>
              </tr>
            </thead>
            <tbody>
              {t?.vehicles.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>{' '}
                    <span className="muted">{v.name}</span>
                    {v.assetDataMissing && <span className="badge badge-muted">no asset data</span>}
                  </td>
                  <td>{v.branch ?? '—'}</td>
                  <td className="num">{money(v.km)}</td>
                  <td className="num">{money(v.ownershipCost)}</td>
                  <td className="num">{money(v.running)}</td>
                  <td className="num">{money(v.shared)}</td>
                  <td className="num">
                    <strong>{money(v.total)}</strong>
                  </td>
                  <td className="num">{v.perKm != null ? money(v.perKm) : '—'}</td>
                  <td className="num">{v.perMonth != null ? money(v.perMonth) : '—'}</td>
                  <td className="num">{v.bookValue != null ? money(v.bookValue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t && (
          <p className="muted small" style={{ padding: '0 16px 12px' }}>
            {t.method}
          </p>
        )}
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Shared costs</h2>
          <span className="muted small">
            Overheads not tied to one vehicle, split over the vehicles in scope by km driven that
            month.
          </span>
        </div>
        {canWrite && (
          <form className="inline-form" onSubmit={submitShared} style={{ padding: '0 16px 12px' }}>
            <input
              name="period"
              type="month"
              required
              defaultValue={range.to.slice(0, 7)}
              aria-label="Month"
            />
            <select name="branchId" aria-label="Branch" defaultValue="">
              <option value="">Whole company</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select name="category" aria-label="Category" defaultValue="OTHER">
              {Object.values(CostCategory)
                .filter((c) => !['FUEL', 'MAINTENANCE', 'DEPRECIATION'].includes(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
            </select>
            <input
              name="description"
              required
              minLength={2}
              placeholder="e.g. Workshop rent"
              aria-label="Description"
            />
            <input
              name="amount"
              type="number"
              min={1}
              step="any"
              required
              placeholder="Amount"
              aria-label="Amount"
            />
            <button className="btn btn-primary" disabled={addShared.isPending}>
              Add
            </button>
          </form>
        )}
        <table>
          <tbody>
            {shared.data?.length === 0 && (
              <tr>
                <td className="muted">No shared costs in this period.</td>
              </tr>
            )}
            {shared.data?.map((c) => (
              <tr key={c.id}>
                <td>{c.period}</td>
                <td>{c.description}</td>
                <td>{branches.data?.find((b) => b.id === c.branchId)?.name ?? 'Whole company'}</td>
                <td>{humanize(c.category)}</td>
                <td className="num">{money(c.amount)}</td>
                <td>
                  {t?.unallocated.some((u) => u.id === c.id) && (
                    <span className="badge badge-warn">not allocated</span>
                  )}
                  {canWrite && (
                    <button
                      className="link danger"
                      onClick={() =>
                        confirm(`Delete "${c.description}"?`) && delShared.mutate(c.id)
                      }
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Cost per trip</h2>
          {trips.data && (
            <span className="muted small">
              {trips.data.totals.trips} trips · {money(trips.data.totals.total)} {cur} ·{' '}
              {money(trips.data.totals.km)} km
            </span>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Trip</th>
                <th>Ended</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th className="num">km</th>
                <th className="num">Rate / km</th>
                <th className="num">Running</th>
                <th className="num">Trip expenses</th>
                <th className="num">Driver</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {trips.data?.trips.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No completed trips in this period.
                  </td>
                </tr>
              )}
              {trips.data?.trips.slice(0, 100).map((r) => (
                <tr key={r.tripId}>
                  <td>
                    <Link to={`/trips/${r.tripId}`}>{r.tripNo}</Link>
                    {r.stops > 0 && <span className="muted"> · {r.stops} stops</span>}
                  </td>
                  <td>{formatDateTime(r.endedAt)}</td>
                  <td>{r.vehicle ?? '—'}</td>
                  <td>{r.driver ?? '—'}</td>
                  <td className="num">{r.km ?? '—'}</td>
                  <td className="num">{r.ratePerKm != null ? money(r.ratePerKm) : '—'}</td>
                  <td className="num">{money(r.running)}</td>
                  <td className="num">{money(r.expenses)}</td>
                  <td className="num">{money(r.driverCost)}</td>
                  <td className="num">
                    <strong>{money(r.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {trips.data && (
          <p className="muted small" style={{ padding: '0 16px 12px' }}>
            {trips.data.method}
          </p>
        )}
      </section>
    </>
  );
}
