import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RangePicker } from '../components/RangePicker';
import { api } from '../lib/api';
import { BAND_TONE, humanize, lastDays, money } from '../lib/format';
import type { SafetyScores } from '../lib/types';

const MIX: { key: keyof SafetyScores['fleet']['events']; label: string; color: string }[] = [
  { key: 'overspeed', label: 'Overspeed', color: 'var(--series-1)' },
  { key: 'harshBrake', label: 'Harsh braking', color: 'var(--series-2)' },
  { key: 'harshAccel', label: 'Harsh acceleration', color: 'var(--series-3)' },
  { key: 'harshCorner', label: 'Harsh cornering', color: 'var(--series-4)' },
];

export function ScoreBadge({ score, band }: { score: number | null; band: string }) {
  return (
    <span className={`badge badge-${BAND_TONE[band] ?? 'muted'}`} title={humanize(band)}>
      {score ?? '—'}
    </span>
  );
}

export function SafetyPage() {
  const [range, setRange] = useState(() => lastDays(30));
  const { data, isLoading } = useQuery({
    queryKey: ['safety', 'scores', range],
    queryFn: () => api<SafetyScores>(`/safety/scores?from=${range.from}&to=${range.to}`),
  });
  const f = data?.fleet;
  const per100 = (n: number) =>
    f && f.distanceKm ? Math.round((n / f.distanceKm) * 1000) / 10 : null;
  const maxMix = f ? Math.max(1, ...MIX.map((m) => f.events[m.key])) : 1;

  return (
    <>
      <header className="page-head">
        <h1>Driver safety</h1>
        <RangePicker value={range} onChange={setRange} />
      </header>

      <section className="tiles">
        <div className="card tile hero">
          <span className="tile-label">Fleet safety score</span>
          <span className="tile-value">{f ? (f.averageScore ?? '—') : '…'}</span>
          <span className="muted">distance-weighted, 0–100</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Drivers scored</span>
          <span className="tile-value small">{f ? `${f.scoredDrivers} / ${f.drivers}` : '…'}</span>
          <span className="muted">≥ {data?.settings.minDistanceKm ?? '…'} km driven</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Below {data?.settings.alertBelow ?? '…'}</span>
          <span className={`tile-value small ${f?.belowThreshold ? 'text-danger' : ''}`}>
            {f ? f.belowThreshold : '…'}
          </span>
        </div>
        <div className="card tile">
          <span className="tile-label">Distance attributed</span>
          <span className="tile-value small">{f ? `${money(f.distanceKm)} km` : '…'}</span>
        </div>
      </section>

      <section className="card">
        <h2>Event mix</h2>
        <ul className="bar-list">
          {MIX.map((m) => {
            const n = f?.events[m.key] ?? 0;
            return (
              <li key={m.key}>
                <span>{m.label}</span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ width: `${(n / maxMix) * 100}%`, background: m.color }}
                  />
                </span>
                <span className="num">
                  {n} <span className="muted">· {per100(n) ?? '—'}/100 km</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          Harsh events are computed from GPS speed and heading when fixes are at most a few seconds
          apart; device accelerometer events (Watch Tower) are used when the tracker reports them.
        </p>
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Driver ranking</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Driver</th>
              <th className="num">Score</th>
              <th className="num">Distance (km)</th>
              <th className="num">Overspeed</th>
              <th className="num">Braking</th>
              <th className="num">Accel.</th>
              <th className="num">Cornering</th>
              <th className="num">Idle (min)</th>
              <th className="num">Points / 100 km</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.drivers.map((d, i) => (
              <tr key={d.id}>
                <td className="muted">{d.score !== null ? i + 1 : ''}</td>
                <td>
                  <Link to={`/drivers/${d.id}`}>{d.fullName}</Link>{' '}
                  <span className="muted">{d.employeeNo}</span>
                </td>
                <td className="num">
                  <ScoreBadge score={d.score} band={d.band} />
                </td>
                <td className="num">{money(d.distanceKm)}</td>
                <td className="num">{d.overspeed}</td>
                <td className="num">{d.harshBrake}</td>
                <td className="num">{d.harshAccel}</td>
                <td className="num">{d.harshCorner}</td>
                <td className="num">{d.idleMinutes}</td>
                <td className="num">{d.pointsPer100Km ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
