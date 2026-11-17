import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CostCategory, CostQuery, CreateSharedCostInput, Role, UpsertBudgetsInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { dayBounds, localDate } from '../../common/time';
import { NotificationsService } from '../notifications/notifications.service';
import { alertLevel, allocateByKm, assetCost, bookValue, dayCount, documentCategory, evaluateBudget, maxDay, minDay, monthOf, monthRange, monthsIn, r2, spreadFee, toDay } from './calc';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

export type CostSource = 'fuel' | 'maintenance' | 'expense' | 'document' | 'asset' | 'shared' | 'tire' | 'warranty';
export interface LedgerRow {
  vehicleId: string;
  month: string;
  category: string;
  source: CostSource;
  amount: number;
  tripId?: string | null;
}
export interface LedgerVehicle {
  id: string;
  plateNumber: string;
  branchId: string | null;
  departmentId: string | null;
  ownership: string;
}
export interface Ledger {
  from: string;
  to: string;
  vehicles: LedgerVehicle[];
  rows: LedgerRow[];
  /** GPS km per vehicle within [from, to]. */
  km: Map<string, number>;
  /** Shared costs that could not be allocated (no km driven in scope that month). */
  unallocated: { id: string; period: string; description: string; amount: number }[];
}

const SCOPE = (branchId?: string | null, departmentId?: string | null) => (branchId ? `branch:${branchId}` : departmentId ? `department:${departmentId}` : 'company');

