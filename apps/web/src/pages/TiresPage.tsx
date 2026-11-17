import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';

interface Fleet {
  settings: { minTreadMm: number; pressureUnit: string; expectedLifeKm: number };
  totals: { vehicles: number; critical: number; warn: number; notCheckedIn30Days: number; cost12m: number };
  attention: {
    vehicle: { id: string; plateNumber: string };
    position: string;
    level: 'warn' | 'critical';
    treadMm: number | null;
    treadStatus: string;
    pressure: number | null;
    pressureStatus: string;
    kmSinceFit: number | null;
    overLife: boolean;
    lastCheckAt: string | null;
  }[];
  brands: { brand: string; size: string | null; tires: number; avgKm: number; costPerKm: number | null }[];
  vehicles: { vehicle: { id: string; plateNumber: string; vehicleClass: string }; critical: number; warn: number; fitted: number; positions: number; cost: number }[];
}

/** Fleet tires: positions needing attention, tire life and cost per km by brand. */
export function TiresPage() {
  const { data } = useQuery({ queryKey: ['tires-fleet'], queryFn: () => api<Fleet>('/tires') });
  const t = data?.totals;
  const why = (a: Fleet['attention'][number]) =>
    [
      a.treadStatus === 'REPLACE' && `tread ${a.treadMm} mm (min ${data!.settings.minTreadMm})`,
      a.treadStatus === 'WARN' && `tread ${a.treadMm} mm`,
      a.pressureStatus === 'LOW' && `pressure low (${a.pressure} ${data!.settings.pressureUnit})`,
      a.pressureStatus === 'HIGH' && `pressure high (${a.pressure} ${data!.settings.pressureUnit})`,
      a.overLife && `${a.kmSinceFit?.toLocaleString()} km, beyond expected life`,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      <header className="page-head">
        <h1>Tires</h1>
      </header>
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Act now</span>
          <span className="tile-value small">{t?.critical ?? '…'}</span>
          <span className="muted small">positions below minimum tread or under-inflated</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Watch</span>
          <span className="tile-value small">{t?.warn ?? '…'}</span>
          <span className="muted small">near the minimum, over-inflated or beyond expected life</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Not checked in 30 days</span>
          <span className="tile-value small">{t ? `${t.notCheckedIn30Days} of ${t.vehicles}` : '…'}</span>
          <span className="muted small">vehicles</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Tire spend</span>
          <span className="tile-value small">{t ? money(t.cost12m) : '…'}</span>
          <span className="muted small">all recorded tire changes</span>
        </div>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Positions needing attention</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Position</th>
              <th>Status</th>
              <th>Why</th>
              <th>Last check</th>
            </tr>
          </thead>
          <tbody>
            {data?.attention.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing to do. Record tread and pressure on the vehicle page or with a tire inspection checklist in the driver app.
                </td>
              </tr>
            )}
            {data?.attention.map((a) => (
              <tr key={`${a.vehicle.id}${a.position}`}>
                <td>
                  <Link to={`/vehicles/${a.vehicle.id}`}>{a.vehicle.plateNumber}</Link>
                </td>
                <td>{a.position}</td>
                <td>
                  <span className={`badge badge-${a.level === 'critical' ? 'danger' : 'warn'}`}>{a.level === 'critical' ? 'Act now' : 'Watch'}</span>
                </td>
                <td>{why(a)}</td>
                <td>{formatDate(a.lastCheckAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Tire life by brand and size</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Size</th>
              <th className="num">Tires taken off</th>
              <th className="num">Average km</th>
              <th className="num">Cost per km</th>
            </tr>
          </thead>
          <tbody>
            {data?.brands.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Appears once replaced tires have a recorded fitting (km and cost).
                </td>
              </tr>
            )}
            {data?.brands.map((b) => (
              <tr key={`${b.brand}${b.size}`}>
                <td>{b.brand}</td>
                <td>{b.size ?? '—'}</td>
                <td className="num">{b.tires}</td>
                <td className="num">{b.avgKm.toLocaleString()}</td>
                <td className="num">{b.costPerKm ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Vehicles</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Class</th>
              <th className="num">Positions recorded</th>
              <th className="num">Act now / watch</th>
              <th className="num">Tire spend</th>
            </tr>
          </thead>
          <tbody>
            {data?.vehicles.map((v) => (
              <tr key={v.vehicle.id}>
                <td>
                  <Link to={`/vehicles/${v.vehicle.id}`}>{v.vehicle.plateNumber}</Link>
                </td>
                <td>{humanize(v.vehicle.vehicleClass)}</td>
                <td className="num">
                  {v.fitted} / {v.positions}
                </td>
                <td className="num">
                  {v.critical} / {v.warn}
                </td>
                <td className="num">{money(v.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
