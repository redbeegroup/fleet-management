import { expiryBucket, latestPerGroup } from './compliance-alerts.job';

const now = new Date('2026-06-01T00:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

describe('expiryBucket', () => {
  it.each([
    [-3, 'expired', 'critical'],
    [0, '1d', 'critical'],
    [1, '1d', 'critical'],
    [5, '7d', 'warning'],
    [14, '14d', 'warning'],
    [25, '30d', 'info'],
  ])('%i days → %s / %s', (days, bucket, severity) => {
    expect(expiryBucket(inDays(days), now)).toMatchObject({ bucket, severity });
  });
});

describe('latestPerGroup', () => {
  it('keeps the latest expiry per key so renewals suppress old alerts', () => {
    const items = [
      { id: 'old', k: 'v1:INS', expiresAt: inDays(3) },
      { id: 'renewed', k: 'v1:INS', expiresAt: inDays(365) },
      { id: 'other', k: 'v2:INS', expiresAt: inDays(5) },
    ];
    expect(latestPerGroup(items, (i) => i.k).map((i) => i.id).sort()).toEqual(['other', 'renewed']);
  });
});
