import { Paginated } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { daysUntil, expiryTone, formatDate } from '../lib/format';
import type { Driver } from '../lib/types';

export function DriversPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api<Paginated<Driver>>('/drivers?pageSize=100'),
  });
  return (
    <>
      <header className="page-head">
        <h1>Drivers</h1>
      </header>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Employee no.</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Licence</th>
              <th>Licence expiry</th>
              <th>Vehicle</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.map((d) => {
              const lic = d.licenses[0];
              const days = daysUntil(lic?.expiresAt ?? null);
              return (
                <tr key={d.id}>
                  <td>{d.employeeNo}</td>
                  <td>
                    <strong>{d.fullName}</strong>
                  </td>
                  <td>{d.phone ?? '—'}</td>
                  <td>{lic ? `${lic.number} (${lic.licenseClass})` : '—'}</td>
                  <td>
                    {formatDate(lic?.expiresAt ?? null)}{' '}
                    {days !== null && days <= 30 && (
                      <span className={`badge badge-${expiryTone(days)}`}>{days < 0 ? 'expired' : `${days}d`}</span>
                    )}
                  </td>
                  <td>
                    {d.assignments[0] ? (
                      <Link to={`/vehicles/${d.assignments[0].vehicle.id}`}>{d.assignments[0].vehicle.plateNumber}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
