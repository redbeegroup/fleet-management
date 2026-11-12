import { DocumentType, Permission, VEHICLE_STATUS_TRANSITIONS, VehicleStatus } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, session } from '../lib/api';
import { daysUntil, expiryTone, formatDate, humanize } from '../lib/format';
import type { VehicleDetail } from '../lib/types';

export function VehicleDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.VEHICLE_WRITE);
  const [error, setError] = useState<string | null>(null);
  const { data: v, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api<VehicleDetail>(`/vehicles/${id}`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vehicle', id] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  };
  const changeStatus = useMutation({
    mutationFn: (status: VehicleStatus) =>
      api(`/vehicles/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const addDoc = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/vehicles/${id}/documents`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  if (isLoading || !v) return <p className="muted">Loading…</p>;

  function submitDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addDoc.mutate({
      type: f.get('type'),
      number: (f.get('number') as string) || null,
      expiresAt: (f.get('expiresAt') as string) || null,
    });
    e.currentTarget.reset();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {v.plateNumber} <StatusBadge status={v.status} />
          </h1>
          <p className="muted">
            {v.make} {v.model} {v.year ?? ''} · {humanize(v.vehicleClass)} · {v.branch?.name ?? 'No branch'}
          </p>
        </div>
        {canWrite && VEHICLE_STATUS_TRANSITIONS[v.status].length > 0 && (
          <div className="actions">
            {VEHICLE_STATUS_TRANSITIONS[v.status].map((s) => (
              <button key={s} className="btn" onClick={() => changeStatus.mutate(s)}>
                → {humanize(s)}
              </button>
            ))}
          </div>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <section className="grid-2">
        <div className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>VIN</dt>
            <dd>{v.vin ?? '—'}</dd>
            <dt>Ownership</dt>
            <dd>{humanize(v.ownership)}</dd>
            <dt>Fuel</dt>
            <dd>{v.fuelType ?? '—'}</dd>
            <dt>Capacity</dt>
            <dd>{v.capacityKg ? `${Number(v.capacityKg).toLocaleString()} kg` : '—'}</dd>
            <dt>Odometer</dt>
            <dd>{Number(v.odometerKm).toLocaleString()} km</dd>
            <dt>GPS device</dt>
            <dd>{v.gpsDeviceId ?? '—'}</dd>
            <dt>Driver</dt>
            <dd>{v.assignments[0]?.driver?.fullName ?? 'Unassigned'}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Status history</h2>
          {v.statusHistory.length === 0 && <p className="muted">No status changes recorded.</p>}
          <ul className="timeline">
            {v.statusHistory.map((e) => (
              <li key={e.id}>
                <span>{formatDate(e.createdAt)}</span>
                <span>
                  {e.fromStatus ? `${humanize(e.fromStatus)} → ` : ''}
                  <strong>{humanize(e.toStatus)}</strong>
                  {e.reason && <span className="muted"> · {e.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card">
        <h2>Documents</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Number</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {v.documents.map((d) => {
              const days = daysUntil(d.expiresAt);
              return (
                <tr key={d.id}>
                  <td>{humanize(d.type)}</td>
                  <td>{d.number ?? '—'}</td>
                  <td>{formatDate(d.expiresAt)}</td>
                  <td>
                    {days !== null && (
                      <span className={`badge badge-${expiryTone(days)}`}>
                        {days < 0 ? `expired ${-days}d ago` : `${days}d left`}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {session.can(Permission.VEHICLE_DOCUMENT_WRITE) && (
          <form className="inline-form" onSubmit={submitDoc}>
            <select name="type" defaultValue="INSURANCE">
              {Object.values(DocumentType).map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <input name="number" placeholder="Document number" />
            <input name="expiresAt" type="date" aria-label="Expiry date" />
            <button className="btn btn-primary" disabled={addDoc.isPending}>
              Add document
            </button>
          </form>
        )}
      </section>
    </>
  );
}
