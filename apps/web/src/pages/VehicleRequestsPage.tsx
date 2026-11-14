import { Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDateTime, humanize, toLocalInput, VR_TONE } from '../lib/format';
import type { Driver, Vehicle, VehicleRequest } from '../lib/types';
import { errorText } from './IncidentsPage';

const CLASSES = ['', 'CAR', 'VAN', 'PICKUP', 'TRUCK', 'BUS'];

export function VehicleRequestsPage() {
  const qc = useQueryClient();
  const canSeeAll = session.can(Permission.VEHICLE_REQUEST_READ);
  const canSchedule = session.can(Permission.TRIP_WRITE);
  const me = session.user()?.id;
  const [showForm, setShowForm] = useState(false);
  const [mine, setMine] = useState(!canSeeAll);
  const [scheduling, setScheduling] = useState<VehicleRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['vehicle-requests', mine],
    queryFn: () => api<Paginated<VehicleRequest>>(`/vehicle-requests?pageSize=100&mine=${mine}`),
  });
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['vehicle-requests'] });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/vehicle-requests', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShowForm(false);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/vehicle-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      purpose: f.get('purpose'),
      originName: f.get('originName'),
      destinationName: f.get('destinationName'),
      plannedStart: new Date(f.get('plannedStart') as string).toISOString(),
      plannedEnd: new Date(f.get('plannedEnd') as string).toISOString(),
      passengers: f.get('passengers') ? Number(f.get('passengers')) : null,
      cargoDescription: (f.get('cargoDescription') as string) || null,
      preferredClass: (f.get('preferredClass') as string) || null,
      notes: (f.get('notes') as string) || null,
    });
  }

  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(9, 0, 0, 0);
  return (
    <>
      <header className="page-head">
        <h1>Vehicle booking requests</h1>
        <div className="actions">
          {canSeeAll && (
            <>
              <button
                className={`btn ${!mine ? 'btn-primary' : ''}`}
                onClick={() => setMine(false)}
              >
                All requests
              </button>
              <button className={`btn ${mine ? 'btn-primary' : ''}`} onClick={() => setMine(true)}>
                Mine
              </button>
            </>
          )}
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Request a vehicle'}
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {showForm && (
        <form className="card form-grid" onSubmit={submit}>
          <label className="span-all">
            Purpose
            <input
              name="purpose"
              required
              minLength={3}
              placeholder="e.g. Client visit, airport pick-up, goods transfer"
            />
          </label>
          <label>
            From
            <input name="originName" required />
          </label>
          <label>
            To
            <input name="destinationName" required />
          </label>
          <label>
            Start
            <input
              name="plannedStart"
              type="datetime-local"
              required
              defaultValue={toLocalInput(tomorrow)}
            />
          </label>
          <label>
            Return by
            <input
              name="plannedEnd"
              type="datetime-local"
              required
              defaultValue={toLocalInput(new Date(tomorrow.getTime() + 4 * 3_600_000))}
            />
          </label>
          <label>
            Passengers
            <input name="passengers" type="number" min={0} max={100} />
          </label>
          <label>
            Preferred vehicle
            <select name="preferredClass">
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c ? humanize(c) : 'Any'}
                </option>
              ))}
            </select>
          </label>
          <label className="span-all">
            Cargo
            <input name="cargoDescription" />
          </label>
          <label className="span-all">
            Notes
            <textarea name="notes" rows={2} />
          </label>
          <div>
            <button className="btn btn-primary" disabled={create.isPending}>
              Send request
            </button>
          </div>
        </form>
      )}
      {scheduling && (
        <ScheduleForm
          request={scheduling}
          onDone={() => (setScheduling(null), refresh())}
          onError={setError}
        />
      )}
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>When</th>
              <th>Route</th>
              <th>Purpose</th>
              <th>Requested by</th>
              <th>Status</th>
              <th>Trip</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No requests.
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td>{r.requestNo}</td>
                <td>
                  {formatDateTime(r.plannedStart)} – {formatDateTime(r.plannedEnd)}
                </td>
                <td>
                  {r.originName} → {r.destinationName}
                </td>
                <td>
                  {r.purpose}
                  {r.passengers != null && <span className="muted"> · {r.passengers} pax</span>}
                  {r.preferredClass && (
                    <span className="muted"> · {humanize(r.preferredClass)}</span>
                  )}
                </td>
                <td>{r.requesterName ?? '—'}</td>
                <td>
                  <span className={`badge badge-${VR_TONE[r.status]}`}>{humanize(r.status)}</span>
                  {r.rejectionReason && <div className="muted">{r.rejectionReason}</div>}
                </td>
                <td>
                  {r.trip ? (
                    <>
                      {canSchedule ? (
                        <Link to={`/trips/${r.trip.id}`}>{r.trip.tripNo}</Link>
                      ) : (
                        r.trip.tripNo
                      )}
                      <div className="muted">
                        {r.trip.vehicle?.plateNumber} · {r.trip.driver?.fullName}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className="actions">
                    {canSchedule && r.status === 'APPROVED' && (
                      <button className="link" onClick={() => setScheduling(r)}>
                        Assign vehicle
                      </button>
                    )}
                    {r.requestedBy === me &&
                      (r.status === 'PENDING' || r.status === 'APPROVED') && (
                        <button
                          className="link danger"
                          onClick={() => confirm('Cancel this request?') && cancel.mutate(r.id)}
                        >
                          Cancel
                        </button>
                      )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ScheduleForm({
  request,
  onDone,
  onError,
}: {
  request: VehicleRequest;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'all'],
    queryFn: () => api<Paginated<Driver>>('/drivers?pageSize=200'),
  });
  const save = useMutation({
    mutationFn: (body: { vehicleId: string; driverId: string }) =>
      api(`/vehicle-requests/${request.id}/schedule`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: onDone,
    onError: (e) => onError(errorText(e)),
  });
  return (
    <form
      className="card inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save.mutate({
          vehicleId: f.get('vehicleId') as string,
          driverId: f.get('driverId') as string,
        });
      }}
    >
      <strong>
        {request.requestNo}: {request.originName} → {request.destinationName}
      </strong>
      <select name="vehicleId" required aria-label="Vehicle">
        <option value="">Vehicle…</option>
        {vehicles.data?.items
          .filter((v) => !request.preferredClass || v.vehicleClass === request.preferredClass)
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber} · {humanize(v.vehicleClass)}
            </option>
          ))}
      </select>
      <select name="driverId" required aria-label="Driver">
        <option value="">Driver…</option>
        {drivers.data?.items
          .filter((d) => d.active)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
      </select>
      <button className="btn btn-primary" disabled={save.isPending}>
        Create trip
      </button>
    </form>
  );
}