@Injectable()
export class CostsService {
  private readonly logger = new Logger(CostsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Every cost of the company's vehicles in local days [from, to], normalised to rows per vehicle, month
   * and category: approved fuel, completed work orders, approved expenses, document fees spread over their
   * validity, depreciation or lease, and shared costs allocated by km. Filters apply to the vehicles'
   * current branch / department after allocation, so shared costs are always split over the whole scope.
   */
  async ledger(tx: Tx, tz: string, q: { from: string; to: string; branchId?: string | null; departmentId?: string | null }): Promise<Ledger> {
    if (q.to < q.from) throw new BadRequestException('"to" is before "from"');
    if (dayCount(q.from, q.to) > 1100) throw new BadRequestException('Choose a range of at most 3 years');
    const start = dayBounds(q.from, tz).start;
    const end = dayBounds(q.to, tz).end;
    const months = monthsIn(q.from, q.to);
    const fullFrom = monthRange(months[0]).from;
    const fullTo = monthRange(months[months.length - 1]).to;

    const vehicles = await tx.vehicle.findMany({
      where: { deletedAt: null },
      select: {
        id: true, plateNumber: true, branchId: true, departmentId: true, ownership: true, acquiredAt: true, disposedAt: true,
        purchasePrice: true, residualValue: true, usefulLifeMonths: true, monthlyLeaseCost: true, inServiceAt: true,
      },
      orderBy: { plateNumber: 'asc' },
    });
    const [fuel, workOrders, expenses, documents, stats, shared, tires, warranty] = await Promise.all([
      tx.fuelRecord.findMany({ where: { filledAt: { gte: start, lt: end }, approvalStatus: 'APPROVED' }, select: { vehicleId: true, filledAt: true, totalCost: true } }),
      tx.workOrder.findMany({ where: { status: 'COMPLETED', completedAt: { gte: start, lt: end } }, select: { vehicleId: true, completedAt: true, totalCost: true, lines: { where: { kind: 'TIRE' }, select: { total: true } } } }),
      tx.vehicleExpense.findMany({ where: { incurredAt: { gte: start, lt: end }, approvalStatus: 'APPROVED' }, select: { vehicleId: true, incurredAt: true, amount: true, category: true, tripId: true } }),
      tx.vehicleDocument.findMany({
        where: { amount: { gt: 0 }, issuedAt: { lte: new Date(q.to) }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(q.from) } }] },
        select: { vehicleId: true, type: true, amount: true, issuedAt: true, expiresAt: true },
      }),
      tx.vehicleDailyStat.findMany({ where: { day: { gte: new Date(fullFrom), lte: new Date(fullTo) } }, select: { vehicleId: true, day: true, distanceKm: true } }),
      tx.sharedCost.findMany({ where: { period: { in: months } }, orderBy: { createdAt: 'asc' } }),
      // Tire changes outside a work order (inside one they are TIRE lines).
      tx.tireChange.findMany({ where: { workOrderId: null, cost: { gt: 0 }, changedAt: { gte: start, lt: end } }, select: { vehicleId: true, changedAt: true, cost: true } }),
      tx.warrantyClaim.findMany({ where: { status: 'RECOVERED', recoveredAt: { gte: start, lt: end }, amountRecovered: { gt: 0 } }, select: { vehicleId: true, recoveredAt: true, amountRecovered: true, basis: true } }),
    ]);

    const rows: LedgerRow[] = [];
    const known = new Set(vehicles.map((v) => v.id));
    const push = (r: LedgerRow) => {
      if (known.has(r.vehicleId) && r.amount) rows.push({ ...r, amount: r2(r.amount) });
    };
    for (const f of fuel) push({ vehicleId: f.vehicleId, month: monthOf(localDate(f.filledAt, tz)), category: CostCategory.FUEL, source: 'fuel', amount: n(f.totalCost) });
    for (const w of workOrders) {
      const month = monthOf(localDate(w.completedAt!, tz));
      const tire = w.lines.reduce((a, l) => a + n(l.total), 0);
      push({ vehicleId: w.vehicleId, month, category: CostCategory.MAINTENANCE, source: 'maintenance', amount: n(w.totalCost) - tire });
      push({ vehicleId: w.vehicleId, month, category: CostCategory.TIRES, source: 'maintenance', amount: tire });
    }
    for (const t of tires) push({ vehicleId: t.vehicleId, month: monthOf(localDate(t.changedAt, tz)), category: CostCategory.TIRES, source: 'tire', amount: n(t.cost) });
    // Recovered warranty claims reduce the cost in the month the money came back.
    for (const c of warranty) push({ vehicleId: c.vehicleId, month: monthOf(localDate(c.recoveredAt!, tz)), category: c.basis === 'TIRE' ? CostCategory.TIRES : CostCategory.MAINTENANCE, source: 'warranty', amount: -n(c.amountRecovered) });
    for (const e of expenses) push({ vehicleId: e.vehicleId, month: monthOf(localDate(e.incurredAt, tz)), category: e.category, source: 'expense', amount: n(e.amount), tripId: e.tripId });

    // Period costs, split per month inside the range.
    const perMonth = (fn: (from: string, to: string) => number, base: Omit<LedgerRow, 'month' | 'amount'>) => {
      for (const m of months) {
        const mr = monthRange(m);
        const a = fn(maxDay(q.from, mr.from), minDay(q.to, mr.to));
        if (a) push({ ...base, month: m, amount: a });
      }
    };
    for (const d of documents) {
      const issued = d.issuedAt ? toDay(d.issuedAt) : null;
      const expires = d.expiresAt ? toDay(d.expiresAt) : null;
      perMonth((f, t) => spreadFee(n(d.amount), issued, expires, f, t), { vehicleId: d.vehicleId, category: documentCategory(d.type), source: 'document' });
    }
    for (const v of vehicles) {
      const asset = this.asset(v);
      perMonth((f, t) => assetCost(asset, f, t)?.amount ?? 0, { vehicleId: v.id, category: v.ownership === 'OWNED' ? CostCategory.DEPRECIATION : CostCategory.LEASE, source: 'asset' });
    }

    // km per vehicle: per month (allocation) and within the range.
    const kmMonth = new Map<string, Map<string, number>>(); // month → vehicle → km
    const km = new Map<string, number>();
    for (const s of stats) {
      const day = toDay(s.day);
      const m = monthOf(day);
      const mm = kmMonth.get(m) ?? new Map<string, number>();
      mm.set(s.vehicleId, (mm.get(s.vehicleId) ?? 0) + n(s.distanceKm));
      kmMonth.set(m, mm);
      if (day >= q.from && day <= q.to) km.set(s.vehicleId, (km.get(s.vehicleId) ?? 0) + n(s.distanceKm));
    }

    // Shared costs: the month's share inside the range, split over vehicles in its scope by that month's km.
    const unallocated: Ledger['unallocated'] = [];
    for (const c of shared) {
      const mr = monthRange(c.period);
      const share = (n(c.amount) * dayCount(maxDay(q.from, mr.from), minDay(q.to, mr.to))) / dayCount(mr.from, mr.to);
      const inScope = vehicles.filter((v) => (!c.branchId || v.branchId === c.branchId) && (!c.departmentId || v.departmentId === c.departmentId));
      const monthKm = kmMonth.get(c.period) ?? new Map<string, number>();
      const { parts, unallocated: rest } = allocateByKm(r2(share), inScope.map((v) => ({ vehicleId: v.id, km: monthKm.get(v.id) ?? 0 })));
      for (const [vehicleId, amount] of parts) push({ vehicleId, month: c.period, category: c.category, source: 'shared', amount });
      if (rest) unallocated.push({ id: c.id, period: c.period, description: c.description, amount: rest });
    }

    const inFilter = (v: LedgerVehicle) => (!q.branchId || v.branchId === q.branchId) && (!q.departmentId || v.departmentId === q.departmentId);
    const scoped = vehicles.filter(inFilter).map((v) => ({ id: v.id, plateNumber: v.plateNumber, branchId: v.branchId, departmentId: v.departmentId, ownership: v.ownership }));
    const ids = new Set(scoped.map((v) => v.id));
    return { from: q.from, to: q.to, vehicles: scoped, rows: rows.filter((r) => ids.has(r.vehicleId)), km: new Map([...km].filter(([id]) => ids.has(id))), unallocated };
  }

  private asset(v: { ownership: string; purchasePrice: Prisma.Decimal | null; residualValue: Prisma.Decimal | null; usefulLifeMonths: number | null; monthlyLeaseCost: Prisma.Decimal | null; inServiceAt: Date | null; acquiredAt: Date | null; disposedAt: Date | null }) {
    const start = v.inServiceAt ?? v.acquiredAt;
    return {
      ownership: v.ownership,
      purchasePrice: v.purchasePrice == null ? null : n(v.purchasePrice),
      residualValue: v.residualValue == null ? null : n(v.residualValue),
      usefulLifeMonths: v.usefulLifeMonths,
      monthlyLeaseCost: v.monthlyLeaseCost == null ? null : n(v.monthlyLeaseCost),
      inServiceAt: start ? toDay(start) : null,
      disposedAt: v.disposedAt ? toDay(v.disposedAt) : null,
    };
  }

  /**
   * Full running cost per km per vehicle over a range (everything in the ledger except trip-linked
   * expenses, which are charged to their own trip), plus the fleet average as a fallback.
   */
  async costPerKm(tx: Tx, tz: string, from: string, to: string): Promise<{ perKm: Map<string, number>; fleet: number | null }> {
    const l = await this.ledger(tx, tz, { from, to });
    const cost = new Map<string, number>();
    for (const r of l.rows) if (!r.tripId) cost.set(r.vehicleId, (cost.get(r.vehicleId) ?? 0) + r.amount);
    const perKm = new Map<string, number>();
    let c = 0;
    let k = 0;
    for (const [id, amount] of cost) {
      const km = l.km.get(id) ?? 0;
      if (km > 0) {
        perKm.set(id, amount / km);
        c += amount;
        k += km;
      }
    }
    return { perKm, fleet: k > 0 ? c / k : null };
  }

  // ---------------------------------------------------------------------------
  // TCO and trip costs
  // ---------------------------------------------------------------------------

  tco(user: AuthUser, q: CostQuery) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const l = await this.ledger(tx, company.timezone, q);
      const full = await tx.vehicle.findMany({
        where: { id: { in: l.vehicles.map((v) => v.id) } },
        select: { id: true, make: true, model: true, vehicleClass: true, branch: { select: { name: true } }, department: { select: { name: true } }, ownership: true, acquiredAt: true, disposedAt: true, purchasePrice: true, residualValue: true, usefulLifeMonths: true, monthlyLeaseCost: true, inServiceAt: true },
      });
      const meta = new Map(full.map((v) => [v.id, v]));
      const months = dayCount(q.from, q.to) / 30.4375;
      const totals: Record<string, number> = {};
      const vehicles = l.vehicles.map((v) => {
        const mine = l.rows.filter((r) => r.vehicleId === v.id);
        const byCategory: Record<string, number> = {};
        const bySource: Record<string, number> = {};
        for (const r of mine) {
          byCategory[r.category] = r2((byCategory[r.category] ?? 0) + r.amount);
          bySource[r.source] = r2((bySource[r.source] ?? 0) + r.amount);
          totals[r.category] = r2((totals[r.category] ?? 0) + r.amount);
        }
        const total = r2(mine.reduce((s, r) => s + r.amount, 0));
        const km = Math.round((l.km.get(v.id) ?? 0) * 10) / 10;
        const m = meta.get(v.id)!;
        const asset = this.asset(m);
        return {
          ...v,
          name: `${m.make} ${m.model}`,
          vehicleClass: m.vehicleClass,
          branch: m.branch?.name ?? null,
          department: m.department?.name ?? null,
          km,
          total,
          perKm: km > 0 ? r2(total / km) : null,
          perMonth: months > 0 ? r2(total / months) : null,
          ownershipCost: r2((bySource.asset ?? 0)),
          running: r2(total - (bySource.asset ?? 0) - (bySource.shared ?? 0)),
          shared: r2(bySource.shared ?? 0),
          byCategory,
          bookValue: bookValue(asset, q.to),
          assetDataMissing: m.ownership === 'OWNED' ? m.purchasePrice == null || !m.usefulLifeMonths || !asset.inServiceAt : m.ownership !== 'CONTRACTOR' && m.monthlyLeaseCost == null,
        };
      });
      vehicles.sort((a, b) => b.total - a.total);
      const total = r2(vehicles.reduce((s, v) => s + v.total, 0));
      const km = vehicles.reduce((s, v) => s + v.km, 0);
      return {
        range: { from: q.from, to: q.to, currency: company.currency },
        totals: { total, km: Math.round(km), perKm: km > 0 ? r2(total / km) : null, byCategory: totals, unallocated: r2(l.unallocated.reduce((s, u) => s + u.amount, 0)) },
        vehicles,
        unallocated: l.unallocated,
        method:
          'Fuel (approved), completed work orders, approved expenses, document fees spread over their validity, straight-line depreciation (purchase price − residual value over the useful life) or monthly lease/rent, and shared costs allocated by km driven in their month.',
      };
    });
  }

  async tcoCsv(user: AuthUser, q: CostQuery): Promise<string> {
    const t = await this.tco(user, q);
    const cats = Object.keys(t.totals.byCategory).sort();
    const head = ['Vehicle', 'Name', 'Branch', 'Department', 'Ownership', 'km', 'Total', 'Per km', 'Per month', 'Ownership cost', 'Running', 'Shared', 'Book value', ...cats];
    const lines = [head.join(',')];
    for (const v of t.vehicles)
      lines.push([v.plateNumber, v.name, v.branch, v.department, v.ownership, v.km, v.total, v.perKm, v.perMonth, v.ownershipCost, v.running, v.shared, v.bookValue, ...cats.map((c) => v.byCategory[c] ?? 0)].map(csvCell).join(','));
    return `${lines.join('\n')}\n`;
  }

  tripCosts(user: AuthUser, q: CostQuery) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true, settings: true } });
      const tz = company.timezone;
      const settings = (company.settings as { logistics?: { driverCostPerDay?: number | null } } | null)?.logistics;
      const start = dayBounds(q.from, tz).start;
      const end = dayBounds(q.to, tz).end;
      const trips = await tx.trip.findMany({
        where: {
          status: 'COMPLETED',
          actualEnd: { gte: start, lt: end },
          ...(q.branchId && { vehicle: { branchId: q.branchId } }),
          ...(q.departmentId && { vehicle: { departmentId: q.departmentId } }),
        },
        select: { id: true, tripNo: true, kind: true, vehicleId: true, actualStart: true, actualEnd: true, gpsDistanceKm: true, plannedKm: true, vehicle: { select: { plateNumber: true } }, driver: { select: { fullName: true } }, _count: { select: { stops: true } } },
        orderBy: { actualEnd: 'desc' },
        take: 1000,
      });
      const [{ perKm, fleet }, exp] = await Promise.all([
        this.costPerKm(tx, tz, q.from, q.to),
        tx.vehicleExpense.groupBy({ by: ['tripId'], where: { tripId: { in: trips.map((t) => t.id) }, approvalStatus: 'APPROVED' }, _sum: { amount: true } }),
      ]);
      const expBy = new Map(exp.map((e) => [e.tripId, n(e._sum.amount)]));
      const rows = trips.map((t) => {
        const km = t.gpsDistanceKm != null ? n(t.gpsDistanceKm) : t.plannedKm != null ? n(t.plannedKm) : null;
        const rate = (t.vehicleId ? perKm.get(t.vehicleId) : undefined) ?? fleet;
        const running = km != null && rate != null ? r2(km * rate) : 0;
        const expenses = expBy.get(t.id) ?? 0;
        const days = t.actualStart && t.actualEnd ? dayCount(localDate(t.actualStart, tz), localDate(t.actualEnd, tz)) : 1;
        const driver = r2((settings?.driverCostPerDay ?? 0) * days);
        const total = r2(running + expenses + driver);
        return { tripId: t.id, tripNo: t.tripNo, kind: t.kind, vehicle: t.vehicle?.plateNumber ?? null, driver: t.driver?.fullName ?? null, endedAt: t.actualEnd, km, ratePerKm: rate != null ? r2(rate) : null, running, expenses, driverCost: driver, total, perKm: km ? r2(total / km) : null, stops: t._count.stops };
      });
      return {
        range: { from: q.from, to: q.to, currency: company.currency },
        trips: rows,
        totals: { trips: rows.length, total: r2(rows.reduce((s, r) => s + r.total, 0)), km: Math.round(rows.reduce((s, r) => s + (r.km ?? 0), 0)) },
        method: 'Trip km (GPS, else planned) × the vehicle’s full cost per km in the period (all ledger costs except trip-linked expenses; fleet average if unknown) + the trip’s own expenses' + (settings?.driverCostPerDay ? ' + driver cost per trip day' : ''),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------

  budgets(user: AuthUser, year: number, dimension: 'company' | 'branch' | 'department') {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const tz = company.timezone;
      const today = localDate(new Date(), tz);
      const periods = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
      const scopes =
        dimension === 'company'
          ? [{ key: 'company', id: null as string | null, name: 'Company' }]
          : dimension === 'branch'
            ? (await tx.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })).map((b) => ({ key: SCOPE(b.id), id: b.id, name: b.name }))
            : (await tx.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })).map((d) => ({ key: SCOPE(null, d.id), id: d.id, name: d.name }));
      const [budgets, ledger] = await Promise.all([
        tx.budget.findMany({ where: { period: { in: periods }, scopeKey: { in: scopes.map((s) => s.key) } } }),
        // Actuals only up to today (a future month has none).
        `${year}-01-01` <= today ? this.ledger(tx, tz, { from: `${year}-01-01`, to: minDay(`${year}-12-31`, today) }) : null,
      ]);
      const vehicleScope = new Map((ledger?.vehicles ?? []).map((v) => [v.id, dimension === 'company' ? 'company' : dimension === 'branch' ? SCOPE(v.branchId) : SCOPE(null, v.departmentId)]));
      const actual = new Map<string, number>(); // scope|category|period
      for (const r of ledger?.rows ?? []) {
        const k = `${vehicleScope.get(r.vehicleId)}|${r.category}|${r.month}`;
        actual.set(k, (actual.get(k) ?? 0) + r.amount);
      }
      const budget = new Map(budgets.map((b) => [`${b.scopeKey}|${b.category}|${b.period}`, n(b.amount)]));
      const categories = Object.values(CostCategory);
      return {
        year,
        dimension,
        currency: company.currency,
        periods,
        categories,
        scopes: scopes.map((s) => {
          const lines = categories
            .map((category) => {
              const months = periods.map((period) => ({ period, ...evaluateBudget(budget.get(`${s.key}|${category}|${period}`) ?? null, actual.get(`${s.key}|${category}|${period}`) ?? 0, period, today) }));
              return { category, months, budget: r2(months.reduce((a, m) => a + (m.budget ?? 0), 0)), actual: r2(months.reduce((a, m) => a + m.actual, 0)) };
            })
            .filter((l) => l.budget || l.actual);
          const months = periods.map((period, i) => {
            const b = lines.reduce((a, l) => a + (l.months[i].budget ?? 0), 0);
            const a = lines.reduce((x, l) => x + l.months[i].actual, 0);
            return { period, ...evaluateBudget(b || null, a, period, today) };
          });
          return { ...s, lines, months, budget: r2(lines.reduce((a, l) => a + l.budget, 0)), actual: r2(lines.reduce((a, l) => a + l.actual, 0)) };
        }),
        unallocated: ledger?.unallocated ?? [],
      };
    });
  }

  upsertBudgets(user: AuthUser, input: UpsertBudgetsInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.assertScopes(tx, input.lines);
      let saved = 0;
      let removed = 0;
      for (const l of input.lines) {
        const scopeKey = SCOPE(l.branchId, l.departmentId);
        const where = { companyId_period_scopeKey_category: { companyId: user.companyId, period: l.period, scopeKey, category: l.category } };
        if (!l.amount) {
          removed += (await tx.budget.deleteMany({ where: where.companyId_period_scopeKey_category })).count;
          continue;
        }
        const existing = await tx.budget.findUnique({ where, select: { amount: true } });
        await tx.budget.upsert({
          where,
          create: { companyId: user.companyId, period: l.period, scopeKey, branchId: l.branchId ?? null, departmentId: l.departmentId ?? null, category: l.category, amount: l.amount, updatedBy: user.userId },
          // A changed amount re-arms the 90 % / 100 % alerts.
          update: { amount: l.amount, updatedBy: user.userId, ...(existing && n(existing.amount) !== l.amount && { alertedLevel: null }) },
        });
        saved++;
      }
      return { saved, removed };
    });
  }

  copyBudgets(user: AuthUser, input: { fromYear: number; toYear: number; changePct: number; overwrite: boolean }) {
    if (input.fromYear === input.toYear) throw new BadRequestException('Choose two different years');
    return this.db.tenant(user.companyId, async (tx) => {
      const src = await tx.budget.findMany({ where: { period: { startsWith: `${input.fromYear}-` } } });
      let copied = 0;
      let skipped = 0;
      for (const b of src) {
        const period = `${input.toYear}${b.period.slice(4)}`;
        const amount = r2(n(b.amount) * (1 + input.changePct / 100));
        const where = { companyId_period_scopeKey_category: { companyId: user.companyId, period, scopeKey: b.scopeKey, category: b.category } };
        const exists = await tx.budget.findUnique({ where, select: { id: true } });
        if (exists && !input.overwrite) {
          skipped++;
          continue;
        }
        await tx.budget.upsert({
          where,
          create: { companyId: user.companyId, period, scopeKey: b.scopeKey, branchId: b.branchId, departmentId: b.departmentId, category: b.category, amount, updatedBy: user.userId },
          update: { amount, updatedBy: user.userId, alertedLevel: null },
        });
        copied++;
      }
      return { copied, skipped };
    });
  }

  private async assertScopes(tx: Tx, refs: { branchId?: string | null; departmentId?: string | null }[]) {
    const b = [...new Set(refs.map((r) => r.branchId).filter((x): x is string => !!x))];
    const d = [...new Set(refs.map((r) => r.departmentId).filter((x): x is string => !!x))];
    if (b.length && (await tx.branch.count({ where: { id: { in: b } } })) !== b.length) throw new BadRequestException('Unknown branch');
    if (d.length && (await tx.department.count({ where: { id: { in: d } } })) !== d.length) throw new BadRequestException('Unknown department');
  }

  /** Current-month budget lines with their actual spend to date. */
  private async monthLines(tx: Tx, tz: string, today: string) {
    const period = monthOf(today);
    const lines = await tx.budget.findMany({ where: { period, amount: { gt: 0 } } });
    if (!lines.length) return [];
    const l = await this.ledger(tx, tz, { from: monthRange(period).from, to: today });
    const names = new Map<string, string>([
      ...(await tx.branch.findMany({ select: { id: true, name: true } })).map((b) => [SCOPE(b.id), b.name] as [string, string]),
      ...(await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [SCOPE(null, d.id), d.name] as [string, string]),
    ]);
    const scopeOf = new Map(l.vehicles.map((v) => [v.id, { branch: SCOPE(v.branchId), department: SCOPE(null, v.departmentId) }]));
    return lines.map((b) => ({
      b,
      scope: b.scopeKey === 'company' ? 'Company' : (names.get(b.scopeKey) ?? b.scopeKey),
      actual: r2(
        l.rows
          .filter((r) => r.category === b.category && r.month === period)
          .filter((r) => b.scopeKey === 'company' || scopeOf.get(r.vehicleId)?.branch === b.scopeKey || scopeOf.get(r.vehicleId)?.department === b.scopeKey)
          .reduce((s, r) => s + r.amount, 0),
      ),
    }));
  }

  /** Compact overview for the fleet manager's phone: approvals, fleet state, control alerts, budgets at risk. */
  managerSummary(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const today = localDate(new Date(), company.timezone);
      const since = new Date(Date.now() - 24 * 3_600_000);
      const [pending, statuses, ongoing, events, lines] = await Promise.all([
        tx.approvalRequest.count({ where: { status: 'PENDING', OR: [{ requestedBy: null }, { requestedBy: { not: user.userId } }], decisions: { none: { approverId: user.userId } } } }),
        tx.vehicle.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
        tx.trip.count({ where: { status: 'ONGOING' } }),
        tx.telemetryEvent.findMany({
          where: { occurredAt: { gte: since }, type: { in: ['OFF_ROUTE', 'UNAUTHORISED_MOVEMENT', 'AFTER_HOURS', 'NO_DRIVER', 'RESTRICTED_AREA', 'OVERSPEED', 'GPS_OFFLINE'] } },
          orderBy: { occurredAt: 'desc' },
          take: 15,
        }),
        this.monthLines(tx, company.timezone, today),
      ]);
      const plates = new Map((await tx.vehicle.findMany({ where: { id: { in: [...new Set(events.map((e) => e.vehicleId))] } }, select: { id: true, plateNumber: true } })).map((v) => [v.id, v.plateNumber]));
      const budgets = lines
        .map(({ b, actual, scope }) => ({ id: b.id, scope, category: b.category, ...evaluateBudget(n(b.amount), actual, b.period, today) }))
        .filter((x) => x.status === 'OVER' || x.status === 'AT_RISK')
        .sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0))
        .slice(0, 5);
      return {
        currency: company.currency,
        pendingApprovals: pending,
        vehicles: Object.fromEntries(statuses.map((x) => [x.status, x._count._all])),
        tripsOngoing: ongoing,
        alerts: events.map((e) => ({ id: e.id, type: e.type, plateNumber: plates.get(e.vehicleId) ?? '', occurredAt: e.occurredAt, endedAt: e.endedAt, data: e.data })),
        budgets,
      };
    });
  }

  /** Daily: notify managers when a current-month budget line reaches 90 % or 100 % (once per level). */
  async budgetAlerts(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, timezone: true, currency: true } }));
    let sent = 0;
    for (const c of companies) {
      const today = localDate(now, c.timezone);
      const period = monthOf(today);
      const due = await this.db.tenant(c.id, async (tx) => {
        const out: { id: string; level: 90 | 100; title: string; body: string; dedupe: string }[] = [];
        for (const { b, actual, scope } of await this.monthLines(tx, c.timezone, today)) {
          const level = alertLevel(n(b.amount), actual);
          if (!level || (b.alertedLevel ?? 0) >= level) continue;
          await tx.budget.update({ where: { id: b.id }, data: { alertedLevel: level } });
          const pct = Math.round((actual / n(b.amount)) * 100);
          out.push({
            id: b.id,
            level,
            title: `${level === 100 ? 'Over budget' : 'Budget 90 % used'}: ${scope} · ${b.category} · ${period}`,
            body: `${scope} has spent ${r2(actual).toLocaleString('en-US')} ${c.currency} of the ${n(b.amount).toLocaleString('en-US')} ${c.currency} ${b.category.toLowerCase()} budget for ${period} (${pct} %).`,
            dedupe: `budget:${b.id}:${level}:${n(b.amount)}`,
          });
        }
        return out;
      });
      for (const a of due)
        sent += await this.notifications.notify({
          companyId: c.id,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
          topic: 'budget.alert',
          severity: a.level === 100 ? 'critical' : 'warning',
          title: a.title,
          body: a.body,
          data: { budgetId: a.id, link: '/budgets' },
          dedupeKey: a.dedupe,
        });
    }
    this.logger.log(`Budget alerts: ${sent}`);
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Shared costs
  // ---------------------------------------------------------------------------

  listShared(user: AuthUser, q: { from: string; to: string }) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.sharedCost
        .findMany({ where: { period: { in: monthsIn(q.from, q.to) } }, orderBy: [{ period: 'desc' }, { createdAt: 'desc' }] })
        .then((rows) => rows.map((r) => ({ ...r, amount: n(r.amount) }))),
    );
  }

  createShared(user: AuthUser, input: CreateSharedCostInput) {
    if (input.branchId && input.departmentId) throw new BadRequestException('Choose a branch or a department, not both');
    return this.db.tenant(user.companyId, async (tx) => {
      await this.assertScopes(tx, [input]);
      const r = await tx.sharedCost.create({ data: { ...input, branchId: input.branchId ?? null, departmentId: input.departmentId ?? null, companyId: user.companyId, createdBy: user.userId } });
      return { ...r, amount: n(r.amount) };
    });
  }

  deleteShared(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = await tx.sharedCost.deleteMany({ where: { id } });
      if (!r.count) throw new NotFoundException();
      return { deleted: true };
    });
  }
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
