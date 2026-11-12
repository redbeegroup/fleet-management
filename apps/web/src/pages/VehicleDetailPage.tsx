import { DocumentType, Paginated, Permission, VEHICLE_STATUS_TRANSITIONS, VehicleStatus } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileLink } from '../components/FileLink';
import { StatusBadge } from '../components/StatusBadge';
import { api, session, uploadFile } from '../lib/api';
import { daysUntil, expiryTone, formatDate, humanize } from '../lib/format';
import type { Driver, HistoryEvent, VehicleDetail } from '../lib/types';

export function VehicleDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.VEHICLE_WRITE);
  const [error, setError] = useState<string | null>(null);
  const { data: v, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api<VehicleDetail>(`/vehicles/${id}`),
  });
  const history = useQuery({
    queryKey: ['vehicle', id, 'history'],
    queryFn: () => api<HistoryEvent[]>(`/vehicles/${id}/history`),
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'active'],
    queryFn: () => api<Paginated<Driver>>('/drivers?active=true&pageSize=200'),
    enabled: canWrite,
  });

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['vehicle', id] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
    void qc.invalidateQueries({ queryKey: ['drivers'] });
  };
  const onError = (e: Error) => setError(e.message);
  const changeStatus = useMutation({
    mutationFn: (status: VehicleStatus) => api(`/vehicles/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: refresh,
    onError,
  });
  const assign = useMutation({
    mutationFn: (driverId: string) => api(`/vehicles/${id}/assignments`, { method: 'POST', body: JSON.stringify({ driverId }) }),
    onSuccess: refresh,
    onError,
  });
  const unassign = useMutation({
    mutationFn: () => api(`/vehicles/${id}/assignments/current`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });
  const addDoc = useMutation({
    mutationFn: async (input: { body: Record<string, unknown>; file: File | null }) => {
      const fileId = input.file ? (await uploadFile(input.file)).id : null;
      return api(`/vehicles/${id}/documents`, { method: 'POST', body: JSON.stringify({ ...input.body, fileId }) });
    },
    onSuccess: refresh,
    onError,
  });
  const removeDoc = useMutation({
    mutationFn: (docId: string) => api(`/vehicles/${id}/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  if (isLoading || !v) return <p className="muted">Loading…</p>;
  const currentDriver = v.assignments.find((a) => a.driver)?.driver;

  function submitDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('file') as File | null;
    addDoc.mutate(
      {
        body: {
          type: f.get('type'),
          number: (f.get('number') as string) || null,
          issuer: (f.get('issuer') as string) || null,
          expiresAt: (f.get('expiresAt') as string) || null,
          amount: f.get('amount') ? Number(f.get('amount')) : null,
        },
        file: file && file.size > 0 ? file : null,
      },
      { onSuccess: () => form.reset() },
    );
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
        {canWrite && (
          <div className="actions">
            <Link className="btn" to={`/vehicles/${v.id}/track`}>
              Trip history
            </Link>
            <Link className="btn" to={`/vehicles/${v.id}/edit`}>
              Edit
            </Link>
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
            <dd>
              {v.capacityKg ? `${Number(v.capacityKg).toLocaleString()} kg` : '—'}
              {v.capacityM3 ? ` · ${Number(v.capacityM3)} m³` : ''}
            </dd>
            <dt>Odometer</dt>
            <dd>{Number(v.odometerKm).toLocaleString()} km</dd>
            <dt>GPS device</dt>
            <dd>{v.gpsDeviceId ?? '—'}</dd>
            <dt>Speed limit</dt>
            <dd>{v.speedLimitKmh ? `${v.speedLimitKmh} km/h` : 'company default'}</dd>
            <dt>Acquired</dt>
            <dd>{formatDate(v.acquiredAt ?? null)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Driver assignment</h2>
          <p>
            {currentDriver ? (
              <>
                Assigned to <Link to={`/drivers/${currentDriver.id}`}>{currentDriver.fullName}</Link>{' '}
                <span className="muted">({currentDriver.employeeNo})</span>
              </>
            ) : (
              <span className="muted">No driver assigned.</span>
            )}
          </p>
          {canWrite && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const driverId = new FormData(e.currentTarget).get('driverId') as string;
                if (driverId) assign.mutate(driverId);
              }}
            >
              <select name="driverId" defaultValue="" aria-label="Driver">
                <option value="" disabled>
                  Select driver…
                </option>
                {drivers.data?.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} ({d.employeeNo}){d.assignments[0] ? ` — has ${d.assignments[0].vehicle.plateNumber}` : ''}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={assign.isPending}>
                {currentDriver ? 'Reassign' : 'Assign'}
              </button>
              {v.assignments.length > 0 && (
                <button type="button" className="btn" onClick={() => unassign.mutate()}>
                  Release
                </button>
              )}
            </form>
          )}
        </div>
      </section>
      <section className="card">
        <h2>Documents</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Number</th>
                <th>Expires</th>
                <th>Status</th>
                <th>File</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {v.documents.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No documents yet.
                  </td>
                </tr>
              )}
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
                    <td>
                      <FileLink file={d.file} />
                    </td>
                    <td className="num">
                      {session.can(Permission.VEHICLE_DOCUMENT_WRITE) && (
                        <button
                          className="link danger"
                          onClick={() => confirm('Delete this document?') && removeDoc.mutate(d.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {session.can(Permission.VEHICLE_DOCUMENT_WRITE) && (
          <form className="inline-form" onSubmit={submitDoc}>
            <select name="type" defaultValue="INSURANCE" aria-label="Document type">
              {Object.values(DocumentType).map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <input name="number" placeholder="Document number" />
            <input name="issuer" placeholder="Issuer" />
            <label className="mini">
              Expires
              <input name="expiresAt" type="date" />
            </label>
            <input name="amount" type="number" min={0} step="any" placeholder="Amount (premium, fee)" />
            <label className="mini">
              Scan (PDF/photo)
              <input name="file" type="file" accept="application/pdf,image/*" />
            </label>
            <button className="btn btn-primary" disabled={addDoc.isPending}>
              {addDoc.isPending ? 'Uploading…' : 'Add document'}
            </button>
          </form>
        )}
      </section>
      <section className="card">
        <h2>History</h2>
        {history.data?.length === 0 && <p className="muted">No history yet.</p>}
        <ul className="timeline">
          {history.data?.map((e) => (
            <li key={`${e.kind}-${e.refId}-${e.at}`}>
              <span>{new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span>
                <span className={`badge badge-${e.kind === 'status' ? 'info' : e.kind === 'document' ? 'muted' : 'ok'}`}>
                  {e.kind}
                </span>{' '}
                {e.summary}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
