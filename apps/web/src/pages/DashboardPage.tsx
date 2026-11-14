import { Paginated, Permission, VehicleStatus } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ColumnChart } from '../components/ColumnChart';
import { RangePicker } from '../components/RangePicker';
import { api, session } from '../lib/api';
import {
  daysUntil,
  expiryTone,
  formatDate,
  humanize,
  lastDays,
  money,
  shortDay,
} from '../lib/format';
import type { Overview, Vehicle, VehicleDocument } from '../lib/types';

const n1 = (v: number | null | undefined, suffix = '') =>
  v === null || v === undefined ? '—' : `${v.toLocaleString()}${suffix}`;

/** Staff without fleet access (e.g. requesters) land on their booking requests. */
export function DashboardPage() {
  return session.can(Permission.VEHICLE_READ) ? (
    <FleetDashboard />
  ) : (
    <Navigate to="/vehicle-requests" replace />
  );
}

function FleetDashboard() {
  const canCost = session.can(Permission.COST_READ);
  const [range, setRange] = useState(() => lastDays(30));
  const overview = useQuery({
    queryKey: ['analytics', 'overview', range],
    queryFn: () => api<Overview>(`/analytics/overview?from=${range.from}&to=${range.to}`),
    enabled: canCost,
  });
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
  });
  const expiring = useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: () => api<VehicleDocument[]>('/vehicles/documents/expiring?days=30'),
  });

  const items = vehicles.data?.items ?? [];
  const count = (s: VehicleStatus) => items.filter((v) => v.status === s).length;
  const total = vehicles.data?.total ?? 0;
  const f = overview.data?.fleet;
  const cur = overview.data?.range.currency ?? '';

  return (
    <>
      <header className="page-head">
        <h1>Fleet overview</h1>
        {canCost && <RangePicker value={range} onChange={setRange} />}
      </header>

      {canCost && (
        <>
          <section className="tiles">
            <div className="card tile hero">
              <span className="tile-label">Cost per km</span>
              <span className="tile-value">{f?.costPerKm != null ? money(f.costPerKm) : '—'}</span>
              <span className="kpi-sub">
                {cur} · total {f ? money(f.totalCost) : '…'} over {f ? money(f.distanceKm) : '…'} km
              </span>
            </div>
            {[
              ['Utilization', n1(f?.utilizationPct, '%'), 'vehicle-days with ≥ 1 km'],
              ['Availability', n1(f?.availabilityPct, '%'), `downtime ${n1(f?.downtimePct, '%')}`],
              [
                'Fuel efficiency',
                f?.fuelKmPerLitre != null ? `${f.fuelKmPerLitre} km/L` : '—',
                `fuel ${f ? money(f.fuelCost) : '…'} ${cur}`,
              ],
              [
                'Maintenance / km',
                n1(f?.maintenanceCostPerKm),
                `${f ? money(f.maintenanceCost) : '…'} ${cur}`,
              ],
              [
                'Trips',
                f ? money(f.tripsCompleted) : '…',
                `${n1(f?.tripsPerVehiclePerDay)} per vehicle-day`,
              ],
              ['Idle time', n1(f?.idlePct, '%'), `of ${n1(f?.engineHours)} engine hours`],
              [
                'Overspeed',
                n1(f?.overspeedPer100Km),
                `per 100 km · ${f?.overspeedEvents ?? '…'} events`,
              ],
            ].map(([label, value, sub]) => (
              <div className="card tile" key={label}>
                <span className="tile-label">{label}</span>
                <span className="tile-value small">{overview.isLoading ? '…' : value}</span>
                <span className="kpi-sub">{sub}</span>
              </div>
            ))}
          </section>

          {overview.data && (
            <section className="grid-2">
              <div className="card">
                <ColumnChart
                  title="Distance per day (km)"
                  data={overview.data.series.map((d) => ({
                    label: d.day,
                    values: { km: d.distanceKm },
                  }))}
                  series={[{ key: 'km', label: 'Distance', color: 'var(--series-1)' }]}
                  format={(v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`}
                  formatX={shortDay}
                />
              </div>
              <div className="card">
                <ColumnChart
                  title={`Operating cost per day (${cur})`}
                  data={overview.data.series.map((d) => ({
                    label: d.day,
                    values: {
                      fuel: d.fuelCost,
                      maintenance: d.maintenanceCost,
                      other: d.otherCost,
                    },
                  }))}
                  series={[
                    { key: 'fuel', label: 'Fuel', color: 'var(--series-1)' },
                    { key: 'maintenance', label: 'Maintenance', color: 'var(--series-2)' },
                    { key: 'other', label: 'Other', color: 'var(--series-3)' },
                  ]}
                  format={money}
                  formatX={shortDay}
                />
              </div>
            </section>
          )}

          {overview.data && (
            <section className="card table-card">
              <div className="card-head">
                <h2>Highest cost per km</h2>
                <Link to="/reports">Full report →</Link>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th className="num">Distance (km)</th>
                    <th className="num">Total cost</th>
                    <th className="num">Cost / km</th>
                    <th className="num">km/L</th>
                    <th>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {[...overview.data.vehicles]
                    .filter((v) => v.costPerKm !== null)
                    .sort((a, b) => (b.costPerKm ?? 0) - (a.costPerKm ?? 0))
                    .slice(0, 5)
                    .map((v) => (
                      <tr key={v.id}>
                        <td>
                          <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>
                        </td>
                        <td className="num">{money(v.distanceKm)}</td>
                        <td className="num">{money(v.totalCost)}</td>
                        <td className="num">
                          <strong>{money(v.costPerKm)}</strong>
                        </td>
                        <td className="num">{v.fuelKmPerLitre ?? '—'}</td>
                        <td>
                          <span className="meter" title={`${v.utilizationPct ?? 0}%`}>
                            <span style={{ width: `${v.utilizationPct ?? 0}%` }} />
                          </span>{' '}
                          <span className="muted">{v.utilizationPct ?? 0}%</span>
                        </td>
                      </tr>
                    ))}
                  {!overview.data.vehicles.some((v) => v.costPerKm !== null) && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No distance recorded in this period yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <section className="grid-2">
        <div className="card">
          <h2>
            Fleet status <span className="muted">· {total} vehicles</span>
          </h2>
          <ul className="bars">
            {Object.values(VehicleStatus).map((s) => {
              const c = count(s);
              return (
                <li key={s}>
                  <span>{humanize(s)}</span>
                  <span className="bar">
                    <span style={{ width: total ? `${(c / total) * 100}%` : 0 }} />
                  </span>
                  <span className="num">{c}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <h2>Documents expiring in 30 days</h2>
          {expiring.data?.length === 0 && <p className="muted">Nothing expiring soon.</p>}
          <table>
            <tbody>
              {expiring.data?.map((d) => {
                const days = daysUntil(d.expiresAt);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/vehicles/${d.vehicle?.id}`}>{d.vehicle?.plateNumber}</Link>
                    </td>
                    <td>{humanize(d.type)}</td>
                    <td>{formatDate(d.expiresAt)}</td>
                    <td>
                      <span className={`badge badge-${expiryTone(days)}`}>
                        {days !== null && days < 0 ? `${-days}d overdue` : `${days}d`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
