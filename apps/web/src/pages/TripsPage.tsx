import { Paginated, Permission, TripStatus } from '@fms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDateTime, humanize, TRIP_TONE } from '../lib/format';
import type { Trip } from '../lib/types';

export function TripsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const { data, isLoading } = useQuery({
    queryKey: ['trips', 'list', params.toString()],
    queryFn: () => api<Paginated<Trip>>(`/trips?${params}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <header className="page-head">
        <h1>Trips</h1>
        {session.can(Permission.TRIP_WRITE) && (
          <Link className="btn btn-primary" to="/trips/new">
            New trip
          </Link>
        )}
      </header>
      <div className="toolbar">
        <input placeholder="Search trip no., origin, destination" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">All statuses</option>
          {Object.values(TripStatus).map((s) => (
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
              <th>Trip</th>
              <th>Route</th>
              <th>Planned</th>
              <th>Vehicle</th>
              <th>Driver</th>
              <th className="num">Distance</th>
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
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No trips.
                </td>
              </tr>
            )}
            {data?.items.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/trips/${t.id}`}>
                    <strong>{t.tripNo}</strong>
                  </Link>
                </td>
                <td>
                  {t.originName} → {t.destinationName}
                </td>
                <td>{formatDateTime(t.plannedStart)}</td>
                <td>{t.vehicle?.plateNumber ?? <span className="muted">—</span>}</td>
                <td>{t.driver?.fullName ?? <span className="muted">—</span>}</td>
                <td className="num">{t.gpsDistanceKm ? `${Number(t.gpsDistanceKm)} km` : '—'}</td>
                <td>
                  <span className={`badge badge-${TRIP_TONE[t.status]}`}>{humanize(t.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages} · {data?.total ?? 0} trips
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  );
}
