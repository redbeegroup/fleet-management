import { describe, expect, it } from 'vitest';
import { circleRing, fenceRing } from './map';

describe('map helpers', () => {
  it('builds a closed circle ring of the right radius', () => {
    const ring = circleRing(16.8, 96.15, 1000, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    // North point is ~1 km away → ~0.009° latitude
    expect(ring[0][1] - 16.8).toBeCloseTo(0.00899, 4);
  });
  it('closes polygons and rejects incomplete shapes', () => {
    const poly: [number, number][] = [[1, 1], [2, 1], [2, 2]];
    expect(fenceRing({ shape: 'POLYGON', polygon: poly, centerLat: null, centerLng: null, radiusM: null })).toHaveLength(4);
    expect(fenceRing({ shape: 'CIRCLE', polygon: null, centerLat: 1, centerLng: null, radiusM: 5 })).toBeNull();
  });
});
