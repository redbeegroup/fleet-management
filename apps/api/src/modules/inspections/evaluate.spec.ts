import { evaluateInspection, preTripBlock } from './evaluate';

const checklist = [
  { key: 'brakes', label: 'Brakes', critical: true },
  { key: 'wipers', label: 'Wipers', critical: false },
];

describe('evaluateInspection', () => {
  it('passes when everything is OK', () => {
    const r = evaluateInspection(checklist, [{ key: 'brakes', ok: true }, { key: 'wipers', ok: true }]);
    expect(r).toMatchObject({ result: 'PASS', defects: 0, criticalDefects: 0 });
  });
  it('reports non-critical defects and fails on critical ones', () => {
    expect(evaluateInspection(checklist, [{ key: 'brakes', ok: true }, { key: 'wipers', ok: false, note: 'torn' }])).toMatchObject({ result: 'DEFECTS', defects: 1 });
    expect(evaluateInspection(checklist, [{ key: 'brakes', ok: false, note: 'soft pedal' }, { key: 'wipers', ok: false, note: 'torn' }])).toMatchObject({
      result: 'FAIL',
      defects: 2,
      criticalDefects: 1,
    });
  });
  it('rejects missing, unknown, duplicate answers and undescribed defects', () => {
    const r = evaluateInspection(checklist, [{ key: 'wipers', ok: false }, { key: 'wipers', ok: true }, { key: 'radio', ok: true }]);
    expect('errors' in r && r.errors.sort()).toEqual(['brakes: not answered', 'radio: not on this checklist', 'wipers: answered twice'].sort());
    const r2 = evaluateInspection(checklist, [{ key: 'brakes', ok: false, note: '  ' }, { key: 'wipers', ok: true }]);
    expect('errors' in r2 && r2.errors).toEqual(['brakes: describe the defect or add a photo']);
    const r3 = evaluateInspection(checklist, [{ key: 'brakes', ok: false, photoFileId: '6f1c3f4e-6c1a-4e43-8d1f-0f1c2b3a4d5e' }, { key: 'wipers', ok: true }]);
    expect(r3).toMatchObject({ result: 'FAIL' });
  });
});

describe('preTripBlock', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  it('requires a recent inspection that did not fail', () => {
    expect(preTripBlock(null, now, 12)).toMatch(/required/);
    expect(preTripBlock({ performedAt: new Date('2026-11-11T21:00:00Z'), result: 'PASS', inspectionNo: 'I1' }, now, 12)).toMatch(/required/);
    expect(preTripBlock({ performedAt: new Date('2026-11-12T08:00:00Z'), result: 'FAIL', inspectionNo: 'I2' }, now, 12)).toMatch(/I2 failed/);
    expect(preTripBlock({ performedAt: new Date('2026-11-12T08:00:00Z'), result: 'DEFECTS', inspectionNo: 'I3' }, now, 12)).toBeNull();
  });
});

describe('numeric (tire) items', () => {
  const items = [
    { key: 'tread_1l', label: 'Tread 1L', critical: true, type: 'number' as const, unit: 'mm', min: 3, tirePosition: '1L', measure: 'TREAD' as const },
    { key: 'press_1l', label: 'Pressure 1L', critical: false, type: 'number' as const, unit: 'psi', min: 90, max: 110, tirePosition: '1L', measure: 'PRESSURE' as const },
  ];
  it('decides ok from min/max and requires a value', () => {
    const r = evaluateInspection(items, [
      { key: 'tread_1l', ok: true, value: 2.5 },
      { key: 'press_1l', ok: false, value: 100 },
    ]);
    if ('errors' in r) throw new Error(r.errors.join());
    expect(r.items.map((i) => [i.key, i.ok, i.note])).toEqual([
      ['tread_1l', false, '2.5 mm is below 3'],
      ['press_1l', true, null],
    ]);
    expect(r.result).toBe('FAIL');
    expect(evaluateInspection(items, [{ key: 'tread_1l', ok: true }, { key: 'press_1l', ok: true, value: 95 }])).toEqual({ errors: ['tread_1l: enter a value'] });
  });
});
