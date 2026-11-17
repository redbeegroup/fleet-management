/** Stock arithmetic for a part in one store: moving average cost (pure). */

export interface StockState {
  qty: number;
  avgCost: number;
}

export class StockError extends Error {}

const q2 = (n: number) => Math.round(n * 100) / 100;
const c4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const money = (n: number) => Math.round(n * 100) / 100;

/** Goods in at a purchase price: the average cost is re-weighted. */
export function receive(s: StockState, qty: number, unitCost: number): StockState {
  if (!(qty > 0)) throw new StockError('Quantity must be positive');
  if (unitCost < 0) throw new StockError('Unit cost cannot be negative');
  const newQty = q2(s.qty + qty);
  // With nothing (or less than nothing) on hand, the new price is the average.
  const avg = s.qty <= 0 ? unitCost : (s.qty * s.avgCost + qty * unitCost) / newQty;
  return { qty: newQty, avgCost: c4(avg) };
}

/** Goods out (issue to a work order, transfer out) at the current average; never below zero. */
export function issue(s: StockState, qty: number): { state: StockState; unitCost: number; value: number } {
  if (!(qty > 0)) throw new StockError('Quantity must be positive');
  if (qty > s.qty + 1e-9) throw new StockError(`Only ${q2(s.qty)} in stock`);
  return { state: { qty: q2(s.qty - qty), avgCost: s.avgCost }, unitCost: s.avgCost, value: money(qty * s.avgCost) };
}

/** Goods back into the store (line removed from a work order) at the cost they left with. */
export function giveBack(s: StockState, qty: number, unitCost: number): StockState {
  return receive(s, qty, unitCost);
}

/** Stock count: the difference is booked at the current average cost. */
export function count(s: StockState, countedQty: number): { state: StockState; diff: number; value: number } {
  if (countedQty < 0) throw new StockError('Counted quantity cannot be negative');
  const diff = q2(countedQty - s.qty);
  return { state: { qty: q2(countedQty), avgCost: s.avgCost }, diff, value: money(diff * s.avgCost) };
}

/** Reorder suggestion: at or below the minimum, order the reorder quantity (at least up to the minimum). */
export function reorderSuggestion(onHand: number, minQty: number, reorderQty: number): number | null {
  if (minQty <= 0 || onHand > minQty) return null;
  return q2(Math.max(reorderQty, minQty - onHand + (reorderQty > 0 ? 0 : 1)));
}
