import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RangePicker } from '../components/RangePicker';
import { api } from '../lib/api';
import { humanize, lastDays } from '../lib/format';

type Metric = 'utilizationPct' | 'kmPerDay' | 'tripsPerDay' | 'availabilityPct' | 'costPerKm' | 'fuelKmPerLitre' | 'idlePct' | 'overspeedPer100Km';
interface Cell {
  value: number | null;
  vsMedianPct: number | null;
  percentile: number | null;
}
interface Data {
  metrics: { key: Metric; label: string; higherIsBetter: boolean; score: boolean }[];
  classes: { vehicleClass: string; vehicles: number; medians: Record<Metric, number | null> }[];
  vehicles: { id: string; plateNumber: string; vehicleClass: string; branchName: string | null; metrics: Record<Metric, Cell>; score: number | null; rank?: number; of?: number }[];
  branches: { branchId: string | null; branchName: string; vehicles: number; score: number | null; vsClassPct: Record<Metric, number | null> }[];
}

const UNIT: Partial<Record<Metric, string>> = { utilizationPct: '%', availabilityPct: '%', idlePct: '%' };
const fmt = (m: Metric, v: number | null) => (v == null ? '—' : `${v.toLocaleString('en-US', { maximumFractionDigits: m === 'tripsPerDay' ? 2 : 1 })}${UNIT[m] ? ` ${UNIT[m]}` : ''}`);
/** Deviation from the class median, with a word for better / worse (never colour alone). */
function Dev({ pct, higherIsBetter }: { pct: number | null; higherIsBetter: boolean }) {
  if (pct == null || Math.abs(pct) < 5) return null;
  const better = pct > 0 === higherIsBetter;
  return (
    <div className={`small ${better ? 'good-text' : 'bad-text'}`}>
      {pct > 0 ? '+' : ''}
      {Math.round(pct)} % {better ? 'better' : 'worse'}
    </div>
  );
}

/** Each vehicle against the median of its class; productivity ranking; branches compared. */
export function BenchmarkPage() {
  const [range, setRange] = useState(() => lastDays(30));
  const [cls, setCls] = useState('');
  const q = useQuery({ queryKey: ['benchmark', range], queryFn: () => api<Data>(`/analytics/benchmark?from=${range.from}&to=${range.to}`) });
  const d = q.data;
  const classes = d?.classes.filter((c) => c.vehicles >= 2) ?? [];
  const current = cls || classes.sort((a, b) => b.vehicles - a.vehicles)[0]?.vehicleClass || '';
  const med = d?.classes.find((c) => c.vehicleClass === current)?.medians;
  const rows = (d?.vehicles ?? []).filter((v) => v.vehicleClass === current).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const shown = d?.metrics ?? [];
  return (
    <>
      <header className="page-head">
        <h1>Benchmark</h1>
        <div className="actions">
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>
      <div className="toolbar">
        <select value={current} onChange={(e) => setCls(e.target.value)} aria-label="Vehicle class">
          {classes.map((c) => (
            <option key={c.vehicleClass} value={c.vehicleClass}>
              {humanize(c.vehicleClass)} ({c.vehicles} vehicles)
            </option>
          ))}
        </select>
        <span className="muted small">Each vehicle is compared with the median of its class. Score: average percentile of utilisation, km per day, trips per day, availability and cost per km (100 = best in class).</span>
      </div>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Vehicle</th>
                <th>Score</th>
                {shown.map((m) => (
                  <th key={m.key} className="num">
                    {m.label}
                  </th>
                ))}
              </tr>
              {med && (
                <tr className="muted small">
                  <td />
                  <td>Class median</td>
                  <td />
                  {shown.map((m) => (
                    <td key={m.key} className="num">
                      {fmt(m.key, med[m.key])}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.rank ? `${v.rank} / ${v.of}` : '—'}</td>
                  <td>
                    <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>
                    <div className="muted small">{v.branchName ?? '—'}</div>
                  </td>
                  <td>
                    {v.score != null ? (
                      <>
                        <span className="meter" aria-hidden="true">
                          <span style={{ width: `${v.score}%` }} />
                        </span>{' '}
                        {v.score}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  {shown.map((m) => (
                    <td key={m.key} className="num">
                      {fmt(m.key, v.metrics[m.key].value)}
                      <Dev pct={v.metrics[m.key].vsMedianPct} higherIsBetter={m.higherIsBetter} />
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={shown.length + 3} className="muted">
                    {q.isLoading ? 'Loading…' : 'Benchmarks need at least two vehicles of a class.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Branches</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th className="num">Vehicles</th>
              <th>Average score</th>
              {shown
                .filter((m) => m.score)
                .map((m) => (
                  <th key={m.key} className="num">
                    {m.label} vs class
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {d?.branches.map((b) => (
              <tr key={b.branchId ?? 'none'}>
                <td>{b.branchName}</td>
                <td className="num">{b.vehicles}</td>
                <td>
                  {b.score != null ? (
                    <>
                      <span className="meter" aria-hidden="true">
                        <span style={{ width: `${b.score}%` }} />
                      </span>{' '}
                      {b.score}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                {shown
                  .filter((m) => m.score)
                  .map((m) => {
                    const p = b.vsClassPct[m.key];
                    return (
                      <td key={m.key} className="num">
                        {p == null ? '—' : `${p > 0 ? '+' : ''}${Math.round(p)} %`}
                        <Dev pct={p} higherIsBetter={m.higherIsBetter} />
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Branch figures average each vehicle's difference from its own class median, so branches with different class mixes can be compared.</p>
      </section>
    </>
  );
}
