import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDate, formatDateTime, humanize } from '../lib/format';
import type { Paginated } from '@fms/shared';
import type { Vehicle } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

export interface Requirement {
  type: string;
  label: string;
  status: 'OK' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'UNKNOWN';
  validUntil: string | null;
  documentId: string | null;
  blocks: boolean;
}
export const REQ_TONE: Record<Requirement['status'], string> = { OK: 'ok', EXPIRING: 'warn', EXPIRED: 'danger', MISSING: 'danger', UNKNOWN: 'muted' };

interface Reading {
  id: string;
  kind: 'KM' | 'HOURS';
  value: string;
  readAt: string;
  note: string | null;
}
interface Coupling {
  id: string;
  trailerId: string;
  tractorId: string;
  trailer: string | null;
  tractor: string | null;
  tripId: string | null;
  tripNo: string | null;
  coupledAt: string;
  uncoupledAt: string | null;
}

/** Country compliance of one vehicle: required documents and whether they block dispatch. */
export function VehicleCompliance({ vehicleId }: { vehicleId: string }) {
  const q = useQuery({ queryKey: ['vehicle-compliance', vehicleId], queryFn: () => api<{ status: Requirement['status']; blocked: boolean; requirements: Requirement[] }>(`/vehicles/${vehicleId}/compliance`) });
  const c = q.data;
  if (!c || !c.requirements.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Compliance</h2>
        {c.blocked ? <span className="badge badge-danger">Cannot be dispatched</span> : <span className={`badge badge-${REQ_TONE[c.status]}`}>{humanize(c.status)}</span>}
      </div>
      <ul className="req-list">
        {c.requirements.map((r) => (
          <li key={r.type}>
            <span className={`badge badge-${REQ_TONE[r.status]}`}>{humanize(r.status)}</span> {r.label}
            <span className="muted small">{r.validUntil ? ` · valid until ${formatDate(r.validUntil)}` : ''}{r.blocks ? ' · blocks dispatch' : ''}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Add the documents in the Documents card above. Rules are in <Link to="/compliance">Compliance</Link>.</p>
    </section>
  );
}

/** Meter readings (km or engine hours) and, for trailers and tractors, the coupling history. */
export function VehicleMeters({ v }: { v: Vehicle }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const isTrailer = v.assetKind === 'TRAILER';
  const [err, setErr] = useState<string | null>(null);
  const readings = useQuery({ queryKey: ['meter', v.id], queryFn: () => api<Reading[]>(`/vehicles/${v.id}/meter-readings`) });
  const couplings = useQuery({ queryKey: ['couplings', v.id], queryFn: () => api<Coupling[]>(`/vehicles/${v.id}/couplings`) });
  const tractors = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
    enabled: isTrailer && session.can(Permission.TRIP_WRITE),
    select: (p) => p.items.filter((x) => (x.assetKind ?? 'VEHICLE') === 'VEHICLE' && x.status !== 'DISPOSED'),
  });
  const done = () => (setErr(null), void qc.invalidateQueries({ queryKey: ['meter', v.id] }), void qc.invalidateQueries({ queryKey: ['couplings', v.id] }), void qc.invalidateQueries({ queryKey: ['vehicle', v.id] }));
  const add = useMutation({ mutationFn: (b: unknown) => api(`/vehicles/${v.id}/meter-readings`, { method: 'POST', body: JSON.stringify(b) }), onSuccess: done, onError: (e) => setErr(errorText(e)) });
  const couple = useMutation({ mutationFn: (tractorId: string | null) => api(`/vehicles/${v.id}/couple`, { method: 'POST', body: JSON.stringify({ tractorId }) }), onSuccess: done, onError: (e) => setErr(errorText(e)) });
  const meter = v.meterType ?? 'KM';
  const current = couplings.data?.find((c) => !c.uncoupledAt && c.trailerId === v.id);
  const showCouplings = isTrailer || (couplings.data?.length ?? 0) > 0;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    add.mutate({ kind: f.get('kind'), value: Number(f.get('value')), note: (f.get('note') as string) || null });
    e.currentTarget.reset();
  }
  if (meter === 'NONE' && !showCouplings) return null;
  return (
    <section className="grid-2">
      {meter !== 'NONE' && (
        <div className="card">
          <div className="card-head">
            <h2>Meter readings</h2>
            <span className="muted small">{meter === 'HOURS' ? `${Number(v.hourMeter ?? 0).toLocaleString()} h` : `${Number(v.odometerKm).toLocaleString()} km`}</span>
          </div>
          {err && <p className="error">{err}</p>}
          {canWrite && (
            <form className="inline-form" onSubmit={submit}>
              <select name="kind" defaultValue={meter} aria-label="Meter">
                <option value="KM">km</option>
                <option value="HOURS">hours</option>
              </select>
              <input name="value" type="number" min={0} step="0.1" required placeholder="Reading" aria-label="Reading" />
              <input name="note" placeholder="Note" aria-label="Note" />
              <button className="btn" disabled={add.isPending}>
                Record
              </button>
            </form>
          )}
          <table>
            <tbody>
              {readings.data?.length === 0 && (
                <tr>
                  <td className="muted">No manual readings yet{meter === 'KM' ? ' (GPS and trips update the odometer)' : ''}.</td>
                </tr>
              )}
              {readings.data?.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.readAt)}</td>
                  <td className="num">
                    {Number(r.value).toLocaleString()} {r.kind === 'HOURS' ? 'h' : 'km'}
                  </td>
                  <td className="muted small">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCouplings && (
        <div className="card">
          <div className="card-head">
            <h2>{isTrailer ? 'Coupling' : 'Trailers pulled'}</h2>
            {isTrailer && <span className={`badge badge-${current ? 'ok' : 'muted'}`}>{current ? `on ${current.tractor}` : 'uncoupled'}</span>}
          </div>
          {isTrailer && session.can(Permission.TRIP_WRITE) && (
            <div className="inline-form">
              <select aria-label="Tractor" defaultValue="" onChange={(e) => e.target.value && couple.mutate(e.target.value)}>
                <option value="">Couple to…</option>
                {tractors.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plateNumber} · {humanize(t.vehicleClass)}
                  </option>
                ))}
              </select>
              {current && (
                <button className="btn" onClick={() => couple.mutate(null)}>
                  Uncouple
                </button>
              )}
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>{isTrailer ? 'Tractor' : 'Trailer'}</th>
                <th>Trip</th>
                <th>Coupled</th>
                <th>Uncoupled</th>
              </tr>
            </thead>
            <tbody>
              {couplings.data?.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/vehicles/${isTrailer ? c.tractorId : c.trailerId}`}>{isTrailer ? c.tractor : c.trailer}</Link>
                  </td>
                  <td>{c.tripId ? <Link to={`/trips/${c.tripId}`}>{c.tripNo}</Link> : <span className="muted">yard</span>}</td>
                  <td>{formatDateTime(c.coupledAt)}</td>
                  <td>{c.uncoupledAt ? formatDateTime(c.uncoupledAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
