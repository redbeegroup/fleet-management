import { aggregatePosting, isBalanced, journalItems, matchInvoice, matchReceipt } from './posting';

const vehicles = new Map([
  ['v1', { costCenter: 'CC100', sapAssetNo: null, plate: 'A' }],
  ['v2', { costCenter: null, sapAssetNo: '200001', plate: 'B' }],
]);
const s = { glAccounts: { FUEL: '610100', MAINTENANCE: '610200', default: '619900' }, defaultCostCenter: 'CC900', offsetAccount: '219000' };

describe('aggregatePosting', () => {
  it('groups by cost centre and GL, skips depreciation of SAP assets, balances', () => {
    const p = aggregatePosting(
      [
        { vehicleId: 'v1', category: 'FUEL', amount: 100 },
        { vehicleId: 'v1', category: 'FUEL', amount: 50.555 },
        { vehicleId: 'v2', category: 'FUEL', amount: 40 },
        { vehicleId: 'v2', category: 'DEPRECIATION', amount: 500 },
        { vehicleId: 'v1', category: 'DEPRECIATION', amount: 300 },
        { vehicleId: 'v1', category: 'MAINTENANCE', amount: -20 },
        { vehicleId: null, category: 'SHARED', amount: 10 },
      ],
      vehicles,
      s,
    );
    expect(p.errors).toEqual([]);
    expect(p.skippedDepreciation).toBe(500);
    expect(p.lines).toEqual([
      { costCenter: 'CC100', glAccount: '610100', category: 'FUEL', vehicles: 1, amount: 150.56 },
      { costCenter: 'CC100', glAccount: '610200', category: 'MAINTENANCE', vehicles: 1, amount: -20 },
      { costCenter: 'CC100', glAccount: '619900', category: 'DEPRECIATION', vehicles: 1, amount: 300 },
      { costCenter: 'CC900', glAccount: '610100', category: 'FUEL', vehicles: 1, amount: 40 },
      { costCenter: 'CC900', glAccount: '619900', category: 'SHARED', vehicles: 0, amount: 10 },
    ]);
    expect(p.total).toBe(480.56);
    const j = journalItems(p.lines, s.offsetAccount, '2026-10');
    expect(isBalanced(j)).toBe(true);
    expect(j.find((i) => i.glAccount === '219000')).toMatchObject({ amount: 480.56, side: 'H' });
    expect(j.find((i) => i.glAccount === '610200')).toMatchObject({ amount: 20, side: 'H' });
  });
  it('reports missing mappings instead of guessing', () => {
    const p = aggregatePosting([{ vehicleId: 'v2', category: 'FUEL', amount: 1 }], vehicles, { glAccounts: {}, defaultCostCenter: '', offsetAccount: '' });
    expect(p.errors).toEqual(['B: no cost centre (set it on the department or a default cost centre)', 'No GL account for FUEL', 'No offset (credit) account']);
    expect(p.lines).toEqual([]);
  });
});

describe('PO matching', () => {
  const po = [
    { item: '10', material: 'M1', quantity: 10, netPrice: 100 },
    { item: '20', material: 'M2', quantity: 2, netPrice: 50 },
  ];
  it('flags unknown materials, over-delivery and price differences beyond the tolerance', () => {
    expect(
      matchReceipt(
        po,
        [
          { partNo: 'P1', material: 'M1', qty: 10, unitCost: 101 },
          { partNo: 'P2', material: 'M2', qty: 3, unitCost: 60 },
          { partNo: 'P3', material: 'M9', qty: 1, unitCost: 1 },
          { partNo: 'P4', material: null, qty: 1, unitCost: 1 },
        ],
        2,
      ).map((i) => `${i.partNo}:${i.issue}`),
    ).toEqual(['P2:QTY_OVER', 'P2:PRICE', 'P3:NOT_ON_PO', 'P4:NOT_ON_PO']);
  });
  it('checks the invoice against the PO value', () => {
    expect(matchInvoice(100_000, 101_500, 2)).toEqual({ ok: true, diff: 1_500, diffPct: 1.5 });
    expect(matchInvoice(100_000, 110_000, 2)).toEqual({ ok: false, diff: 10_000, diffPct: 10 });
  });
});
