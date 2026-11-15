import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ColumnChart } from '../components/ColumnChart';
import { RangePicker } from '../components/RangePicker';
import { accessToken, api } from '../lib/api';
import { formatDateTime, lastDays, money, shortDay } from '../lib/format';
import type { DeliveryKpis, PodException } from '../lib/types';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const FLAG: Record<string, string> = {
  FAR_FROM_CUSTOMER: 'far from customer',
  NO_GPS: 'no GPS',
  COD_SHORT: 'cash short',
  COD_OVER: 'cash over',
  RECORDED_BY_DISPATCH: 'entered by dispatch',
};

export function DeliveryKpisPage() {
  const [range, setRange] = useState(() => lastDays(30));
  const [error, setError] = useState<string | null>(null);
  const { data: k } = useQuery({
    queryKey: ['delivery-kpis', range],
    queryFn: () => api<DeliveryKpis>(`/analytics/delivery?from=${range.from}&to=${range.to}`),
  });
  const exc = useQuery({
    queryKey: ['pod-exceptions', range],
    queryFn: () =>
      api<PodException[]>(`/logistics/pod-exceptions?from=${range.from}&to=${range.to}`),
  });
  const t = k?.totals;
  const cur = k?.range.currency ?? '';

  async function csv() {
    const res = await fetch(`/api/analytics/delivery.csv?from=${range.from}&to=${range.to}`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    if (!res.ok) return setError(`Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-kpis_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tiles: [string, string, string][] = t
    ? [
        ['OTIF', pct(t.otifPct), `${t.otif} of ${t.attempted} orders on time & in full`],
        [
          'Delivery success',
          pct(t.successRatePct),
          `${t.delivered} delivered · ${t.partial} partial · ${t.failed} failed`,
        ],
        [
          'Cost per drop',
          t.costPerDrop != null ? `${money(t.costPerDrop)} ${cur}` : '—',
          `${money(t.cost)} ${cur} over ${t.drops} drops (estimate)`,
        ],
        ['Vehicle fill rate', pct(t.fillPct), 'binding capacity limit, average per trip'],
        [
          'Stop order followed',
          pct(t.sequencePct),
          `ETA error ${t.avgEtaErrorMin ?? '—'} min · dwell ${t.avgDwellMin ?? '—'} min`,
        ],
        ['Distance', `${t.actualKm || '—'} km`, `planned ${t.plannedKm} km`],
      ]
    : [];

  return (
    <>
      <header className="page-head">
        <h1>Delivery KPIs</h1>
        <div className="actions">
          <RangePicker value={range} onChange={setRange} />
          <button className="btn" onClick={csv}>
            CSV
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="tiles">
        {tiles.map(([label, value, hint]) => (
          <div className="card tile" key={label}>
            <span className="tile-label">{label}</span>
            <span className="tile-value small">{value}</span>
            <span className="muted small">{hint}</span>
          </div>
        ))}
      </section>
      {k && k.series.length > 0 && (
        <section className="card">
          <ColumnChart
            title="Orders per day by outcome"
            data={k.series.map((d) => ({
              label: d.day,
              values: { delivered: d.delivered, partial: d.partial, failed: d.failed },
            }))}
            series={[
              { key: 'delivered', label: 'Delivered', color: 'var(--ok)' },
              { key: 'partial', label: 'Partial', color: 'var(--warn)' },
              { key: 'failed', label: 'Failed', color: 'var(--danger)' },
            ]}
            formatX={shortDay}
          />
        </section>
      )}
      {k && (
        <p className="muted small">
          OTIF: {k.method.otif}. Cost: {k.method.cost}.
        </p>
      )}
      <div className="grid-2">
        {(['drivers', 'vehicles'] as const).map((key) => (
          <section key={key} className="card table-card">
            <div className="card-head">
              <h2>By {key === 'drivers' ? 'driver' : 'vehicle'}</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{key === 'drivers' ? 'Driver' : 'Vehicle'}</th>
                  <th className="num">Trips</th>
                  <th className="num">OTIF</th>
                  <th className="num">Success</th>
                  <th className="num">Fill</th>
                  <th className="num">Order kept</th>
                  <th className="num">Cost / drop</th>
                </tr>
              </thead>
              <tbody>
                {k?.[key].length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No delivery trips in this period.
                    </td>
                  </tr>
                )}
                {k?.[key].map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="num">{r.trips}</td>
                    <td className="num">{pct(r.otifPct)}</td>
                    <td className="num">{pct(r.successRatePct)}</td>
                    <td className="num">{pct(r.fillPct)}</td>
                    <td className="num">{pct(r.sequencePct)}</td>
                    <td className="num">{r.costPerDrop != null ? money(r.costPerDrop) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {t && Object.keys(t.failureReasons).length > 0 && (
        <section className="card">
          <h2>Why deliveries failed</h2>
          <ul className="bar-list">
            {Object.entries(t.failureReasons)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, n]) => (
                <li key={reason}>
                  <span>{reason}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill over"
                      style={{
                        width: `${(n / Math.max(...Object.values(t.failureReasons))) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="num">{n}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
      <section className="card table-card">
        <div className="card-head">
          <h2>Proof-of-delivery exceptions</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Load</th>
              <th>Stop</th>
              <th>Driver</th>
              <th>Flags</th>
              <th className="num">Distance</th>
              <th className="num">Cash</th>
            </tr>
          </thead>
          <tbody>
            {exc.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No exceptions.
                </td>
              </tr>
            )}
            {exc.data?.map((e) => (
              <tr key={e.id}>
                <td>{e.completedAt ? formatDateTime(e.completedAt) : '—'}</td>
                <td>
                  <Link to={`/loads/${e.trip.id}`}>{e.trip.tripNo}</Link>{' '}
                  <span className="muted">{e.trip.vehicle?.plateNumber}</span>
                </td>
                <td>{e.name}</td>
                <td>{e.trip.driver?.fullName ?? '—'}</td>
                <td>
                  {e.podFlags.map((f) => (
                    <span
                      key={f}
                      className={`badge badge-${f === 'RECORDED_BY_DISPATCH' || f === 'NO_GPS' ? 'muted' : 'danger'}`}
                    >
                      {FLAG[f] ?? f}
                    </span>
                  ))}
                </td>
                <td className="num">{e.podDistanceM != null ? `${e.podDistanceM} m` : '—'}</td>
                <td className="num">
                  {e.codExpected ? `${money(e.codCollected ?? 0)} / ${money(e.codExpected)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
