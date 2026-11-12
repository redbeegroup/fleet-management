import { useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { describeEvent, EVENT_LABELS } from '../lib/format';
import { LiveEvent, useLive } from '../lib/live';
import { onStyleReady, OSM_STYLE, showFences, YANGON } from '../lib/map';
import type { Geofence, LivePosition } from '../lib/types';

const OFFLINE_MS = 15 * 60_000;

export function LiveMapPage() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const fitted = useRef(false);
  const qc = useQueryClient();
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [connectedAt] = useState(() => Date.now());

  const { data } = useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: () => api<LivePosition[]>('/tracking/live'),
    refetchInterval: 120_000, // safety net; WebSocket pushes the real-time updates
  });
  const fences = useQuery({ queryKey: ['geofences'], queryFn: () => api<Geofence[]>('/geofences') });

  useLive({
    onPositions: (updates) =>
      qc.setQueryData<LivePosition[]>(['tracking', 'live'], (old) => {
        if (!old) return old;
        const byId = new Map(old.map((p) => [p.vehicleId, p]));
        for (const u of updates) {
          const cur = byId.get(u.vehicleId);
          if (cur) byId.set(u.vehicleId, { ...cur, ...u, offline: false });
        }
        return [...byId.values()];
      }),
    onEvents: (events) => setFeed((f) => [...events.filter((e) => !e.type.startsWith('IGNITION')).reverse(), ...f].slice(0, 30)),
  });

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({ container: container.current, style: OSM_STYLE, center: YANGON, zoom: 11 });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m && fences.data) onStyleReady(m, () => showFences(m, fences.data!.filter((f) => f.active)), 'fences');
  }, [fences.data]);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    for (const p of data) {
      const offline = Date.now() - new Date(p.recordedAt).getTime() > OFFLINE_MS;
      const label = `${p.vehicle.plateNumber} · ${offline ? 'offline' : `${Math.round(p.speedKmh ?? 0)} km/h`}`;
      let mk = markers.current.get(p.vehicleId);
      if (!mk) {
        const el = document.createElement('div');
        el.className = 'vehicle-marker';
        mk = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(m);
        mk.setPopup(new maplibregl.Popup({ offset: 12 }));
        markers.current.set(p.vehicleId, mk);
      }
      mk.setLngLat([p.longitude, p.latitude]);
      const popup = document.createElement('div');
      popup.innerHTML = `<strong></strong><br/><a href="/vehicles/${p.vehicleId}/track">Trip history →</a>`;
      popup.querySelector('strong')!.textContent = label;
      mk.getPopup()?.setDOMContent(popup);
      const el = mk.getElement();
      el.dataset.state = offline ? 'offline' : (p.speedKmh ?? 0) > 0 ? 'moving' : 'idle';
      el.title = label;
    }
    if (!fitted.current && data.length) {
      const b = new maplibregl.LngLatBounds();
      data.forEach((p) => b.extend([p.longitude, p.latitude]));
      m.fitBounds(b, { padding: 80, maxZoom: 13, duration: 0 });
      fitted.current = true;
    }
  }, [data]);

  const offline = data?.filter((p) => Date.now() - new Date(p.recordedAt).getTime() > OFFLINE_MS).length ?? 0;
  const moving = data?.filter((p) => Date.now() - new Date(p.recordedAt).getTime() <= OFFLINE_MS && (p.speedKmh ?? 0) > 0).length ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>Live map</h1>
        <div className="legend">
          <span>
            <i data-state="moving" /> Moving {moving}
          </span>
          <span>
            <i data-state="idle" /> Stopped {(data?.length ?? 0) - moving - offline}
          </span>
          <span>
            <i data-state="offline" /> Offline {offline}
          </span>
        </div>
      </header>
      <div className="map-layout">
        <div className="card map-card">
          <div ref={container} className="map" />
        </div>
        <aside className="card feed">
          <h2>Live events</h2>
          {feed.length === 0 && (
            <p className="muted">Waiting for events since {new Date(connectedAt).toLocaleTimeString('en-GB')}…</p>
          )}
          <ul>
            {feed.map((e) => (
              <li key={e.id}>
                <span className={`badge badge-${EVENT_LABELS[e.type]?.tone ?? 'muted'}`}>{EVENT_LABELS[e.type]?.label ?? e.type}</span>
                <div>
                  <Link to={`/vehicles/${e.vehicleId}/track`}>{e.plateNumber}</Link> <span className="muted">{describeEvent(e)}</span>
                  <time className="muted">{new Date(e.occurredAt).toLocaleTimeString('en-GB')}</time>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/events" className="muted">
            All events →
          </Link>
        </aside>
      </div>
    </>
  );
}
