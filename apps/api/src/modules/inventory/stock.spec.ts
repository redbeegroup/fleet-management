import { count, giveBack, issue, receive, reorderSuggestion, StockError } from './stock';

describe('stock (moving average)', () => {
  it('re-weights the average on receipts', () => {
    let s = receive({ qty: 0, avgCost: 0 }, 10, 100);
    expect(s).toEqual({ qty: 10, avgCost: 100 });
    s = receive(s, 10, 130);
    expect(s).toEqual({ qty: 20, avgCost: 115 });
    expect(() => receive(s, 0, 1)).toThrow(StockError);
  });

  it('issues at the average and never below zero', () => {
    const r = issue({ qty: 20, avgCost: 115 }, 3);
    expect(r).toEqual({ state: { qty: 17, avgCost: 115 }, unitCost: 115, value: 345 });
    expect(() => issue({ qty: 2, avgCost: 10 }, 3)).toThrow(/Only 2 in stock/);
  });

  it('returns goods at their issue cost; counts book the difference', () => {
    expect(giveBack({ qty: 0, avgCost: 115 }, 3, 115)).toEqual({ qty: 3, avgCost: 115 });
    expect(giveBack({ qty: 5, avgCost: 100 }, 5, 120)).toEqual({ qty: 10, avgCost: 110 });
    expect(count({ qty: 10, avgCost: 50 }, 8)).toEqual({ state: { qty: 8, avgCost: 50 }, diff: -2, value: -100 });
  });

  it('suggests reorders at or below the minimum', () => {
    expect(reorderSuggestion(5, 4, 10)).toBeNull();
    expect(reorderSuggestion(4, 4, 10)).toBe(10);
    expect(reorderSuggestion(0, 6, 0)).toBe(7);
    expect(reorderSuggestion(0, 0, 10)).toBeNull();
  });
});
