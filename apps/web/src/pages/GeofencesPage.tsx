import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError, session } from '../lib/api';
import { humanize } from '../lib/format';
import { circleRing, fenceRing, onStyleReady, OSM_STYLE, showFences, YANGON } from '../lib/map';
import type { Geofence } from '../lib/types';

type Mode = 'none' | 'CIRCLE' | 'POLYGON';
const CATEGORIES = ['BRANCH', 'WAREHOUSE', 'CUSTOMER', 'SITE', 'RESTRICTED'];

export function GeofencesPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.GEOFENCE_WRITE);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mode, setMode] = useState<Mode>('none');
  const modeRef = useRef<Mode>('none');
  modeRef.current = mode;
  const [center, setCenter] = useState<[number, number] | null>(null); // [lng, lat]
  const [radius, setRadius] = useState(500);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: fences } = useQuery({ queryKey: ['geofences'], queryFn: () => api<Geofence[]>('/geofences') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['geofences'] });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/geofences', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      refresh();
      reset();
    },
    onError: (e) => setError(e instanceof ApiError && e.body.errors ? e.body.errors.map((x) => x.message).join('; ') : e.message),
  });
  const update = useMutation({
    mutationFn: (g: Geofence) => api(`/geofences/${g.id}`, { method: 'PATCH', body: JSON.stringify(g) }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/geofences/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  function reset() {
    setMode('none');
    setCenter(null);
    setVertices([]);
    setError(null);
  }

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new maplibregl.Map({ container: container.current, style: OSM_STYLE, center: YANGON, zoom: 12 });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('click', (e) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (modeRef.current === 'CIRCLE') setCenter(pt);
      if (modeRef.current === 'POLYGON') setVertices((v) => [...v, pt]);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m && fences) onStyleReady(m, () => showFences(m, fences), 'fences');
  }, [fences]);

  // Draft overlay
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    onStyleReady(m, () => {
      let ring: [number, number][] | null = null;
      if (mode === 'CIRCLE' && center) ring = circleRing(center[1], center[0], radius);
      if (mode === 'POLYGON' && vertices.length >= 2) ring = vertices.length >= 3 ? [...vertices, vertices[0]] : vertices;
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          ...(ring ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: ring } }] : []),
          ...vertices.map((v) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: v } })),
          ...(center && mode === 'CIRCLE' ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: center } }] : []),
        ],
      };
      const src = m.getSource('draft') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
      else {
        m.addSource('draft', { type: 'geojson', data });
        m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#d92d20', 'line-width': 2.5 } });
        m.addLayer({
          id: 'draft-pts',
          type: 'circle',
          source: 'draft',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 5, 'circle-color': '#d92d20', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });
      }
      m.getCanvas().style.cursor = mode === 'none' ? '' : 'crosshair';
    }, 'draft');
  }, [mode, center, radius, vertices]);

  function zoomTo(g: Geofence) {
    const ring = fenceRing(g);
    if (!ring || !map.current) return;
    const b = new maplibregl.LngLatBounds();
    ring.forEach((p) => b.extend(p));
    map.current.fitBounds(b, { padding: 80, maxZoom: 16 });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const base = {
      name: f.get('name'),
      category: f.get('category'),
      alertOnEnter: f.get('alertOnEnter') === 'on',
      alertOnExit: f.get('alertOnExit') === 'on',
      shape: mode,
    };
    if (mode === 'CIRCLE') {
      if (!center) return setError('Click the map to set the centre.');
      create.mutate({ ...base, centerLat: center[1], centerLng: center[0], radiusM: radius });
    } else if (mode === 'POLYGON') {
      if (vertices.length < 3) return setError('Click at least three points on the map.');
      create.mutate({ ...base, polygon: vertices });
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>Geofences</h1>
        {canWrite && mode === 'none' && (
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setMode('CIRCLE')}>
              New circle
            </button>
            <button className="btn btn-primary" onClick={() => setMode('POLYGON')}>
              New polygon
            </button>
          </div>
        )}
      </header>
      <div className="map-layout">
        <div className="card map-card">
          <div ref={container} className="map map-short" />
        </div>
        <aside className="card feed">
          {mode !== 'none' ? (
            <form className="stack" onSubmit={submit}>
              <h2>New {mode === 'CIRCLE' ? 'circle' : 'polygon'}</h2>
              <p className="muted">
                {mode === 'CIRCLE' ? 'Click the map to place the centre.' : `Click the map to add corners (${vertices.length} so far).`}
              </p>
              {mode === 'CIRCLE' && (
                <label>
                  Radius (m)
                  <input type="number" min={10} max={100000} value={radius} onChange={(e) => setRadius(Number(e.target.value) || 10)} />
                </label>
              )}
              {mode === 'POLYGON' && (
                <div className="actions start">
                  <button type="button" className="btn" onClick={() => setVertices((v) => v.slice(0, -1))} disabled={!vertices.length}>
                    Undo point
                  </button>
                  <button type="button" className="btn" onClick={() => setVertices([])}>
                    Clear
                  </button>
                </div>
              )}
              <label>
                Name
                <input name="name" required maxLength={128} />
              </label>
              <label>
                Category
                <select name="category" defaultValue="SITE">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {humanize(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" name="alertOnEnter" /> Alert on entry
              </label>
              <label className="check">
                <input type="checkbox" name="alertOnExit" /> Alert on exit
              </label>
              {error && <p className="error">{error}</p>}
              <div className="actions start">
                <button type="button" className="btn" onClick={reset}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={create.isPending}>
                  Save geofence
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2>{fences?.length ?? 0} geofences</h2>
              <ul className="fence-list">
                {fences?.map((g) => (
                  <li key={g.id} className={g.active ? '' : 'inactive'}>
                    <button className="link" onClick={() => zoomTo(g)}>
                      <strong>{g.name}</strong>
                    </button>
                    <span className="muted">
                      {humanize(g.category)} · {g.shape === 'CIRCLE' ? `circle ${Math.round(g.radiusM ?? 0)} m` : `${g.polygon?.length} corners`}
                      {g.alertOnEnter || g.alertOnExit
                        ? ` · alerts on ${[g.alertOnEnter && 'entry', g.alertOnExit && 'exit'].filter(Boolean).join(' & ')}`
                        : ''}
                    </span>
                    {canWrite && (
                      <span className="actions start">
                        <button className="link" onClick={() => update.mutate({ ...g, active: !g.active })}>
                          {g.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="link danger" onClick={() => confirm(`Delete ${g.name}?`) && remove.mutate(g.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
