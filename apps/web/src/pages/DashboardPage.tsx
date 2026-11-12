import { Paginated, VehicleStatus } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { daysUntil, expiryTone, formatDate, humanize } from '../lib/format';
import type { Vehicle, VehicleDocument } from '../lib/types';

export function DashboardPage() {
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
  const inService = total - count('INACTIVE') - count('DISPOSED');
  const availability = inService ? Math.round(((inService - count('UNDER_REPAIR')) / inService) * 100) : 0;

  const tiles = [
    { label: 'Fleet size', value: total },
    { label: 'Availability', value: `${availability}%` },
    { label: 'Operating', value: count('OPERATING') + count('ASSIGNED') },
    { label: 'Under repair', value: count('UNDER_REPAIR') },
  ];

  return (
    <>
      <header className="page-head">
        <h1>Fleet overview</h1>
      </header>
      <section className="tiles">
        {tiles.map((t) => (
          <div className="card tile" key={t.label}>
            <span className="tile-label">{t.label}</span>
            <span className="tile-value">{vehicles.isLoading ? '…' : t.value}</span>
          </div>
        ))}
      </section>
      <section className="grid-2">
        <div className="card">
          <h2>Status breakdown</h2>
          <ul className="bars">
            {Object.values(VehicleStatus).map((s) => {
              const n = count(s);
              return (
                <li key={s}>
                  <span>{humanize(s)}</span>
                  <span className="bar">
                    <span style={{ width: total ? `${(n / total) * 100}%` : 0 }} />
                  </span>
                  <span className="num">{n}</span>
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
