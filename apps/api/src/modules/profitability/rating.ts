/** Freight rating from rate cards (pure). */

export interface CardLike {
  id: string;
  customerId: string | null;
  vehicleClass: string | null;
  branchId: string | null;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  priority: number;
  perTrip: number;
  perKm: number;
  perKg: number;
  perDrop: number;
  perPallet: number;
  minCharge: number;
  fuelSurchargePct: number;
  waitingPerHour: number;
  freeWaitMinutes: number;
}

export interface RateBasis {
  km: number;
  kg: number;
  drops: number;
  pallets: number;
  waitMinutes: number;
  /** Share of the trip this basis stands for (1 for a whole trip). */
  share: number;
}

export interface Rated {
  amount: number;
  breakdown: { trip: number; km: number; kg: number; drops: number; pallets: number; waiting: number; surcharge: number; minimumTopUp: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The most specific valid card: customer (4) + vehicle class (2) + branch (1) must match when set;
 * ties go to the higher priority, then the most recent start.
 */
export function pickCard<C extends CardLike>(cards: C[], q: { customerId: string | null; vehicleClass: string | null; branchId: string | null; date: Date }): C | null {
  const d = day(q.date);
  const ok = cards.filter(
    (c) =>
      c.active &&
      day(c.validFrom) <= d &&
      (!c.validTo || day(c.validTo) >= d) &&
      (!c.customerId || c.customerId === q.customerId) &&
      (!c.vehicleClass || c.vehicleClass === q.vehicleClass) &&
      (!c.branchId || c.branchId === q.branchId),
  );
  const spec = (c: CardLike) => (c.customerId ? 4 : 0) + (c.vehicleClass ? 2 : 0) + (c.branchId ? 1 : 0);
  ok.sort((a, b) => spec(b) - spec(a) || b.priority - a.priority || b.validFrom.getTime() - a.validFrom.getTime());
  return ok[0] ?? null;
}

/** Charges of one basis; the per-trip charge and the minimum are taken in proportion to the share. */
export function rate(c: CardLike, b: RateBasis): Rated {
  const trip = r2(c.perTrip * b.share);
  const km = r2(c.perKm * b.km);
  const kg = r2(c.perKg * b.kg);
  const drops = r2(c.perDrop * b.drops);
  const pallets = r2(c.perPallet * b.pallets);
  const waiting = r2((Math.max(0, b.waitMinutes - c.freeWaitMinutes) / 60) * c.waitingPerHour);
  const sub = trip + km + kg + drops + pallets + waiting;
  const surcharge = r2((sub * c.fuelSurchargePct) / 100);
  const min = r2(c.minCharge * b.share);
  const minimumTopUp = sub + surcharge < min ? r2(min - sub - surcharge) : 0;
  return { amount: r2(sub + surcharge + minimumTopUp), breakdown: { trip, km, kg, drops, pallets, waiting, surcharge, minimumTopUp } };
}

export interface StopLoad {
  customerId: string | null;
  kg: number;
  pallets: number;
  waitMinutes: number;
}

/**
 * Splits a multi-stop trip by customer. Each stop is one drop; the trip km and the shared charges
 * follow the weight share (drop share when nothing was weighed).
 */
export function splitTrip(stops: StopLoad[], km: number): (Omit<RateBasis, 'share'> & { customerId: string | null; share: number })[] {
  const by = new Map<string | null, { kg: number; drops: number; pallets: number; waitMinutes: number }>();
  for (const s of stops) {
    const x = by.get(s.customerId) ?? { kg: 0, drops: 0, pallets: 0, waitMinutes: 0 };
    x.kg += s.kg;
    x.drops += 1;
    x.pallets += s.pallets;
    x.waitMinutes += s.waitMinutes;
    by.set(s.customerId, x);
  }
  const totalKg = stops.reduce((a, s) => a + s.kg, 0);
  const rows = [...by.entries()].map(([customerId, x]) => ({ customerId, ...x, share: totalKg > 0 ? x.kg / totalKg : x.drops / stops.length }));
  // Shares rounded to 4 dp; the last customer takes the remainder so the shares add up to 1.
  let used = 0;
  return rows.map((x, i) => {
    const share = i === rows.length - 1 ? Math.round((1 - used) * 10_000) / 10_000 : Math.round(x.share * 10_000) / 10_000;
    used += share;
    return { ...x, share, km: r2(km * share) };
  });
}
