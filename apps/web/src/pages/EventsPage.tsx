import { Paginated, TelemetryEventType } from '@fms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { describeEvent, EVENT_LABELS, formatDuration } from '../lib/format';
import type { TelemetryEvent, Vehicle } from '../lib/types';

export function EventsPage() {
  const [type, setType] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (type) params.set('type', type);
  if (vehicleId) params.set('vehicleId', vehicleId);
  const vehicles = useQuery({ queryKey: ['vehicles', 'all'], queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200') });
  const { data, isLoading } = useQuery({
    queryKey: ['events', params.toString()],
    queryFn: () => api<Paginated<TelemetryEvent>>(`/tracking/events?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <header className="page-head">
        <h1>Telematics events</h1>
      </header>
      <div className="toolbar">
        <select value={type} onChange={(e) => (setType(e.target.value), setPage(1))} aria-label="Event type">
          <option value="">All alert types</option>
          {Object.values(TelemetryEventType).map((t) => (
            <option key={t} value={t}>
              {EVENT_LABELS[t]?.label ?? t}
            </option>
          ))}
        </select>
        <select value={vehicleId} onChange={(e) => (setVehicleId(e.target.value), setPage(1))} aria-label="Vehicle">
          <option value="">All vehicles</option>
          {vehicles.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Vehicle</th>
              <th>Event</th>
              <th>Details</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No events.
                </td>
              </tr>
            )}
            {data?.items.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.occurredAt).toLocaleString('en-GB')}</td>
                <td>
                  <Link to={`/vehicles/${e.vehicleId}/track`}>{e.plateNumber}</Link>
                </td>
                <td>
                  <span className={`badge badge-${EVENT_LABELS[e.type]?.tone ?? 'muted'}`}>{EVENT_LABELS[e.type]?.label ?? e.type}</span>
                </td>
                <td>{describeEvent(e)}</td>
                <td>
                  {e.endedAt
                    ? formatDuration(Math.max(1, Math.round((new Date(e.endedAt).getTime() - new Date(e.occurredAt).getTime()) / 60_000)))
                    : ['OVERSPEED', 'IDLE', 'GPS_OFFLINE'].includes(e.type)
                      ? <span className="badge badge-warn">ongoing</span>
                      : '—'}
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
          Page {page} of {pages} · {data?.total ?? 0} events
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  );
}
