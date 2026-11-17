import { garagePerformance } from './garages';

const t = (s: string) => new Date(`${s}Z`);

describe('garage performance', () => {
  it('cost, turnaround, repeat repairs, invoice vs quote, recovered', () => {
    const r = garagePerformance(
      [
        { supplierId: 'g1', vehicleId: 'v1', openedAt: t('2026-01-01T08:00:00'), completedAt: t('2026-01-02T08:00:00'), totalCost: 100, quoteAmount: 100, invoiceAmount: 110 },
        { supplierId: 'g1', vehicleId: 'v2', openedAt: t('2026-01-05T08:00:00'), completedAt: t('2026-01-05T20:00:00'), totalCost: 300, quoteAmount: null, invoiceAmount: 300 },
        // v1 back within 30 days (at another garage): a repeat for g1
        { supplierId: 'g2', vehicleId: 'v1', openedAt: t('2026-01-20T08:00:00'), completedAt: t('2026-01-21T08:00:00'), totalCost: 50, quoteAmount: 60, invoiceAmount: 48 },
        { supplierId: 'g2', vehicleId: 'v3', openedAt: t('2026-02-01T08:00:00'), completedAt: null, totalCost: 0, quoteAmount: null, invoiceAmount: null },
      ],
      new Map([['g1', 40]]),
    );
    expect(r.find((x) => x.supplierId === 'g1')).toEqual({ supplierId: 'g1', jobs: 2, cost: 400, avgCost: 200, avgTurnaroundHours: 18, repeatRepairs: 1, repeatPct: 50, invoiceVsQuotePct: 10, warrantyRecovered: 40 });
    expect(r.find((x) => x.supplierId === 'g2')).toMatchObject({ jobs: 1, repeatRepairs: 0, invoiceVsQuotePct: -20 });
  });
});

describe('garage performance period', () => {
  it('rates jobs finished in the period; later jobs still count as repeats', () => {
    const r = garagePerformance(
      [
        { supplierId: 'g1', vehicleId: 'v1', openedAt: t('2026-01-25T08:00:00'), completedAt: t('2026-01-30T08:00:00'), totalCost: 100, quoteAmount: null, invoiceAmount: null },
        { supplierId: 'g1', vehicleId: 'v1', openedAt: t('2026-02-10T08:00:00'), completedAt: t('2026-02-11T08:00:00'), totalCost: 100, quoteAmount: null, invoiceAmount: null },
      ],
      new Map(),
      { from: t('2026-01-01T00:00:00'), to: t('2026-02-01T00:00:00') },
    );
    expect(r).toEqual([expect.objectContaining({ supplierId: 'g1', jobs: 1, repeatRepairs: 1 })]);
  });
});
