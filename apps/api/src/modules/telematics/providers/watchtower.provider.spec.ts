import { WatchTowerProvider } from './watchtower.provider';

describe('WatchTowerProvider', () => {
  it('maps common field aliases', () => {
    const fix = WatchTowerProvider.toFix({
      imei: '123',
      fixTime: '2026-11-12T00:00:00Z',
      lat: 16.8,
      lng: 96.1,
      speed: 42,
      course: 90,
      ignition: true,
    });
    expect(fix).toEqual(
      expect.objectContaining({ deviceId: '123', latitude: 16.8, longitude: 96.1, speedKmh: 42, heading: 90, ignition: true }),
    );
    expect(fix?.recordedAt.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });

  it('rejects malformed rows', () => {
    expect(WatchTowerProvider.toFix({ deviceId: 'a', timestamp: 'bad', lat: 1, lng: 1 })).toBeNull();
    expect(WatchTowerProvider.toFix({ deviceId: 'a', timestamp: '2026-01-01T00:00:00Z', lat: 100, lng: 1 })).toBeNull();
    expect(WatchTowerProvider.toFix({ timestamp: '2026-01-01T00:00:00Z', lat: 1, lng: 1 })).toBeNull();
  });

  it('fetches and parses a wrapped response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ deviceId: 'WT-1', timestamp: '2026-11-12T00:00:00Z', latitude: 1, longitude: 2 }, {}] }),
    });
    const provider = new WatchTowerProvider('https://wt.example', 'key', fetchImpl as unknown as typeof fetch);
    const fixes = await provider.fetchPositions(new Date('2026-11-11T00:00:00Z'));
    expect(fixes).toHaveLength(1);
    const url = fetchImpl.mock.calls[0][0] as URL;
    expect(url.searchParams.get('since')).toBe('2026-11-11T00:00:00.000Z');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer key');
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const provider = new WatchTowerProvider('https://wt.example', 'key', fetchImpl as unknown as typeof fetch);
    await expect(provider.fetchPositions()).rejects.toThrow('503');
  });
});

describe('WatchTowerProvider contract (recorded payload)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const payload = require('./__fixtures__/watchtower-positions.json');

  it('maps every valid row and skips malformed ones', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const fixes = await new WatchTowerProvider('https://wt', 'k', fetchImpl as unknown as typeof fetch).fetchPositions();
    expect(fixes.map((f) => f.deviceId)).toEqual(['WT-0001', '861234567890123']);
    expect(fixes[0]).toMatchObject({ speedKmh: 42.5, heading: 187, altitudeM: 12, ignition: true, odometerKm: 25412.3 });
    expect(fixes[1]).toMatchObject({ latitude: 21.9588, longitude: 96.0891, ignition: false });
  });
});
