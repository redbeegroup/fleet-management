import { Paginated, Permission } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api, session } from '../lib/api';
import { humanize, TRIP_TONE } from '../lib/format';
import type { Trip, Vehicle } from '../lib/types';

const H = 3_600_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Vehicle × time timeline of trips (Gantt-style scheduling board). */
export function DispatchBoardPage() {
  const navigate = useNavigate();
  const canWrite = session.can(Permission.TRIP_WRITE);
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [span, setSpan] = useState(1);
  const from = day;
  const to = new Date(day.getTime() + span * 24 * H);
  const total = to.getTime() - from.getTime();

  const vehicles = useQuery({ queryKey: ['vehicles', 'all'], queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200') });
  const trips = useQuery({
    queryKey: ['trips', 'board', from.toISOString(), span],
    queryFn: () => api<Paginated<Trip>>(`/trips?from=${from.toISOString()}&to=${to.toISOString()}&pageSize=500`),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const list = (trips.data?.items ?? []).filter((t) => t.status !== 'CANCELLED');
    const byVehicle = new Map<string, Trip[]>();
    for (const t of list) {
      const k = t.vehicleId ?? 'unassigned';
      byVehicle.set(k, [...(byVehicle.get(k) ?? []), t]);
    }
    return byVehicle;
  }, [trips.data]);

  const pos = (t: Trip) => {
    const s = Math.max(new Date(t.actualStart ?? t.plannedStart).getTime(), from.getTime());
    const endRaw = t.status === 'ONGOING' ? Math.max(Date.now(), new Date(t.plannedEnd).getTime()) : new Date(t.actualEnd ?? t.plannedEnd).getTime();
    const e = Math.min(endRaw, to.getTime());
    return { left: `${((s - from.getTime()) / total) * 100}%`, width: `${Math.max(0.6, ((e - s) / total) * 100)}%` };
  };
  const ticks = Array.from({ length: span === 1 ? 13 : span * 4 + 1 }, (_, i) => new Date(from.getTime() + (i * total) / (span === 1 ? 12 : span * 4)));
  const nowPct = ((Date.now() - from.getTime()) / total) * 100;

  function newTripAt(vehicleId: string | null, e: React.MouseEvent<HTMLDivElement>) {
    if (!canWrite) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = from.getTime() + ((e.clientX - rect.left) / rect.width) * total;
    const rounded = new Date(Math.round(t / (H / 2)) * (H / 2));
    navigate(`/trips/new?start=${rounded.toISOString()}${vehicleId ? `&vehicleId=${vehicleId}` : ''}`);
  }

  const Row = ({ id, label, sub, list }: { id: string | null; label: React.ReactNode; sub?: React.ReactNode; list: Trip[] }) => (
    <div className="board-row">
      <div className="board-label">
        {label}
        {sub}
      </div>
      <div className="board-lane" onDoubleClick={(e) => newTripAt(id, e)} title={canWrite ? 'Double-click to plan a trip here' : undefined}>
        {nowPct > 0 && nowPct < 100 && <div className="board-now" style={{ left: `${nowPct}%` }} />}
        {list.map((t) => (
          <Link
            key={t.id}
            to={`/trips/${t.id}`}
            className={`board-bar tone-${TRIP_TONE[t.status]}`}
            style={pos(t)}
            title={`${t.tripNo} · ${t.originName} → ${t.destinationName} · ${humanize(t.status)}${t.driver ? ` · ${t.driver.fullName}` : ''}`}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <strong>{t.tripNo.split('-').pop()}</strong> {t.destinationName}
            {t.driver && <span className="muted"> · {t.driver.fullName}</span>}
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <header className="page-head">
        <h1>Dispatch board</h1>
        <div className="actions">
          <button className="btn" onClick={() => setDay(new Date(day.getTime() - span * 24 * H))} aria-label="Previous">
            ←
          </button>
          <input type="date" value={dateInput(day)} onChange={(e) => e.target.value && setDay(startOfDay(new Date(`${e.target.value}T00:00`)))} />
          <button className="btn" onClick={() => setDay(new Date(day.getTime() + span * 24 * H))} aria-label="Next">
            →
          </button>
          <button className="btn" onClick={() => setDay(startOfDay(new Date()))}>
            Today
          </button>
          <select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Range">
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>Week</option>
          </select>
          {canWrite && (
            <Link className="btn btn-primary" to="/trips/new">
              New trip
            </Link>
          )}
        </div>
      </header>
      <div className="card board">
        <div className="board-row board-head">
          <div className="board-label muted">Vehicle</div>
          <div className="board-lane">
            {ticks.map((t, i) => (
              <span key={i} className="board-tick" style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}>
                {span === 1
                  ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  : t.getHours() === 0
                    ? t.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' })
                    : t.toLocaleTimeString('en-GB', { hour: '2-digit' })}
              </span>
            ))}
          </div>
        </div>
        {rows.get('unassigned') && <Row id={null} label={<strong>Unassigned</strong>} list={rows.get('unassigned')!} />}
        {vehicles.data?.items
          .filter((v) => v.status !== 'DISPOSED')
          .map((v) => (
            <Row
              key={v.id}
              id={v.id}
              label={<Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>}
              sub={
                <span className="board-sub">
                  {humanize(v.vehicleClass)} <StatusBadge status={v.status} />
                </span>
              }
              list={rows.get(v.id) ?? []}
            />
          ))}
      </div>
      <p className="muted">
        {trips.data?.items.length ?? 0} trips in range.{canWrite && ' Double-click an empty slot to plan a trip for that vehicle and time.'}
      </p>
    </>
  );
}
