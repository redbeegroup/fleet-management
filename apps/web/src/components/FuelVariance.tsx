import { Permission } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { humanize, isoDay, money } from '../lib/format';
import type { BudgetGrid } from '../lib/types';
import { RangePicker } from './RangePicker';

interface Variance {
  vehicles: {
    id: string;
    plateNumber: string;
    name: string;
    vehicleClass: string;
    fills: number;
    km: number;
    litres: number;
    actualKmPerL: number | null;
    expectedKmPerL: number | null;
    basis: 'vehicle' | 'class' | null;
    variancePct: number | null;
    excessLitres: number | null;
    excessCost: number | null;
  }[];
  totals: { excessLitres: number; excessCost: number };
  method: string;
}

/** Consumption variance per vehicle and the fuel budget of the month. */
export function FuelVariance() {
  const [range, setRange] = useState(() => {
    const now = new Date();
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
  });
  // The API takes [from, to) instants; the picker gives inclusive days.
  const toExcl = isoDay(new Date(new Date(`${range.to}T00:00`).getTime() + 86_400_000));
  const { data } = useQuery({
    queryKey: ['fuel-variance', range],
    queryFn: () => api<Variance>(`/fuel/variance?from=${range.from}&to=${toExcl}`),
  });
  const year = Number(range.to.slice(0, 4));
  const month = Number(range.to.slice(5, 7)) - 1;
  const budget = useQuery({
    queryKey: ['budgets', year, 'company'],
    queryFn: () => api<BudgetGrid>(`/costs/budgets?year=${year}&dimension=company`),
    enabled: session.can(Permission.BUDGET_READ),
  });
  const fuelLine = budget.data?.scopes[0]?.lines.find((l) => l.category === 'FUEL');
  const cell = fuelLine?.months[month];
  const worst = data?.vehicles.filter((v) => (v.variancePct ?? 0) < -10).length ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>Fuel consumption</h1>
        <div className="actions">
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Fuel above expected</span>
          <span className="tile-value small">
            {data ? `${money(data.totals.excessLitres)} L` : '…'}
          </span>
          <span className="muted small">
            {data ? `≈ ${money(data.totals.excessCost)} at the price paid` : ''}
          </span>
        </div>
        <div className="card tile">
          <span className="tile-label">Vehicles &gt; 10 % worse</span>
          <span className="tile-value small">{data ? worst : '…'}</span>
          <span className="muted small">than their own or their class median</span>
        </div>
        {session.can(Permission.BUDGET_READ) && (
          <div className="card tile">
            <span className="tile-label">Fuel budget {range.to.slice(0, 7)}</span>
            <span className="tile-value small">
              {cell?.budget ? `${cell.usedPct} % used` : 'No budget'}
            </span>
            <span className="muted small">
              {cell?.budget ? (
                `${money(cell.actual)} of ${money(cell.budget)} · forecast ${money(cell.forecast)}`
              ) : (
                <Link to="/budgets">Set fuel budgets</Link>
              )}
            </span>
          </div>
        )}
      </section>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Class</th>
                <th className="num">Fills</th>
                <th className="num">km</th>
                <th className="num">Litres</th>
                <th className="num">km/L</th>
                <th className="num">Expected</th>
                <th className="num">Variance</th>
                <th className="num">Excess L</th>
                <th className="num">Excess cost</th>
              </tr>
            </thead>
            <tbody>
              {data?.vehicles.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No fills in this period.
                  </td>
                </tr>
              )}
              {data?.vehicles.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>{' '}
                    <span className="muted">{v.name}</span>
                  </td>
                  <td>{humanize(v.vehicleClass)}</td>
                  <td className="num">{v.fills}</td>
                  <td className="num">{money(v.km)}</td>
                  <td className="num">{money(v.litres)}</td>
                  <td className="num">{v.actualKmPerL ?? '—'}</td>
                  <td
                    className="num"
                    title={
                      v.basis === 'class'
                        ? 'Class median'
                        : v.basis === 'vehicle'
                          ? 'Own 90-day median'
                          : ''
                    }
                  >
                    {v.expectedKmPerL ?? '—'}
                    {v.basis === 'class' && <span className="muted"> (class)</span>}
                  </td>
                  <td className="num">
                    {v.variancePct == null ? (
                      '—'
                    ) : (
                      <span
                        className={`badge badge-${v.variancePct < -10 ? 'danger' : v.variancePct < -5 ? 'warn' : 'ok'}`}
                      >
                        {v.variancePct > 0 ? '+' : ''}
                        {v.variancePct} %
                      </span>
                    )}
                  </td>
                  <td className="num">{v.excessLitres ? money(v.excessLitres) : '—'}</td>
                  <td className="num">{v.excessCost ? money(v.excessCost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <p className="muted small" style={{ padding: '0 16px 12px' }}>
            {data.method}
          </p>
        )}
      </section>
    </>
  );
}
