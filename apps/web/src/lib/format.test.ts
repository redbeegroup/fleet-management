import { describe, expect, it } from 'vitest';
import { daysUntil, expiryTone, humanize } from './format';

describe('format helpers', () => {
  it('computes days until a date', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(daysUntil('2026-01-11T00:00:00Z', now)).toBe(10);
    expect(daysUntil(null, now)).toBeNull();
  });
  it('maps days to tones', () => {
    expect(expiryTone(-1)).toBe('danger');
    expect(expiryTone(10)).toBe('warn');
    expect(expiryTone(90)).toBe('ok');
    expect(expiryTone(null)).toBe('muted');
  });
  it('humanizes enum values', () => {
    expect(humanize('UNDER_REPAIR')).toBe('Under repair');
  });
});
