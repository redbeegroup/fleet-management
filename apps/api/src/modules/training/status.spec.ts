import { addMonths, trainingStatus } from './status';

describe('training status', () => {
  it('adds months clamped to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-12', 24)).toBe('2028-11-12');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
  it('uses the record with the latest expiry', () => {
    const today = '2026-11-12';
    expect(trainingStatus([], today, 30).status).toBe('MISSING');
    expect(trainingStatus([{ completedAt: '2024-01-01', expiresAt: '2026-01-01' }], today, 30).status).toBe('EXPIRED');
    expect(trainingStatus([{ completedAt: '2024-01-01', expiresAt: '2026-12-01' }], today, 30).status).toBe('EXPIRING');
    expect(
      trainingStatus(
        [
          { completedAt: '2024-01-01', expiresAt: '2026-01-01' },
          { completedAt: '2026-06-01', expiresAt: '2028-06-01' },
        ],
        today,
        30,
      ),
    ).toEqual({ status: 'VALID', expiresAt: '2028-06-01', completedAt: '2026-06-01' });
    expect(trainingStatus([{ completedAt: '2020-01-01', expiresAt: null }, { completedAt: '2026-01-01', expiresAt: '2026-01-02' }], today, 30).status).toBe('VALID');
  });
});
