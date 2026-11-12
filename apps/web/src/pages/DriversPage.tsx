import { Paginated, Permission } from '@fms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { daysUntil, expiryTone, formatDate } from '../lib/format';
import type { Driver } from '../lib/types';

export function DriversPage() {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('true');
  const params = new URLSearchParams({ pageSize: '100' });
  if (search) params.set('search', search);
  if (active) params.set('active', active);
  const { data, isLoading } = useQuery({
    queryKey: ['drivers', params.toString()],
    queryFn: () => api<Paginated<Driver>>(`/drivers?${params}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <header className="page-head">
        <h1>Drivers</h1>
        {session.can(Permission.DRIVER_WRITE) && (
          <Link className="btn btn-primary" to="/drivers/new">
            Add driver
          </Link>
        )}
      </header>
      <div className="toolbar">
        <input placeholder="Search name or employee no." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={active} onChange={(e) => setActive(e.target.value)} aria-label="Status">
          <option value="true">Active</option>
          <option value="false">Inactive</option>
          <option value="">All</option>
        </select>
      </div>
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
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No drivers match.
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
                    <Link to={`/drivers/${d.id}`}>
                      <strong>{d.fullName}</strong>
                    </Link>
                    {!d.active && <span className="badge badge-muted"> inactive</span>}
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
