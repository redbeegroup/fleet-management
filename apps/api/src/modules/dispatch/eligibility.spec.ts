import { dispatchSettingsSchema } from '@fms/shared';
import { blocks, checkLicence, licenceClasses } from './eligibility';

const settings = dispatchSettingsSchema.parse({});
const end = new Date('2026-06-01T12:00:00Z');

describe('licenceClasses', () => {
  it.each([
    ['E', ['E']],
    ['b/e', ['B', 'E']],
    ['B, E', ['B', 'E']],
    ['ခ, င', ['B', 'E']],
    ['TR', ['TR']], // not split into T + R
    ['ဟ', ['TW']],
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
  it('enforces the Myanmar commercial rules', () => {
    const ok = (cls: string, lic: string) => checkLicence(cls, [{ licenseClass: lic, expiresAt: null }], end, settings).ok;
    expect(ok('TRUCK', 'D')).toBe(false);
    expect(ok('TRUCK', 'E')).toBe(true);
    expect(ok('VAN', 'B')).toBe(false); // private licence is not enough for a company van
    expect(ok('VAN', 'ဃ')).toBe(true);
    expect(ok('MOTORCYCLE', 'A')).toBe(true);
    expect(ok('THREE_WHEELER', 'TW')).toBe(true);
    expect(ok('TRACTOR', 'TR')).toBe(true);
    expect(ok('TRACTOR', 'E')).toBe(false);
    expect(ok('MACHINERY', 'C')).toBe(true);
    expect(checkLicence('VAN', [{ licenseClass: 'B', expiresAt: null }], end, settings).reasons[0]).toMatch(/requires licence class ဃ \(D\) or င \(E\)/);
  });
  it('never accepts learner or conductor permits', () => {
    expect(checkLicence('OTHER', [{ licenseClass: 'T', expiresAt: null }], end, { ...settings, enforceLicenceClass: false })).toEqual({
      ok: false,
      reasons: ['Driver holds only a learner/conductor permit'],
    });
    expect(checkLicence('VAN', [{ licenseClass: 'CO/E', expiresAt: null }], end, settings).ok).toBe(true);
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
    expect(checkLicence('VAN', [{ licenseClass: 'B', expiresAt: null }], end, { ...settings, licenceRules: { ...settings.licenceRules, VAN: [] } }).ok).toBe(true);
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
