import { Paginated, Permission, VehicleStatus } from '@fms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, session } from '../lib/api';
import { humanize } from '../lib/format';
import type { Vehicle } from '../lib/types';

export function VehiclesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', params.toString()],
    queryFn: () => api<Paginated<Vehicle>>(`/vehicles?${params}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <header className="page-head">
        <h1>Vehicles</h1>
        {session.can(Permission.VEHICLE_WRITE) && (
          <Link className="btn btn-primary" to="/vehicles/new">
            Register vehicle
          </Link>
        )}
      </header>
      <div className="toolbar">
        <input
          placeholder="Search plate, make, model, VIN"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {Object.values(VehicleStatus).map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Vehicle</th>
              <th>Class</th>
              <th>Branch</th>
              <th className="num">Odometer (km)</th>
              <th>GPS device</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link to={`/vehicles/${v.id}`}>
                    <strong>{v.plateNumber}</strong>
                  </Link>
                </td>
                <td>
                  {v.make} {v.model} {v.year && <span className="muted">({v.year})</span>}
                </td>
                <td>{humanize(v.vehicleClass)}</td>
                <td>{v.branch?.name ?? '—'}</td>
                <td className="num">{Number(v.odometerKm).toLocaleString()}</td>
                <td>{v.gpsDeviceId ?? <span className="muted">none</span>}</td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No vehicles match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages} · {data?.total ?? 0} vehicles
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  );
}
