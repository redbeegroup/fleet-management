import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { onStyleReady, OSM_STYLE, YANGON } from '../lib/map';
import { decodePolyline } from '../lib/polyline';

const COLOR: Record<string, string> = {
  PENDING: '#64748b',
  ARRIVED: '#2563eb',
  DELIVERED: '#16a34a',
  PARTIAL: '#d97706',
  FAILED: '#dc2626',
};

/** Planned route (OSRM geometry or straight segments) with numbered stops and POD positions. */
export default function RouteMap({
  depot,
  stops,
  geometry,
}: {
  depot: { latitude?: number | null; longitude?: number | null; name: string };
  stops: {
    seq: number;
    name: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
    pod: { latitude: number | null; longitude: number | null };
  }[];
  geometry: string | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = new maplibregl.Map({
      container: el.current,
      style: OSM_STYLE,
      center: YANGON,
      zoom: 11,
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    const pts: [number, number][] = [];
    const add = (lng: number, lat: number, html: string, cls: string, title: string) => {
      const div = document.createElement('div');
      div.className = cls;
      div.innerHTML = html;
      div.title = title;
      markers.current.push(new maplibregl.Marker({ element: div }).setLngLat([lng, lat]).addTo(m));
      pts.push([lng, lat]);
    };
    if (depot.latitude != null && depot.longitude != null)
      add(depot.longitude, depot.latitude, '⌂', 'route-pin depot', depot.name);
    for (const s of stops) {
      if (s.latitude != null && s.longitude != null) {
        add(s.longitude, s.latitude, String(s.seq), 'route-pin', `${s.seq}. ${s.name}`);
        markers.current.at(-1)!.getElement().style.background = COLOR[s.status] ?? COLOR.PENDING;
      }
      if (s.pod.latitude != null && s.pod.longitude != null)
        add(s.pod.longitude, s.pod.latitude, '', 'route-pod', `Delivered here: ${s.name}`);
    }
    const line = geometry
      ? decodePolyline(geometry).map((p) => [p.lng, p.lat] as [number, number])
      : [];
    onStyleReady(
      m,
      () => {
        const data: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: line },
        };
        const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else {
          m.addSource('route', { type: 'geojson', data });
          m.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.75 },
          });
        }
      },
      'route',
    );
    const all = [...pts, ...line];
    if (all.length) {
      const b = all.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(all[0], all[0]));
      m.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
    }
  }, [depot, stops, geometry]);

  return <div ref={el} className="route-map" />;
}
