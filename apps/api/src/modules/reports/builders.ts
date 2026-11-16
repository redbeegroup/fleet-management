/**
 * Report builders (pure): turn the results of the analytics, cost, delivery and safety
 * services into a ReportModel. The services are called by ReportsService.
 */
import { change, fmtMoney, fmtNum, fmtPct, ReportModel, Section } from './model';

export interface Ctx {
  company: string;
  currency: string;
  scope: string;
  periodLabel: string;
}

// --- Fleet overview ---------------------------------------------------------

interface FleetKpis {
  vehicles: number;
  distanceKm: number;
  totalCost: number;
  costPerKm: number | null;
  fuelCost: number;
  maintenanceCost: number;
  otherCost: number;
  fuelKmPerLitre: number | null;
  utilizationPct: number | null;
  availabilityPct: number | null;
  tripsCompleted: number;
  overspeedEvents: number;
}
export interface FleetInput {
  fleet: FleetKpis;
  vehicles: { plateNumber: string; branchName: string | null; distanceKm: number; totalCost: number; costPerKm: number | null; fuelKmPerLitre: number | null; utilizationPct: number | null; downtimePct: number | null }[];
  branches: ({ branchName: string } & FleetKpis)[];
}

export function buildFleet(ctx: Ctx, cur: FleetInput, prev: FleetInput | null): ReportModel {
  const f = cur.fleet;
  const p = prev?.fleet;
  const top = cur.vehicles.filter((v) => v.totalCost > 0).slice(0, 10);
  const sections: Section[] = [
    {
      title: 'Top 10 vehicles by cost',
      bars: top.map((v) => ({ label: v.plateNumber, value: v.totalCost, display: fmtMoney(v.totalCost, ctx.currency) })),
      table: {
        columns: ['Vehicle', 'Branch', 'km', `Cost (${ctx.currency})`, 'Cost/km', 'km/L', 'Utilisation', 'Downtime'],
        rows: top.map((v) => [v.plateNumber, v.branchName ?? '—', fmtNum(v.distanceKm), fmtNum(v.totalCost), fmtNum(v.costPerKm, 1), fmtNum(v.fuelKmPerLitre, 1), fmtPct(v.utilizationPct), fmtPct(v.downtimePct)]),
        numeric: [2, 3, 4, 5, 6, 7],
      },
      empty: 'No vehicle costs in this period.',
    },
    {
      title: 'Cost by type',
      bars: [
        { label: 'Fuel', value: f.fuelCost, display: fmtMoney(f.fuelCost, ctx.currency) },
        { label: 'Maintenance', value: f.maintenanceCost, display: fmtMoney(f.maintenanceCost, ctx.currency) },
        { label: 'Other expenses', value: f.otherCost, display: fmtMoney(f.otherCost, ctx.currency) },
      ].filter((b) => b.value > 0),
      empty: 'No costs in this period.',
    },
  ];
  if (cur.branches.length > 1) {
    sections.push({
      title: 'By branch',
      table: {
        columns: ['Branch', 'Vehicles', 'km', `Cost (${ctx.currency})`, 'Cost/km', 'Utilisation', 'Availability'],
        rows: cur.branches.map((b) => [b.branchName, b.vehicles, fmtNum(b.distanceKm), fmtNum(b.totalCost), fmtNum(b.costPerKm, 1), fmtPct(b.utilizationPct), fmtPct(b.availabilityPct)]),
        numeric: [1, 2, 3, 4, 5, 6],
      },
    });
  }
  return {
    report: 'FLEET',
    title: 'Fleet overview',
    ...ctx,
    kpis: [
      { label: 'Total cost', value: fmtMoney(f.totalCost, ctx.currency), change: change(f.totalCost, p?.totalCost, false) },
      { label: 'Cost per km', value: f.costPerKm == null ? '—' : `${fmtNum(f.costPerKm, 1)} ${ctx.currency}`, change: change(f.costPerKm, p?.costPerKm, false) },
      { label: 'Distance', value: `${fmtNum(f.distanceKm)} km`, change: change(f.distanceKm, p?.distanceKm, null) },
      { label: 'Utilisation', value: fmtPct(f.utilizationPct), change: change(f.utilizationPct, p?.utilizationPct, true, 'pts') },
      { label: 'Availability', value: fmtPct(f.availabilityPct), change: change(f.availabilityPct, p?.availabilityPct, true, 'pts') },
      { label: 'Fuel economy', value: f.fuelKmPerLitre == null ? '—' : `${fmtNum(f.fuelKmPerLitre, 1)} km/L`, change: change(f.fuelKmPerLitre, p?.fuelKmPerLitre, true) },
      { label: 'Trips completed', value: fmtNum(f.tripsCompleted), change: change(f.tripsCompleted, p?.tripsCompleted, null) },
      { label: 'Overspeed events', value: fmtNum(f.overspeedEvents), change: change(f.overspeedEvents, p?.overspeedEvents, false) },
    ],
    sections,
    notes: [`${f.vehicles} vehicles. Costs: approved fuel, completed work orders and approved expenses (ownership costs are in the Budget & TCO report).`],
    csv: [
      {
        name: 'vehicles.csv',
        table: {
          columns: ['vehicle', 'branch', 'km', 'cost', 'cost_per_km', 'km_per_litre', 'utilisation_pct', 'downtime_pct'],
          rows: cur.vehicles.map((v) => [v.plateNumber, v.branchName, v.distanceKm, v.totalCost, v.costPerKm, v.fuelKmPerLitre, v.utilizationPct, v.downtimePct]),
        },
      },
    ],
  };
}

