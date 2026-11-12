import type maplibregl from 'maplibre-gl';
import type { Geofence } from './types';

export const OSM_STYLE: maplibregl.StyleSpecification = {
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

export const YANGON: [number, number] = [96.17, 16.84];

/** Approximates a circle as a 64-gon in [lng, lat]. */
export function circleRing(lat: number, lng: number, radiusM: number, steps = 64): [number, number][] {
  const R = 6_371_008.8;
  const d = radiusM / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return ring;
}

export function fenceRing(g: Pick<Geofence, 'shape' | 'centerLat' | 'centerLng' | 'radiusM' | 'polygon'>): [number, number][] | null {
  if (g.shape === 'CIRCLE' && g.centerLat != null && g.centerLng != null && g.radiusM != null) {
    return circleRing(g.centerLat, g.centerLng, g.radiusM);
  }
  if (g.shape === 'POLYGON' && g.polygon && g.polygon.length >= 3) return [...g.polygon, g.polygon[0]];
  return null;
}

export function fencesGeoJSON(fences: Geofence[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fences.flatMap((g) => {
      const ring = fenceRing(g);
      return ring
        ? [{ type: 'Feature' as const, properties: { id: g.id, name: g.name, active: g.active }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }]
        : [];
    }),
  };
}

/** Adds (or updates) a fill+outline layer pair for geofences. Call after the map style loads. */
export function showFences(map: maplibregl.Map, fences: Geofence[], id = 'fences') {
  const data = fencesGeoJSON(fences);
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(id, { type: 'geojson', data });
  map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#1f5fbf', 'fill-opacity': 0.12 } });
  map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': '#1f5fbf', 'line-width': 2, 'line-dasharray': [2, 1] } });
  // No text labels: they need a glyph server; names are shown in popups/lists instead.
}

/**
 * Runs `fn` once the style can accept sources/layers. `isStyleLoaded()` can be
 * false while tiles are still loading even after 'load' has fired, so fall back
 * to the next 'idle' instead of waiting for a 'load' that will never come again.
 */
const pending = new WeakMap<maplibregl.Map, Map<string, () => void>>();

export function onStyleReady(map: maplibregl.Map, fn: () => void, key = 'default') {
  if (map.isStyleLoaded()) {
    pending.get(map)?.delete(key); // a newer update supersedes any queued one
    fn();
    return;
  }
  let queue = pending.get(map);
  if (!queue) {
    queue = new Map();
    pending.set(map, queue);
  }
  const first = queue.size === 0;
  queue.set(key, fn); // keep only the latest callback per key
  if (first) {
    map.once('idle', () => {
      const fns = [...(pending.get(map)?.values() ?? [])];
      pending.get(map)?.clear();
      fns.forEach((f) => f());
    });
  }
}
