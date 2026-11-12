import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AssignmentPicker } from '../components/AssignmentPicker';
import { api, ApiError, session } from '../lib/api';
import { formatDateTime, formatDuration, humanize, TRIP_TONE } from '../lib/format';
import type { Trip } from '../lib/types';

export function TripDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.TRIP_WRITE);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState({ vehicleId: '', driverId: '' });
  const [panel, setPanel] = useState<'none' | 'assign' | 'start' | 'complete' | 'cancel'>('none');
  const { data: t } = useQuery({ queryKey: ['trip', id], queryFn: () => api<Trip>(`/trips/${id}`) });

  const act = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      api<Trip>(`/trips/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      setError(null);
      setPanel('none');
      void qc.invalidateQueries({ queryKey: ['trip', id] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e) => {
      const b = e instanceof ApiError ? (e.body as { reasons?: string[] }) : {};
      setError(b.reasons?.join('; ') ?? e.message);
    },
  });

  if (!t) return <p className="muted">Loading…</p>;
  const minutes = t.actualStart && t.actualEnd ? Math.round((new Date(t.actualEnd).getTime() - new Date(t.actualStart).getTime()) / 60_000) : null;
  const odoDistance = t.startOdometerKm && t.endOdometerKm ? Number(t.endOdometerKm) - Number(t.startOdometerKm) : null;
  const can = (s: string[]) => canWrite && s.includes(t.status);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {t.tripNo} <span className={`badge badge-${TRIP_TONE[t.status]}`}>{humanize(t.status)}</span>
          </h1>
          <p className="muted">
            {t.originName} → {t.destinationName}
          </p>
        </div>
        <div className="actions">
          {can(['PLANNED', 'ASSIGNED']) && (
            <button className="btn" onClick={() => setPanel('assign')}>
              {t.status === 'ASSIGNED' ? 'Reassign' : 'Assign'}
            </button>
          )}
          {can(['ASSIGNED']) && (
            <>
              <button className="btn" onClick={() => act.mutate({ path: '/assign', method: 'DELETE' })}>
                Unassign
              </button>
              <button className="btn btn-primary" onClick={() => setPanel('start')}>
                Start trip
              </button>
            </>
          )}
          {can(['ONGOING']) && (
            <button className="btn btn-primary" onClick={() => setPanel('complete')}>
              Complete trip
            </button>
          )}
          {can(['PLANNED', 'ASSIGNED']) && (
            <button className="btn" onClick={() => setPanel('cancel')}>
              Cancel trip
            </button>
          )}
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {panel === 'assign' && (
        <form
          className="card form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({ path: '/assign', body: pick });
          }}
        >
          <AssignmentPicker
            from={t.plannedStart}
            to={t.plannedEnd}
            excludeTripId={t.id}
            vehicleId={pick.vehicleId}
            driverId={pick.driverId}
            onChange={setPick}
          />
          <div className="span-2 actions">
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              Close
            </button>
            <button className="btn btn-primary" disabled={!pick.vehicleId || !pick.driverId || act.isPending}>
              Assign
            </button>
          </div>
        </form>
      )}
      {(panel === 'start' || panel === 'complete') && (
        <form
          className="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const odo = new FormData(e.currentTarget).get('odometerKm') as string;
            const notes = new FormData(e.currentTarget).get('notes') as string;
            act.mutate({ path: `/${panel}`, body: { ...(odo && { odometerKm: Number(odo) }), ...(notes && { notes }) } });
          }}
        >
          <label className="mini">
            {panel === 'start' ? 'Start' : 'End'} odometer (km, optional)
            <input name="odometerKm" type="number" min={0} step="any" placeholder={panel === 'complete' ? 'from GPS if empty' : 'vehicle odometer if empty'} />
          </label>
          {panel === 'complete' && <input name="notes" placeholder="Completion notes" />}
          <button className="btn btn-primary" disabled={act.isPending}>
            Confirm {panel}
          </button>
          <button type="button" className="btn" onClick={() => setPanel('none')}>
            Close
          </button>
        </form>
      )}
      {panel === 'cancel' && (
        <form
          className="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({ path: '/cancel', body: { reason: new FormData(e.currentTarget).get('reason') } });
          }}
        >
          <input name="reason" required minLength={3} placeholder="Reason for cancelling" size={40} />
          <button className="btn btn-primary">Cancel trip</button>
          <button type="button" className="btn" onClick={() => setPanel('none')}>
            Close
          </button>
        </form>
      )}

      <section className="grid-2">
        <div className="card">
          <h2>Plan</h2>
          <dl className="facts">
            <dt>Departure</dt>
            <dd>{formatDateTime(t.plannedStart)}</dd>
            <dt>Arrival</dt>
            <dd>{formatDateTime(t.plannedEnd)}</dd>
            <dt>Vehicle</dt>
            <dd>{t.vehicle ? <Link to={`/vehicles/${t.vehicle.id}`}>{t.vehicle.plateNumber}</Link> : <span className="muted">not assigned</span>}</dd>
            <dt>Driver</dt>
            <dd>
              {t.driver ? (
                <Link to={`/drivers/${t.driver.id}`}>
                  {t.driver.fullName} ({t.driver.employeeNo})
                </Link>
              ) : (
                <span className="muted">not assigned</span>
              )}
            </dd>
            <dt>Purpose</dt>
            <dd>{t.purpose ?? '—'}</dd>
            <dt>Cargo</dt>
            <dd>
              {t.cargoDescription ?? '—'}
              {t.cargoWeightKg ? ` · ${Number(t.cargoWeightKg).toLocaleString()} kg` : ''}
            </dd>
            {t.cancelReason && (
              <>
                <dt>Cancelled</dt>
                <dd>{t.cancelReason}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="card">
          <h2>Actuals</h2>
          <dl className="facts">
            <dt>Departed</dt>
            <dd>{formatDateTime(t.actualStart)}</dd>
            <dt>Arrived</dt>
            <dd>{formatDateTime(t.actualEnd)}</dd>
            <dt>Duration</dt>
            <dd>{minutes !== null ? formatDuration(minutes) : '—'}</dd>
            <dt>GPS distance</dt>
            <dd>{t.gpsDistanceKm ? `${Number(t.gpsDistanceKm)} km` : '—'}</dd>
            <dt>Odometer</dt>
            <dd>
              {t.startOdometerKm ? Number(t.startOdometerKm).toLocaleString() : '—'} → {t.endOdometerKm ? Number(t.endOdometerKm).toLocaleString() : '—'}
              {odoDistance !== null ? ` (${odoDistance.toFixed(1)} km)` : ''}
            </dd>
          </dl>
          {t.vehicle && t.actualStart && (
            <p>
              <Link to={`/vehicles/${t.vehicle.id}/track`}>View GPS track →</Link>
            </p>
          )}
        </div>
      </section>
      <section className="card">
        <h2>Status history</h2>
        <ul className="timeline">
          {t.statusHistory?.map((e) => (
            <li key={e.id}>
              <span>{formatDateTime(e.createdAt)}</span>
              <span>
                <span className={`badge badge-${TRIP_TONE[e.toStatus]}`}>{humanize(e.toStatus)}</span> {e.note}
              </span>
            </li>
          ))}
        </ul>
        {t.notes && (
          <>
            <h2>Notes</h2>
            <p className="pre">{t.notes}</p>
          </>
        )}
      </section>
    </>
  );
}
