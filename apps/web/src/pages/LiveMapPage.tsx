import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import type { LivePosition } from '../lib/types';

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      // Point VITE_MAP_TILE_URL at an internal/commercial tile server for production use.
      tiles: [import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function LiveMapPage() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());

  const { data } = useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: () => api<LivePosition[]>('/tracking/live'),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({ container: container.current, style: OSM_STYLE, center: [96.17, 16.84], zoom: 11 });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !data) return;
    for (const p of data) {
      const label = `${p.vehicle.plateNumber} · ${p.offline ? 'offline' : `${Math.round(p.speedKmh ?? 0)} km/h`}`;
      let m = markers.current.get(p.vehicleId);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'vehicle-marker';
        m = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map.current);
        m.setPopup(new maplibregl.Popup({ offset: 12 }));
        markers.current.set(p.vehicleId, m);
      }
      m.setLngLat([p.longitude, p.latitude]);
      m.getPopup()?.setText(label);
      const el = m.getElement();
      el.dataset.state = p.offline ? 'offline' : (p.speedKmh ?? 0) > 0 ? 'moving' : 'idle';
      el.title = label;
    }
  }, [data]);

  const moving = data?.filter((p) => !p.offline && (p.speedKmh ?? 0) > 0).length ?? 0;
  const offline = data?.filter((p) => p.offline).length ?? 0;

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
      <div className="card map-card">
        <div ref={container} className="map" />
      </div>
    </>
  );
}