// --- Budget vs actual & TCO -------------------------------------------------

export interface BudgetLine {
  scope: string;
  category: string;
  budget: number | null;
  actual: number;
  usedPct: number | null;
  forecast: number;
  status: 'OK' | 'AT_RISK' | 'OVER' | 'NO_BUDGET';
}
export interface TcoInput {
  totals: { total: number; km: number; perKm: number | null; byCategory: Record<string, number>; unallocated: number };
  vehicles: { plateNumber: string; name: string; km: number; total: number; perKm: number | null; ownershipCost: number; running: number; shared: number; bookValue: number | null; assetDataMissing: boolean }[];
}

export function buildBudget(ctx: Ctx & { month: string }, lines: BudgetLine[], tco: TcoInput): ReportModel {
  const withBudget = lines.filter((l) => l.budget);
  const budget = withBudget.reduce((s, l) => s + (l.budget ?? 0), 0);
  const actual = withBudget.reduce((s, l) => s + l.actual, 0);
  const flagged = lines.filter((l) => l.status === 'OVER' || l.status === 'AT_RISK').sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0));
  const top = tco.vehicles.slice(0, 10);
  const missing = tco.vehicles.filter((v) => v.assetDataMissing).length;
  const status = { OVER: 'Over budget', AT_RISK: 'At risk', OK: 'On track', NO_BUDGET: 'No budget' } as const;
  return {
    report: 'BUDGET',
    title: 'Budget vs actual & TCO',
    ...ctx,
    kpis: [
      { label: `Budget ${ctx.month}`, value: budget ? fmtMoney(budget, ctx.currency) : 'not set' },
      { label: 'Actual (budgeted lines)', value: fmtMoney(actual, ctx.currency) },
      { label: 'Used', value: budget ? fmtPct(Math.round((actual / budget) * 1000) / 10) : '—' },
      { label: 'Lines over / at risk', value: `${lines.filter((l) => l.status === 'OVER').length} / ${lines.filter((l) => l.status === 'AT_RISK').length}` },
      { label: 'Total cost of ownership', value: fmtMoney(tco.totals.total, ctx.currency) },
      { label: 'TCO per km', value: tco.totals.perKm == null ? '—' : `${fmtNum(tco.totals.perKm, 1)} ${ctx.currency}` },
      { label: 'Unallocated shared costs', value: fmtMoney(tco.totals.unallocated, ctx.currency) },
    ],
    sections: [
      {
        title: `Over budget or at risk (${ctx.month})`,
        table: {
          columns: ['Scope', 'Category', 'Budget', 'Actual', 'Used', 'Forecast', 'Status'],
          rows: flagged.map((l) => [l.scope, l.category, fmtNum(l.budget), fmtNum(l.actual), fmtPct(l.usedPct), fmtNum(l.forecast), status[l.status]]),
          numeric: [2, 3, 4, 5],
        },
        empty: 'All budget lines are on track.',
      },
      {
        title: 'Top 10 vehicles by total cost of ownership',
        bars: top.filter((v) => v.total > 0).map((v) => ({ label: v.plateNumber, value: v.total, display: fmtMoney(v.total, ctx.currency) })),
        table: {
          columns: ['Vehicle', 'Model', 'km', 'Ownership', 'Running', 'Shared', 'Total', 'Per km', 'Book value'],
          rows: top.map((v) => [v.plateNumber, v.name, fmtNum(v.km), fmtNum(v.ownershipCost), fmtNum(v.running), fmtNum(v.shared), fmtNum(v.total), fmtNum(v.perKm, 1), fmtNum(v.bookValue)]),
          numeric: [2, 3, 4, 5, 6, 7, 8],
        },
        empty: 'No costs in this period.',
      },
      {
        title: 'TCO by category',
        bars: Object.entries(tco.totals.byCategory)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => ({ label: k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' '), value: v, display: fmtMoney(v, ctx.currency) })),
        empty: 'No costs in this period.',
      },
    ],
    notes: [
      'Budget figures are month to date for the month of the period end; the forecast extends the daily run-rate to the month end.',
      ...(missing ? [`${missing} vehicles have no purchase or lease data: their ownership cost is missing from the TCO.`] : []),
    ],
    csv: [
      { name: 'budget-lines.csv', table: { columns: ['scope', 'category', 'budget', 'actual', 'used_pct', 'forecast', 'status'], rows: lines.map((l) => [l.scope, l.category, l.budget, l.actual, l.usedPct, l.forecast, l.status]) } },
      { name: 'tco.csv', table: { columns: ['vehicle', 'model', 'km', 'ownership', 'running', 'shared', 'total', 'per_km', 'book_value', 'asset_data_missing'], rows: tco.vehicles.map((v) => [v.plateNumber, v.name, v.km, v.ownershipCost, v.running, v.shared, v.total, v.perKm, v.bookValue, v.assetDataMissing ? 'yes' : 'no']) } },
    ],
  };
}

