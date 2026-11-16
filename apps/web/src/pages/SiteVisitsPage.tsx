import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RangePicker } from '../components/RangePicker';
import { api } from '../lib/api';
import { formatDateTime, humanize, lastDays } from '../lib/format';

interface Stats {
  visits: number;
  avgMin: number | null;
  p90Min: number | null;
  totalMin: number;
}
interface Report {
  totals: { loading: Stats; unloading: Stats; all: Stats };
  sites: ({ key: string; name: string; category: string; kind: string } & Stats)[];
  vehicles: { id: string; name: string; loading: Stats; unloading: Stats }[];
  drivers: { id: string; name: string; loading: Stats; unloading: Stats }[];
  recent: {
    id: string;
    siteName: string;
    category: string;
    kind: string;
    plateNumber: string | null;
    driver: string | null;
    enteredAt: string;
    exitedAt: string;
    durationMin: number;
  }[];
  method: string;
}

const min = (v: number | null) => (v == null ? '—' : `${Math.round(v)} min`);

/** Loading and unloading time measured from GPS (geofence and delivery-stop visits). */
export function SiteVisitsPage() {
  const [range, setRange] = useState(() => lastDays(7));
  const [by, setBy] = useState<'vehicles' | 'drivers'>('vehicles');
  const { data } = useQuery({
    queryKey: ['site-visits', range],
    queryFn: () => api<Report>(`/analytics/site-visits?from=${range.from}&to=${range.to}`),
  });
  const t = data?.totals;
  return (
    <>
      <header className="page-head">
        <h1>Loading & unloading</h1>
        <div className="actions">
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>
      <section className="tiles">
        {[
          ['Loading (depots, warehouses)', t?.loading],
          ['Unloading (customers)', t?.unloading],
        ].map(([label, s]) => (
          <div className="card tile" key={label as string}>
            <span className="tile-label">{label as string}</span>
            <span className="tile-value small">{s ? min((s as Stats).avgMin) : '…'}</span>
            <span className="muted small">
              {s ? `average · p90 ${min((s as Stats).p90Min)} · ${(s as Stats).visits} visits` : ''}
            </span>
          </div>
        ))}
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>By {by === 'vehicles' ? 'vehicle' : 'driver'}</h2>
          <div className="actions">
            <button
              className={by === 'vehicles' ? 'btn btn-primary' : 'btn'}
              onClick={() => setBy('vehicles')}
            >
              Vehicles
            </button>
            <button
              className={by === 'drivers' ? 'btn btn-primary' : 'btn'}
              onClick={() => setBy('drivers')}
            >
              Drivers
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>{by === 'vehicles' ? 'Vehicle' : 'Driver'}</th>
              <th className="num">Loading visits</th>
              <th className="num">Avg loading</th>
              <th className="num">Unloading visits</th>
              <th className="num">Avg unloading</th>
              <th className="num">p90 unloading</th>
            </tr>
          </thead>
          <tbody>
            {data?.[by].length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No visits recorded in this period. Visits come from GPS: geofences around depots
                  and the arrival radius around delivery stops.
                </td>
              </tr>
            )}
            {data?.[by].map((r) => (
              <tr key={r.id}>
                <td>{r.name || '—'}</td>
                <td className="num">{r.loading.visits}</td>
                <td className="num">{min(r.loading.avgMin)}</td>
                <td className="num">{r.unloading.visits}</td>
                <td className="num">{min(r.unloading.avgMin)}</td>
                <td className="num">{min(r.unloading.p90Min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Sites</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Type</th>
              <th className="num">Visits</th>
              <th className="num">Average</th>
              <th className="num">p90</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data?.sites.slice(0, 50).map((s) => (
              <tr key={s.key}>
                <td>{s.name}</td>
                <td>{s.kind === 'STOP' ? 'Delivery stop' : humanize(s.category)}</td>
                <td className="num">{s.visits}</td>
                <td className="num">{min(s.avgMin)}</td>
                <td className="num">{min(s.p90Min)}</td>
                <td className="num">{min(s.totalMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Recent visits</h2>
        </div>
        <table>
          <tbody>
            {data?.recent.slice(0, 30).map((v) => (
              <tr key={v.id}>
                <td>{formatDateTime(v.enteredAt)}</td>
                <td>{v.plateNumber}</td>
                <td>{v.driver ?? '—'}</td>
                <td>{v.siteName}</td>
                <td>{v.kind === 'STOP' ? 'Delivery stop' : humanize(v.category)}</td>
                <td className="num">{min(v.durationMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {data && <p className="muted small">{data.method}</p>}
    </>
  );
}
