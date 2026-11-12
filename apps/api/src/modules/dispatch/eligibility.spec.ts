import { dispatchSettingsSchema } from '@fms/shared';
import { blocks, checkLicence, licenceClasses } from './eligibility';

const settings = dispatchSettingsSchema.parse({});
const end = new Date('2026-06-01T12:00:00Z');

describe('licenceClasses', () => {
  it.each([
    ['E', ['E']],
    ['b/e', ['B', 'E']],
    ['B, E', ['B', 'E']],
    ['BE', ['B', 'E']],
    ['UNSPECIFIED', ['UNSPECIFIED']],
  ])('%s', (raw, out) => expect(licenceClasses(raw)).toEqual(out));
});

describe('checkLicence', () => {
  it('requires a licence', () => {
    expect(checkLicence('CAR', [], end, settings).ok).toBe(false);
  });
  it('requires validity through the end of the trip', () => {
    const r = checkLicence('CAR', [{ licenseClass: 'B', expiresAt: new Date('2026-06-01T00:00:00Z') }], end, settings);
    expect(r).toEqual({ ok: false, reasons: ['Driving licence expires before the trip ends'] });
  });
  it('enforces class rules for heavy vehicles', () => {
    expect(checkLicence('TRUCK', [{ licenseClass: 'B', expiresAt: null }], end, settings).ok).toBe(false);
    expect(checkLicence('TRUCK', [{ licenseClass: 'B/E', expiresAt: null }], end, settings).ok).toBe(true);
    expect(checkLicence('VAN', [{ licenseClass: 'B', expiresAt: null }], end, settings).ok).toBe(true); // no rule
  });
  it('ignores expired licences when checking class', () => {
    const r = checkLicence('TRUCK', [
      { licenseClass: 'E', expiresAt: new Date('2025-01-01') },
      { licenseClass: 'B', expiresAt: null },
    ], end, settings);
    expect(r.ok).toBe(false);
  });
  it('can be relaxed per company', () => {
    expect(checkLicence('TRUCK', [{ licenseClass: 'B', expiresAt: null }], end, { ...settings, enforceLicenceClass: false }).ok).toBe(true);
  });
});

describe('blocks', () => {
  const t = (status: string, s: string, e: string) => ({ id: '1', tripNo: 'T', status, plannedStart: new Date(s), plannedEnd: new Date(e) });
  const from = new Date('2026-06-01T10:00:00Z');
  const to = new Date('2026-06-01T12:00:00Z');
  it('detects overlap of planned/assigned trips (half-open)', () => {
    expect(blocks(t('ASSIGNED', '2026-06-01T11:00:00Z', '2026-06-01T13:00:00Z'), from, to)).toBe(true);
    expect(blocks(t('PLANNED', '2026-06-01T12:00:00Z', '2026-06-01T13:00:00Z'), from, to)).toBe(false);
    expect(blocks(t('ASSIGNED', '2026-06-01T08:00:00Z', '2026-06-01T10:00:00Z'), from, to)).toBe(false);
  });
  it('ongoing trips block until completed even when overrunning', () => {
    expect(blocks(t('ONGOING', '2026-06-01T06:00:00Z', '2026-06-01T08:00:00Z'), from, to)).toBe(true);
  });
  it('finished trips never block', () => {
    expect(blocks(t('COMPLETED', '2026-06-01T11:00:00Z', '2026-06-01T13:00:00Z'), from, to)).toBe(false);
    expect(blocks(t('CANCELLED', '2026-06-01T11:00:00Z', '2026-06-01T13:00:00Z'), from, to)).toBe(false);
  });
});
