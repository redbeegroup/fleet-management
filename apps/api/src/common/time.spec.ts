import { dayBounds, localDate, tzOffsetMs } from './time';

describe('time helpers', () => {
  it('knows Yangon is UTC+6:30', () => {
    expect(tzOffsetMs('Asia/Yangon', new Date('2026-06-01T00:00:00Z'))).toBe(6.5 * 3_600_000);
  });
  it('computes local day bounds', () => {
    const b = dayBounds('2026-06-01', 'Asia/Yangon');
    expect(b.start.toISOString()).toBe('2026-05-31T17:30:00.000Z');
    expect(b.end.toISOString()).toBe('2026-06-01T17:30:00.000Z');
  });
  it('handles DST days (23h)', () => {
    const b = dayBounds('2026-03-08', 'America/New_York');
    expect((b.end.getTime() - b.start.getTime()) / 3_600_000).toBe(23);
  });
  it('maps instants to local dates', () => {
    expect(localDate(new Date('2026-05-31T18:00:00Z'), 'Asia/Yangon')).toBe('2026-06-01');
  });
});
