/** Vehicle replacement advice: limits, cost vs class, and the economic life from the cost curve (pure). */

export interface YearCost {
  /** Year of service: 1 = first 12 months in service. */
  year: number;
  running: number;
  km: number;
}
export interface AssetTerms {
  price: number;
  residual: number;
  lifeMonths: number;
}

/**
 * Economic life: the year of service with the lowest average total cost per km (loss of market
 * value + running costs). Years after the history are projected from a linear
 * fit of running cost per km and the average km per year. Null without asset data or with less
 * than two years of history.
 */
/** Declining-balance market value after `years`, reaching the residual at the end of the useful life. */
export function marketValue(a: AssetTerms, years: number) {
  const lifeYears = a.lifeMonths / 12;
  const floor = Math.max(a.residual, a.price * 0.05);
  const rate = 1 - Math.pow(floor / a.price, 1 / lifeYears);
  return Math.max(floor * 0.5, a.price * Math.pow(1 - rate, years));
}

export function economicLife(years: YearCost[], asset: AssetTerms | null, horizon = 20): { years: number; projected: boolean; avgCostPerKm: number } | null {
  const hist = years.filter((y) => y.km > 0).sort((a, b) => a.year - b.year);
  if (!asset || asset.price <= 0 || asset.lifeMonths <= 0 || hist.length < 2) return null;
  const n = hist.length;
  const xs = hist.map((y) => y.year);
  const ys = hist.map((y) => y.running / y.km);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0;
  const perKm = (year: number) => Math.max(0, my + slope * (year - mx));
  const kmYear = hist.reduce((a, y) => a + y.km, 0) / n;
  const last = hist[n - 1].year;
  const byYear = new Map(hist.map((y) => [y.year, y]));
  let best: { years: number; projected: boolean; avgCostPerKm: number } | null = null;
  let running = 0;
  let km = 0;
  for (let y = 1; y <= Math.max(horizon, last); y++) {
    const h = byYear.get(y);
    const k = h ? h.km : kmYear;
    running += h ? h.running : perKm(y) * k;
    km += k;
    // Market value falls fastest early on (declining balance reaching the residual at the end
    // of the useful life); straight-line accounting depreciation would make every year look alike.
    const depreciated = asset.price - marketValue(asset, y);
    const avg = (depreciated + running) / km;
    if (!best || avg < best.avgCostPerKm - 1e-9) best = { years: y, projected: y > last, avgCostPerKm: Math.round(avg * 100) / 100 };
  }
  return best;
}

export interface VehicleFacts {
  ageMonths: number | null;
  odometerKm: number;
  kmPerMonth: number;
  downtimePct12m: number | null;
  runningPerKm12m: number | null;
  km12m: number;
  classMedianRunningPerKm: number | null;
  classPeers: number;
  economicLifeYears: number | null;
}
export interface Limits {
  maxAgeYears: number | null;
  maxKm: number | null;
  maxDowntimePct: number | null;
  costAboveClassPct: number;
  planWithinMonths: number;
}
export type Advice = 'REPLACE_NOW' | 'PLAN' | 'OK';

export function advise(f: VehicleFacts, l: Limits): { advice: Advice; reasons: string[]; monthsToLimit: number | null } {
  const now: string[] = [];
  const plan: string[] = [];
  const months: number[] = [];
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  if (l.maxAgeYears != null && f.ageMonths != null) {
    const left = l.maxAgeYears * 12 - f.ageMonths;
    if (left <= 0) now.push(`Age ${Math.floor(f.ageMonths / 12)} years (limit ${l.maxAgeYears})`);
    else {
      if (left <= l.planWithinMonths) plan.push(`Reaches ${l.maxAgeYears} years in ${Math.ceil(left)} months`);
      months.push(left);
    }
  }
  if (l.maxKm != null) {
    const left = l.maxKm - f.odometerKm;
    if (left <= 0) now.push(`${fmt(f.odometerKm)} km (limit ${fmt(l.maxKm)})`);
    else if (f.kmPerMonth > 0) {
      const m = left / f.kmPerMonth;
      if (m <= l.planWithinMonths) plan.push(`Reaches ${fmt(l.maxKm)} km in about ${Math.ceil(m)} months`);
      months.push(m);
    }
  }
  if (l.maxDowntimePct != null && f.downtimePct12m != null && f.downtimePct12m >= l.maxDowntimePct) {
    now.push(`Under repair ${f.downtimePct12m} % of the last 12 months (limit ${l.maxDowntimePct} %)`);
  }
  if (f.runningPerKm12m != null && f.classMedianRunningPerKm && f.classPeers >= 3 && f.km12m >= 1000) {
    const above = ((f.runningPerKm12m - f.classMedianRunningPerKm) / f.classMedianRunningPerKm) * 100;
    if (above >= l.costAboveClassPct) now.push(`Running cost ${Math.round(above)} % above the class median per km`);
  }
  if (f.economicLifeYears != null && f.ageMonths != null) {
    const left = f.economicLifeYears * 12 - f.ageMonths;
    if (left <= 0) now.push(`Past its economic life (${f.economicLifeYears} years)`);
    else if (left <= l.planWithinMonths) {
      plan.push(`Economic life (${f.economicLifeYears} years) ends in ${Math.ceil(left)} months`);
      months.push(left);
    }
  }
  const monthsToLimit = now.length ? 0 : months.length ? Math.max(0, Math.round(Math.min(...months))) : null;
  return { advice: now.length ? 'REPLACE_NOW' : plan.length ? 'PLAN' : 'OK', reasons: [...now, ...plan], monthsToLimit };
}

export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
