import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { SignatureView } from '../components/SignatureView';
import { CheckInPanel } from '../components/CheckInPanel';
import { Link, useParams } from 'react-router-dom';
import { CapBars } from '../components/CapBars';
import { api, openFile, session } from '../lib/api';
import { formatDateTime, humanize, money, TRIP_TONE } from '../lib/format';
import type { LoadDetail } from '../lib/types';
import { errorText } from './IncidentsPage';

const RouteMap = lazy(() => import('../components/RouteMap'));
const FLAG_LABEL: Record<string, string> = {
  FAR_FROM_CUSTOMER: 'far from customer',
  NO_GPS: 'no GPS',
  COD_SHORT: 'cash short',
  COD_OVER: 'cash over',
  RECORDED_BY_DISPATCH: 'entered by dispatch',
};

export const STOP_TONE: Record<string, string> = {
  PENDING: 'muted',
  ARRIVED: 'info',
  DELIVERED: 'ok',
  PARTIAL: 'warn',
  FAILED: 'danger',
};

export function LoadPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.LOGISTICS_WRITE);
  const [error, setError] = useState<string | null>(null);
  const { data: l } = useQuery({
    queryKey: ['load', id],
    queryFn: () => api<LoadDetail>(`/logistics/loads/${id}`),
    refetchInterval: 30_000,
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<LoadDetail>(`/logistics/loads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (d) => {
      setError(null);
      qc.setQueryData(['load', id], d);
      void qc.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const setStop = useMutation({
    mutationFn: ({ stopId, body }: { stopId: string; body: Record<string, unknown> }) =>
      api(`/logistics/stops/${stopId}/status`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['load', id] });
    },
    onError: (e) => setError(errorText(e)),
  });
  if (!l) return <p className="muted">Loading…</p>;
  const editable = canWrite && (l.status === 'PLANNED' || l.status === 'ASSIGNED');
  const ongoing = canWrite && l.status === 'ONGOING';
  const move = (i: number, d: -1 | 1) => {
    const ids = l.stops.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    patch.mutate({ stopIds: ids });
  };
  const done = l.stops.filter((s) => ['DELIVERED', 'PARTIAL', 'FAILED'].includes(s.status)).length;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="muted">
            <Link to="/planning">Planning</Link> / {l.tripNo}
          </p>
          <h1>
            Load {l.tripNo}{' '}
            <span className={`badge badge-${TRIP_TONE[l.status] ?? 'muted'}`}>
              {humanize(l.status)}
            </span>
          </h1>
          <p className="muted">
            {l.plannedDate} · {l.depot.name} · {l.vehicle?.plateNumber ?? 'no vehicle'} ·{' '}
            {l.driver?.fullName ?? 'no driver'} · departs {formatDateTime(l.plannedStart)} · {done}/
            {l.stops.length} stops done
          </p>
          <p className="muted">
            Planned route {l.plannedKm ?? l.routeKm} km
            {l.plannedMinutes != null &&
              ` · ${Math.floor(l.plannedMinutes / 60)} h ${l.plannedMinutes % 60} min incl. stops`}{' '}
            <span
              className={`badge badge-${l.routingSource === 'osrm' ? 'ok' : 'muted'}`}
              title="osrm = road network (OSRM/VROOM); straight-line = estimate"
            >
              {l.routingSource === 'osrm' ? 'road routing' : 'straight-line estimate'}
            </span>
            {l.gpsDistanceKm != null && ` · actual ${l.gpsDistanceKm} km (GPS)`}
          </p>
        </div>
        <div className="actions">
          <Link className="btn" to={`/loads/${l.tripId}/manifest`}>
            Manifest
          </Link>
          <Link className="btn" to={`/trips/${l.tripId}`}>
            Trip
          </Link>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="tiles">
        {[
          ['Orders', l.totals.orders],
          ['Weight', `${l.totals.kg} kg`],
          ['Volume', `${l.totals.m3} m³`],
          ['Cases / pallets', `${l.totals.cases} / ${l.totals.pallets}`],
          ['COD to collect', money(l.cod)],
        ].map(([k, v]) => (
          <div className="card tile" key={k}>
            <span className="tile-label">{k}</span>
            <span className="tile-value small">{v}</span>
          </div>
        ))}
      </section>
      {l.vehicle && (
        <section className="card">
          <h2>Capacity · {l.vehicle.plateNumber}</h2>
          <CapBars vehicle={l.vehicle} totals={l.totals} defaultMaxStops={null} />
        </section>
      )}
      <section className="card">
        <Suspense fallback={<p className="muted">Loading map…</p>}>
          <RouteMap depot={l.depot} stops={l.stops} geometry={l.routeGeometry} />
        </Suspense>
      </section>
      {(l.status === 'COMPLETED' || l.checkedInAt) && <CheckInPanel tripId={l.tripId} />}
      <section className="card">
        <h2>Stops</h2>
        <ol className="stop-list">
          {l.stops.map((s, i) => (
            <li key={s.id}>
              <div className="card-head">
                <strong>
                  {s.seq}. {s.name}{' '}
                  <span className={`badge badge-${STOP_TONE[s.status]}`}>{humanize(s.status)}</span>
                </strong>
                <span className="actions">
                  {editable && i > 0 && (
                    <button className="link" onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                  )}
                  {editable && i < l.stops.length - 1 && (
                    <button className="link" onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                  )}
                  {ongoing && (s.status === 'PENDING' || s.status === 'ARRIVED') && (
                    <>
                      <button
                        className="link"
                        onClick={() =>
                          setStop.mutate({ stopId: s.id, body: { outcome: 'DELIVERED' } })
                        }
                      >
                        Mark delivered
                      </button>
                      <button
                        className="link danger"
                        onClick={() => {
                          const reason = prompt(
                            `Reason (${l.failureReasons.join(', ')})`,
                            l.failureReasons[0],
                          );
                          if (reason)
                            setStop.mutate({ stopId: s.id, body: { outcome: 'FAILED', reason } });
                        }}
                      >
                        Mark failed
                      </button>
                    </>
                  )}
                </span>
              </div>
              <span className="muted">
                {s.plannedArrival && `ETA ${formatDateTime(s.plannedArrival)} · `}
                {s.address ?? 'No address'}
                {s.contactPhone && ` · ${s.contactName ?? ''} ${s.contactPhone}`}
                {s.latitude == null && ' · no coordinates'}
                {s.arrivedAt && !s.completedAt && ` · arrived ${formatDateTime(s.arrivedAt)}${s.arrivalSource === 'gps' ? ' (GPS)' : ''}`}
                {s.completedAt && ` · ${formatDateTime(s.completedAt)}`}
                {s.failureReason && ` · ${s.failureReason}`}
              </span>
              {(s.pod.photoFileIds.length > 0 ||
                s.pod.signature ||
                s.pod.codCollected != null ||
                s.pod.flags.length > 0) && (
                <div className="pod">
                  {s.pod.photoFileIds.map((f, n) => (
                    <button
                      key={f}
                      className="btn"
                      onClick={() => openFile(f).catch((e: Error) => setError(e.message))}
                    >
                      Photo {n + 1}
                    </button>
                  ))}
                  {s.pod.signature && (
                    <SignatureView strokes={s.pod.signature.strokes} name={s.pod.signedBy} />
                  )}
                  <span className="muted">
                    {s.pod.codExpected
                      ? `COD ${money(s.pod.codCollected ?? 0)} of ${money(s.pod.codExpected)}`
                      : ''}
                    {s.pod.distanceM != null && ` · ${s.pod.distanceM} m from customer`}
                  </span>
                  {s.pod.flags.map((f) => (
                    <span
                      key={f}
                      className={`badge badge-${f === 'RECORDED_BY_DISPATCH' || f === 'NO_GPS' ? 'muted' : 'danger'}`}
                    >
                      {FLAG_LABEL[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
              {s.returns.length > 0 && (
                <p className="muted">
                  Customer returns:{' '}
                  {s.returns
                    .map((r) => `${r.sku} ×${r.quantity} ${r.uom} (${r.reason})`)
                    .join('; ')}
                </p>
              )}
              <table>
                <tbody>
                  {s.orders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.externalRef}</td>
                      <td>
                        {o.lines
                          .map(
                            (x) =>
                              `${x.sku} ×${x.quantity}${x.deliveredQty != null && x.deliveredQty !== x.quantity ? ` (got ${x.deliveredQty})` : ''}`,
                          )
                          .join(', ')}
                      </td>
                      <td className="num">{o.weightKg ?? '—'} kg</td>
                      <td className="num">{o.codAmount ? money(o.codAmount) : ''}</td>
                      <td>
                        <span className={`badge badge-${STOP_TONE[o.status] ?? 'muted'}`}>
                          {humanize(o.status)}
                        </span>
                      </td>
                      <td>
                        {editable && (
                          <button
                            className="link danger"
                            onClick={() =>
                              confirm(`Remove ${o.externalRef} from this load?`) &&
                              patch.mutate({ removeOrderIds: [o.id] })
                            }
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
