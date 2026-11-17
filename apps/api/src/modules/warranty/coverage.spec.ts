import { CLAIM_FLOW, coverage, partWarrantyEnd } from './coverage';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('warranty coverage', () => {
  const data = {
    warranties: [
      { id: 'w1', component: 'WHOLE_VEHICLE', startDate: d('2025-01-01'), endDate: d('2027-01-01'), endKm: 100_000 },
      { id: 'w2', component: 'BATTERY', startDate: d('2025-01-01'), endDate: d('2026-01-01') },
      { id: 'w3', component: 'ENGINE', startDate: d('2025-01-01'), endKm: 200_000 },
    ],
    parts: [
      { lineId: 'l1', woNo: 'WO-1', partId: 'p-alt', partNo: 'ALT-12', partName: 'Alternator 24V', fittedAt: d('2026-03-01'), ...partWarrantyEnd(d('2026-03-01'), 50_000, 12, 30_000) },
      { lineId: 'l2', woNo: 'WO-2', partId: 'p-flt', partNo: 'OF-1', partName: 'Oil filter', fittedAt: d('2026-03-01') },
    ],
    tires: [{ changeId: 't1', position: '1L', brand: 'Maxxis', fittedAt: d('2026-01-01'), fitOdometerKm: 40_000, warrantyMonths: 24, warrantyKm: 60_000 }],
  };

  it('lists active warranties, relevant ones first', () => {
    const c = coverage(d('2026-06-01'), 60_000, data, { text: 'Engine overheating, check radiator' });
    expect(c.map((x) => `${x.basis}:${x.ref}:${x.relevant}`)).toEqual(['VEHICLE:w1:true', 'VEHICLE:w3:true', 'PART:l1:false', 'TIRE:t1:false']);
  });

  it('matches replaced parts and tire positions; respects km and date limits', () => {
    const c = coverage(d('2026-06-01'), 85_000, data, { partIds: ['p-alt'], positions: ['1L'] });
    expect(c.find((x) => x.ref === 'l1')).toBeUndefined(); // 85,000 > 50,000 + 30,000
    expect(c.find((x) => x.ref === 't1')!.relevant).toBe(true);
    expect(coverage(d('2026-06-01'), 60_000, data, { text: 'alternator not charging' }).find((x) => x.ref === 'l1')!.relevant).toBe(true);
    expect(coverage(d('2027-06-01'), 60_000, data).map((x) => x.ref)).toEqual(['t1', 'w3']);
  });

  it('claim workflow', () => {
    expect(CLAIM_FLOW.DRAFT.SUBMIT).toBe('SUBMITTED');
    expect(CLAIM_FLOW.SUBMITTED.RECOVER).toBeUndefined();
    expect(CLAIM_FLOW.APPROVED.RECOVER).toBe('RECOVERED');
  });
});
