import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { describeEvent, EVENT_LABELS, formatDuration } from '../lib/format';
import { onStyleReady, OSM_STYLE, YANGON } from '../lib/map';
import type { TrackResponse } from '../lib/types';

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const EVENT_COLORS: Record<string, string> = {
  OVERSPEED: '#d92d20',
  IDLE: '#e69b00',
  GEOFENCE_ENTER: '#1f5fbf',
  GEOFENCE_EXIT: '#1f5fbf',
  GPS_OFFLINE: '#8a94a6',
  GPS_RESTORED: '#1d9a55',
};

/** Trip history / playback for one vehicle. */
export function TrackPage() {
  const { id } = useParams();
  const now = new Date();
  const [from, setFrom] = useState(() => toLocalInput(new Date(now.getTime() - 6 * 3_600_000)));
  const [to, setTo] = useState(() => toLocalInput(now));
  const [range, setRange] = useState({ from, to });
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const playhead = useRef<maplibregl.Marker | null>(null);

  const { data, isFetching, error } = useQuery({
    queryKey: ['track', id, range],
    queryFn: () =>
      api<TrackResponse>(
        `/tracking/vehicles/${id}/history?from=${new Date(range.from).toISOString()}&to=${new Date(range.to).toISOString()}`,
      ),
  });
  const points = useMemo(() => data?.points ?? [], [data]);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({ container: container.current, style: OSM_STYLE, center: YANGON, zoom: 11 });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    const el = document.createElement('div');
    el.className = 'vehicle-marker playhead';
    playhead.current = new maplibregl.Marker({ element: el });
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    onStyleReady(m, () => {
      const line: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.longitude, p.latitude]) },
      };
      const events: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: data.events
          .filter((e) => e.latitude != null && e.longitude != null)
          .map((e) => ({
            type: 'Feature',
            properties: { color: EVENT_COLORS[e.type] ?? '#555', label: EVENT_LABELS[e.type]?.label ?? e.type },
            geometry: { type: 'Point', coordinates: [e.longitude!, e.latitude!] },
          })),
      };
      const src = m.getSource('track') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(line);
        (m.getSource('track-events') as maplibregl.GeoJSONSource).setData(events);
      } else {
        m.addSource('track', { type: 'geojson', data: line });
        m.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#fff', 'line-width': 7 } });
        m.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#1f5fbf', 'line-width': 4 } });
        m.addSource('track-events', { type: 'geojson', data: events });
        m.addLayer({
          id: 'track-events',
          type: 'circle',
          source: 'track-events',
          paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });
      }
      if (points.length) {
        const b = new maplibregl.LngLatBounds();
        points.forEach((p) => b.extend([p.longitude, p.latitude]));
        m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
        playhead.current?.setLngLat([points[0].longitude, points[0].latitude]).addTo(m);
      } else playhead.current?.remove();
    }, 'track');
    setCursor(0);
    setPlaying(false);
  }, [data, points]);

  useEffect(() => {
    const p = points[cursor];
    if (p) playhead.current?.setLngLat([p.longitude, p.latitude]);
  }, [cursor, points]);

  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.floor(points.length / 300));
    const t = setInterval(() => {
      setCursor((c) => {
        if (c + step >= points.length - 1) {
          setPlaying(false);
          return points.length - 1;
        }
        return c + step;
      });
    }, 50);
    return () => clearInterval(t);
  }, [playing, points.length]);

  const s = data?.summary;
  const p = points[cursor];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Trip history · {data?.vehicle.plateNumber ?? '…'}</h1>
          <p className="muted">
            <Link to={`/vehicles/${id}`}>Vehicle details</Link>
          </p>
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            setRange({ from, to });
          }}
        >
          <label className="mini">
            From
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mini">
            To
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={isFetching}>
            {isFetching ? 'Loading…' : 'Show'}
          </button>
        </form>
      </header>
      {error && <p className="error">{(error as Error).message}</p>}
      <section className="tiles">
        {[
          ['Distance', s ? `${s.distanceKm} km` : '…'],
          ['Driving time', s ? formatDuration(s.movingMinutes) : '…'],
          ['Max speed', s ? `${s.maxSpeedKmh} km/h` : '…'],
          ['Avg moving speed', s ? `${s.avgMovingSpeedKmh} km/h` : '…'],
          ['Stops ≥ 5 min', s ? s.stops : '…'],
        ].map(([label, value]) => (
          <div className="card tile" key={label}>
            <span className="tile-label">{label}</span>
            <span className="tile-value small">{value}</span>
          </div>
        ))}
      </section>
      <div className="map-layout">
        <div className="card map-card">
          <div ref={container} className="map map-short" />
          <div className="playback">
            <button
              className="btn"
              disabled={points.length < 2}
              onClick={() => {
                if (cursor >= points.length - 1) setCursor(0);
                setPlaying((x) => !x);
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, points.length - 1)}
              value={cursor}
              onChange={(e) => setCursor(Number(e.target.value))}
              disabled={points.length < 2}
              aria-label="Playback position"
            />
            <span className="muted playback-info">
              {p
                ? `${new Date(p.recordedAt).toLocaleString('en-GB')} · ${Math.round(p.speedKmh ?? 0)} km/h${p.ignition === false ? ' · engine off' : ''}`
                : 'No positions in this range'}
            </span>
          </div>
        </div>
        <aside className="card feed">
          <h2>Events ({data?.events.length ?? 0})</h2>
          <ul>
            {data?.events.map((e) => (
              <li key={e.id}>
                <span className={`badge badge-${EVENT_LABELS[e.type]?.tone ?? 'muted'}`}>{EVENT_LABELS[e.type]?.label ?? e.type}</span>
                <div>
                  <span>{describeEvent(e)}</span>
                  <time className="muted">{new Date(e.occurredAt).toLocaleString('en-GB')}</time>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
