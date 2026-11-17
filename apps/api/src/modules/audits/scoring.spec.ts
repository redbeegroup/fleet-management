import { DEFAULT_AUDITS, scoreAudit } from './scoring';

const q = [
  { key: 'a', section: 'S', label: 'A', weight: 3, critical: true },
  { key: 'b', section: 'S', label: 'B', weight: 1, critical: false },
  { key: 'c', section: 'S', label: 'C', weight: 1, critical: false },
];

describe('audit scoring', () => {
  it('weights, NA excluded, pass mark and critical failures', () => {
    const r = scoreAudit(q, [{ key: 'a', result: 'PASS' }, { key: 'b', result: 'FAIL', note: 'x' }, { key: 'c', result: 'NA' }], 80);
    if ('errors' in r) throw new Error();
    expect(r).toMatchObject({ score: 75, result: 'NEEDS_ACTION' });
    expect(r.findings.map((f) => f.key)).toEqual(['b']);
    const crit = scoreAudit(q, [{ key: 'a', result: 'FAIL', note: 'worn' }, { key: 'b', result: 'PASS' }, { key: 'c', result: 'PASS' }], 20);
    expect(crit).toMatchObject({ score: 40, result: 'FAIL' });
    const ok = scoreAudit(q, [{ key: 'a', result: 'PASS' }, { key: 'b', result: 'PASS' }, { key: 'c', result: 'NA' }], 80);
    expect(ok).toMatchObject({ score: 100, result: 'PASS' });
  });
  it('validates answers', () => {
    expect(scoreAudit(q, [{ key: 'a', result: 'FAIL' }, { key: 'x', result: 'PASS' }], 80)).toEqual({ errors: ['x: not in this audit', 'a: describe the finding or add a photo', 'b: not answered', 'c: not answered'] });
  });
  it('starter templates have unique keys', () => {
    for (const t of DEFAULT_AUDITS) expect(new Set(t.questions.map((x) => x.key)).size).toBe(t.questions.length);
  });
});