// --- Delivery performance ---------------------------------------------------

interface DeliveryTotals {
  trips: number;
  attempted: number;
  otifPct: number | null;
  successRatePct: number | null;
  onTimeRatePct: number | null;
  costPerDrop: number | null;
  fillPct: number | null;
  avgEtaErrorMin: number | null;
  failureReasons: Record<string, number>;
}
export interface DeliveryInput {
  totals: DeliveryTotals;
  drivers: { name: string | null; trips: number; otifPct: number | null; successRatePct: number | null; costPerDrop: number | null }[];
}
interface DwellStats {
  visits: number;
  avgMin: number | null;
  p90Min: number | null;
}
export interface DwellInput {
  totals: { loading: DwellStats; unloading: DwellStats };
  sites: { name: string; kind: string; category: string; visits: number; avgMin: number | null; p90Min: number | null }[];
}

export function buildDelivery(ctx: Ctx, cur: DeliveryInput, prev: DeliveryInput | null, dwell: DwellInput, podExceptions: number): ReportModel {
  const t = cur.totals;
  const p = prev?.totals;
  const customers = dwell.sites
    .filter((s) => s.category === 'CUSTOMER' && s.avgMin != null)
    .sort((a, b) => (b.avgMin ?? 0) - (a.avgMin ?? 0))
    .slice(0, 10);
  const reasons = Object.entries(t.failureReasons).sort((a, b) => b[1] - a[1]);
  return {
    report: 'DELIVERY',
    title: 'Delivery performance',
    ...ctx,
    kpis: [
      { label: 'OTIF', value: fmtPct(t.otifPct), change: change(t.otifPct, p?.otifPct, true, 'pts') },
      { label: 'Delivery success', value: fmtPct(t.successRatePct), change: change(t.successRatePct, p?.successRatePct, true, 'pts') },
      { label: 'On time', value: fmtPct(t.onTimeRatePct), change: change(t.onTimeRatePct, p?.onTimeRatePct, true, 'pts') },
      { label: 'Cost per drop', value: t.costPerDrop == null ? '—' : fmtMoney(t.costPerDrop, ctx.currency), change: change(t.costPerDrop, p?.costPerDrop, false) },
      { label: 'Vehicle fill', value: fmtPct(t.fillPct), change: change(t.fillPct, p?.fillPct, true, 'pts') },
      { label: 'Orders / trips', value: `${fmtNum(t.attempted)} / ${fmtNum(t.trips)}` },
      { label: 'Avg loading', value: dwell.totals.loading.avgMin == null ? '—' : `${fmtNum(dwell.totals.loading.avgMin)} min` },
      { label: 'Avg unloading', value: dwell.totals.unloading.avgMin == null ? '—' : `${fmtNum(dwell.totals.unloading.avgMin)} min` },
      { label: 'Proof-of-delivery exceptions', value: fmtNum(podExceptions) },
    ],
    sections: [
      {
        title: 'Drivers',
        table: {
          columns: ['Driver', 'Trips', 'OTIF', 'Success', 'Cost per drop'],
          rows: [...cur.drivers].sort((a, b) => (a.otifPct ?? 101) - (b.otifPct ?? 101)).slice(0, 15).map((d) => [d.name ?? '—', d.trips, fmtPct(d.otifPct), fmtPct(d.successRatePct), fmtNum(d.costPerDrop)]),
          numeric: [1, 2, 3, 4],
        },
        empty: 'No delivery trips in this period.',
      },
      {
        title: 'Longest unloading time by customer (average)',
        bars: customers.map((s) => ({ label: s.name, value: s.avgMin ?? 0, display: `${fmtNum(s.avgMin)} min` })),
        empty: 'No customer visits measured.',
      },
      {
        title: 'Failed deliveries by reason',
        table: { columns: ['Reason', 'Orders'], rows: reasons.map(([r, n]) => [r.toLowerCase().replace(/_/g, ' '), n]), numeric: [1] },
        empty: 'No failed deliveries.',
      },
    ],
    notes: ['OTIF: delivered in full inside the delivery window (or on the delivery date). Dwell times come from GPS geofences and stop arrival radius.'],
    csv: [
      { name: 'drivers.csv', table: { columns: ['driver', 'trips', 'otif_pct', 'success_pct', 'cost_per_drop'], rows: cur.drivers.map((d) => [d.name, d.trips, d.otifPct, d.successRatePct, d.costPerDrop]) } },
      { name: 'unloading-by-site.csv', table: { columns: ['site', 'type', 'visits', 'avg_min', 'p90_min'], rows: dwell.sites.map((s) => [s.name, s.category, s.visits, s.avgMin, s.p90Min]) } },
    ],
  };
}

