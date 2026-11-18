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
            <dt>Trailer</dt>
            <dd>
              <TripTrailer trip={t} canWrite={canWrite} onError={setError} />
            </dd>
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
      {t.status === 'COMPLETED' && session.can(Permission.COST_READ) && <TripRevenue tripId={t.id} />}
    </>
  );
}

interface TrailerRow {
  id: string;
  plateNumber: string;
  status: string;
  capacityKg: number | null;
  trips: { id: string; tripNo: string }[];
}

/** The trailer pulled on the trip; changeable while the trip is planned or assigned. */
function TripTrailer({ trip, canWrite, onError }: { trip: Trip; canWrite: boolean; onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const trailers = useQuery({ queryKey: ['trailers'], queryFn: () => api<TrailerRow[]>('/trailers') });
  const set = useMutation({
    mutationFn: (trailerId: string | null) => api(`/trips/${trip.id}/trailer`, { method: 'PATCH', body: JSON.stringify({ trailerId }) }),
    onSuccess: () => (onError(null), void qc.invalidateQueries({ queryKey: ['trip', trip.id] }), void qc.invalidateQueries({ queryKey: ['trailers'] })),
    onError: (e) => onError(e instanceof ApiError ? ((e.body as { message?: string }).message ?? e.message) : e.message),
  });
  const current = trailers.data?.find((x) => x.id === trip.trailerId);
  const editable = canWrite && (trip.status === 'PLANNED' || trip.status === 'ASSIGNED');
  if (!editable) return current ? <Link to={`/vehicles/${current.id}`}>{current.plateNumber}</Link> : <span className="muted">none</span>;
  if (!trailers.data?.length && !trip.trailerId) return <span className="muted">none (no trailers registered)</span>;
  return (
    <select aria-label="Trailer" value={trip.trailerId ?? ''} disabled={set.isPending} onChange={(e) => set.mutate(e.target.value || null)}>
      <option value="">No trailer</option>
      {trailers.data?.map((x) => {
        const busy = x.trips.some((b) => b.id !== trip.id);
        return (
          <option key={x.id} value={x.id}>
            {x.plateNumber}
            {x.capacityKg ? ` · ${x.capacityKg.toLocaleString()} kg` : ''}
            {busy ? ` · booked on ${x.trips.find((b) => b.id !== trip.id)?.tripNo}` : ''}
          </option>
        );
      })}
    </select>
  );
}

interface RevenueRow {
  id: string;
  customerName: string | null;
  rateCardName: string | null;
  amount: string;
  source: string;
  basis: { km: number; kg: number; drops: number; waitMinutes: number; share: number };
  breakdown: Record<string, number>;
}

/** Rate-card revenue of a completed trip, per customer (S19). */
export function TripRevenue({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trip-revenue', tripId], queryFn: () => api<{ total: number; billed: number | null; rows: RevenueRow[] }>(`/trips/${tripId}/revenue`) });
  const recompute = useMutation({ mutationFn: () => api(`/trips/${tripId}/revenue/recompute`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['trip-revenue', tripId] }) });
  const d = q.data;
  if (!d) return null;
  const fmt = (n: number | string) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <section className="card">
      <div className="card-head">
        <h2>Revenue</h2>
        <span>
          <strong>{fmt(d.total)}</strong>
          {d.billed != null && <span className="muted small"> · billed in SAP {fmt(d.billed)}</span>}
        </span>
      </div>
      {d.rows.length === 0 ? (
        <p className="muted">Not rated yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Rate card</th>
              <th>Basis</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.customerName ?? '—'}</td>
                <td>{r.rateCardName ?? <span className="badge badge-warn">no rate card applies</span>}</td>
                <td className="small muted">
                  {[`${r.basis.km} km`, r.basis.kg ? `${r.basis.kg.toLocaleString()} kg` : null, r.basis.drops ? `${r.basis.drops} drop(s)` : null, r.basis.waitMinutes ? `${r.basis.waitMinutes} min waiting` : null, r.basis.share < 1 ? `${Math.round(r.basis.share * 100)} % of the trip` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
                <td className="num">{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {session.can(Permission.RATE_CARD_WRITE) && (
        <button className="btn btn-ghost" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
          Re-rate with current cards
        </button>
      )}
    </section>
  );
}