// --- Safety & compliance ----------------------------------------------------

export interface SafetyInput {
  fleet: { drivers: number; scoredDrivers: number; averageScore: number | null; belowThreshold: number; distanceKm: number; events: { overspeed: number; harshBrake: number; harshAccel: number; harshCorner: number } };
  drivers: { fullName: string; score: number | null; distanceKm: number }[];
  settings: { alertBelow: number };
}
export interface ComplianceInput {
  incidents: number;
  injuries: number;
  claims: { open: number; claimed: number; paid: number };
  inspections: { total: number; failed: number };
  alertsByType: Record<string, number>;
  expiring: { kind: string; name: string; item: string; expiresAt: string; days: number }[];
}

export function buildSafety(ctx: Ctx, cur: SafetyInput, prev: SafetyInput | null, c: ComplianceInput): ReportModel {
  const f = cur.fleet;
  const lowest = cur.drivers.filter((d) => d.score != null).sort((a, b) => a.score! - b.score!).slice(0, 10);
  const alerts = Object.entries(c.alertsByType).sort((a, b) => b[1] - a[1]);
  const harsh = f.events.harshBrake + f.events.harshAccel + f.events.harshCorner;
  const prevHarsh = prev ? prev.fleet.events.harshBrake + prev.fleet.events.harshAccel + prev.fleet.events.harshCorner : null;
  return {
    report: 'SAFETY',
    title: 'Safety & compliance',
    ...ctx,
    kpis: [
      { label: 'Fleet safety score', value: f.averageScore == null ? '—' : `${f.averageScore} / 100`, change: change(f.averageScore, prev?.fleet.averageScore, true, 'pts') },
      { label: `Drivers below ${cur.settings.alertBelow}`, value: `${f.belowThreshold} of ${f.scoredDrivers}` },
      { label: 'Overspeed events', value: fmtNum(f.events.overspeed), change: change(f.events.overspeed, prev?.fleet.events.overspeed, false) },
      { label: 'Harsh driving events', value: fmtNum(harsh), change: change(harsh, prevHarsh, false) },
      { label: 'Incidents', value: `${c.incidents}${c.injuries ? ` (${c.injuries} with injuries)` : ''}` },
      { label: 'Open insurance claims', value: fmtNum(c.claims.open) },
      { label: 'Failed inspections', value: `${c.inspections.failed} of ${c.inspections.total}` },
      { label: 'Documents & licences expiring (30 days)', value: fmtNum(c.expiring.length) },
    ],
    sections: [
      {
        title: 'Lowest driver scores',
        bars: lowest.map((d) => ({ label: d.fullName, value: d.score!, display: `${d.score}` })),
        table: { columns: ['Driver', 'Score', 'km'], rows: lowest.map((d) => [d.fullName, d.score, fmtNum(d.distanceKm)]), numeric: [1, 2] },
        empty: 'No scored drivers in this period.',
      },
      {
        title: 'Control and telematics alerts',
        table: { columns: ['Alert', 'Count'], rows: alerts.map(([k, n]) => [k.toLowerCase().replace(/_/g, ' '), n]), numeric: [1] },
        empty: 'No alerts.',
      },
      {
        title: 'Expiring in the next 30 days',
        table: { columns: ['Type', 'Vehicle / driver', 'Item', 'Expires', 'Days'], rows: c.expiring.map((e) => [e.kind, e.name, e.item, e.expiresAt, e.days]), numeric: [4] },
        empty: 'Nothing expires in the next 30 days.',
      },
    ],
    notes: [`Scores are weighted by km; ${f.drivers} active drivers, ${fmtNum(f.distanceKm)} km. Claims: ${fmtNum(c.claims.claimed)} ${ctx.currency} claimed, ${fmtNum(c.claims.paid)} ${ctx.currency} paid in the period.`],
    csv: [
      { name: 'driver-scores.csv', table: { columns: ['driver', 'score', 'km'], rows: cur.drivers.map((d) => [d.fullName, d.score, d.distanceKm]) } },
      { name: 'expiring.csv', table: { columns: ['type', 'vehicle_or_driver', 'item', 'expires_at', 'days'], rows: c.expiring.map((e) => [e.kind, e.name, e.item, e.expiresAt, e.days]) } },
    ],
  };
}
