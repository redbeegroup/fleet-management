import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RateCardInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';
import { dayBounds, localDate } from '../../common/time';
import { CostsService } from '../costs/costs.service';
import { rate, RateBasis } from './rating';
import { rateTrip, toCard } from './revenue';

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (margin: number, revenue: number) => (revenue ? Math.round((margin / revenue) * 1000) / 10 : null);

export type GroupBy = 'trip' | 'vehicle' | 'customer' | 'branch';

/** Rate cards, trip revenue and profitability (revenue from rate cards vs trip and ledger costs). */
@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly db: PrismaService,
    private readonly costs: CostsService,
  ) {}

  // ------------------------------------------------------------------ rate cards

  cards(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const cards = await tx.rateCard.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const customers = new Map((await tx.customer.findMany({ where: { id: { in: cards.map((c) => c.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return cards.map((c) => ({ ...c, customerName: c.customerId ? (customers.get(c.customerId) ?? null) : null }));
    });
  }

  private async checkRefs(tx: Prisma.TransactionClient, b: Partial<RateCardInput>) {
    if (b.customerId && !(await tx.customer.findFirst({ where: { id: b.customerId } }))) throw new BadRequestException('Customer not found');
    if (b.branchId && !(await tx.branch.findFirst({ where: { id: b.branchId } }))) throw new BadRequestException('Branch not found');
  }

  createCard(user: AuthUser, b: RateCardInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.checkRefs(tx, b);
      return tx.rateCard.create({ data: { ...b, companyId: user.companyId } });
    });
  }

  updateCard(user: AuthUser, id: string, b: RateCardInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.rateCard.findFirst({ where: { id } }))) throw new NotFoundException('Rate card not found');
      await this.checkRefs(tx, b);
      return tx.rateCard.update({ where: { id }, data: b });
    });
  }

  /** What a card charges for a sample trip (editor preview). */
  preview(user: AuthUser, id: string, basis: Omit<RateBasis, 'share'>) {
    return this.db.tenant(user.companyId, async (tx) => {
      const c = await tx.rateCard.findFirst({ where: { id } });
      if (!c) throw new NotFoundException('Rate card not found');
      return rate(toCard(c), { ...basis, share: 1 });
    });
  }

  // ------------------------------------------------------------------ trip revenue

  tripRevenue(user: AuthUser, tripId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.trip.findFirst({ where: { id: tripId } }))) throw new NotFoundException('Trip not found');
      const rows = await tx.tripRevenue.findMany({ where: { tripId }, orderBy: { amount: 'desc' } });
      const [cards, customers, billed] = await Promise.all([
        tx.rateCard.findMany({ where: { id: { in: rows.map((r) => r.rateCardId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
        tx.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
        tx.sapBillingItem.aggregate({ where: { tripId, cancelled: false }, _sum: { netAmount: true } }),
      ]);
      const cn = new Map(cards.map((c) => [c.id, c.name]));
      const cu = new Map(customers.map((c) => [c.id, c.name]));
      return {
        total: r2(rows.reduce((a, r) => a + n(r.amount), 0)),
        billed: billed._sum.netAmount != null ? n(billed._sum.netAmount) : null,
        rows: rows.map((r) => ({ ...r, rateCardName: r.rateCardId ? (cn.get(r.rateCardId) ?? null) : null, customerName: r.customerId ? (cu.get(r.customerId) ?? null) : null })),
      };
    });
  }

  async recompute(user: AuthUser, tripId: string) {
    await this.db.tenant(user.companyId, async (tx) => {
      const t = await tx.trip.findFirst({ where: { id: tripId }, select: { status: true } });
      if (!t) throw new NotFoundException('Trip not found');
      if (t.status !== 'COMPLETED') throw new BadRequestException('Only completed trips have revenue');
      await rateTrip(tx, user.companyId, tripId);
    });
    return this.tripRevenue(user, tripId);
  }

  /** Re-rates every completed trip that ended in the period (after a rate card changed). */
  rerate(user: AuthUser, from: Date, to: Date) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true } });
      const start = dayBounds(from.toISOString().slice(0, 10), company.timezone).start;
      const end = dayBounds(to.toISOString().slice(0, 10), company.timezone).end;
      if (end.getTime() - start.getTime() > 400 * 86_400_000) throw new BadRequestException('Re-rate at most about a year at a time');
      const trips = await tx.trip.findMany({ where: { status: 'COMPLETED', actualEnd: { gte: start, lt: end } }, select: { id: true } });
      let amount = 0;
      for (const t of trips) amount += (await rateTrip(tx, user.companyId, t.id)).reduce((a, r) => a + r.amount, 0);
      return { trips: trips.length, revenue: r2(amount) };
    });
  }

  // ------------------------------------------------------------------ profitability

  async profitability(user: AuthUser, q: { from: string; to: string; groupBy: GroupBy }) {
    const [tc, tco] = await Promise.all([this.costs.tripCosts(user, { from: q.from, to: q.to }), q.groupBy === 'vehicle' || q.groupBy === 'branch' ? this.costs.tco(user, { from: q.from, to: q.to }) : null]);
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true } });
      const tz = company.timezone;
      const start = dayBounds(q.from, tz).start;
      const end = dayBounds(q.to, tz).end;
      const trips = await tx.trip.findMany({
        where: { status: 'COMPLETED', actualEnd: { gte: start, lt: end } },
        select: { id: true, tripNo: true, kind: true, actualEnd: true, branchId: true, vehicleId: true, vehicle: { select: { plateNumber: true, branchId: true, vehicleClass: true } } },
        take: 5000,
      });
      const ids = trips.map((t) => t.id);
      const [revs, billed, branches, customers] = await Promise.all([
        tx.tripRevenue.findMany({ where: { tripId: { in: ids } } }),
        tx.sapBillingItem.findMany({ where: { cancelled: false, billingDate: { gte: new Date(q.from), lte: new Date(q.to) } }, select: { tripId: true, customerId: true, netAmount: true } }),
        tx.branch.findMany({ select: { id: true, name: true } }),
        tx.customer.findMany({ select: { id: true, name: true, code: true } }),
      ]);
      const costBy = new Map(tc.trips.map((t) => [t.tripId, t.total]));
      const bn = new Map(branches.map((b) => [b.id, b.name]));
      const cn = new Map(customers.map((c) => [c.id, c]));
      const revBy = new Map<string, typeof revs>();
      for (const r of revs) revBy.set(r.tripId, [...(revBy.get(r.tripId) ?? []), r]);
      const anyBilled = billed.length > 0;

      // One record per trip (and per customer share of a trip).
      const tripRows = trips.map((t) => {
        const rs = revBy.get(t.id) ?? [];
        const revenue = r2(rs.reduce((a, r) => a + n(r.amount), 0));
        const cost = costBy.get(t.id) ?? 0;
        return {
          t,
          revenue,
          cost,
          rated: rs.length > 0 && rs.every((r) => r.source === 'RATE_CARD'),
          shares: rs.map((r) => ({ customerId: r.customerId, revenue: n(r.amount), share: Number((r.basis as { share?: number }).share ?? 1) })),
          branchId: t.branchId ?? t.vehicle?.branchId ?? null,
        };
      });
      const billedByTrip = new Map<string, number>();
      const billedByCustomer = new Map<string, number>();
      for (const b of billed) {
        if (b.tripId) billedByTrip.set(b.tripId, (billedByTrip.get(b.tripId) ?? 0) + n(b.netAmount));
        if (b.customerId) billedByCustomer.set(b.customerId, (billedByCustomer.get(b.customerId) ?? 0) + n(b.netAmount));
      }
      type Row = { key: string; label: string; sub: string | null; trips: number; revenue: number; cost: number; billed: number | null; extra?: Record<string, unknown> };
      const groups = new Map<string, Row>();
      const add = (key: string, label: string, sub: string | null, revenue: number, cost: number, trips = 1) => {
        const g = groups.get(key) ?? { key, label, sub, trips: 0, revenue: 0, cost: 0, billed: null };
        g.trips += trips;
        g.revenue += revenue;
        g.cost += cost;
        groups.set(key, g);
      };
      for (const r of tripRows) {
        if (q.groupBy === 'trip') {
          add(r.t.id, r.t.tripNo, r.t.vehicle?.plateNumber ?? null, r.revenue, r.cost);
          const g = groups.get(r.t.id)!;
          g.billed = anyBilled ? r2(billedByTrip.get(r.t.id) ?? 0) : null;
          g.extra = { kind: r.t.kind, endedAt: r.t.actualEnd, rated: r.rated, customers: r.shares.map((s) => (s.customerId ? (cn.get(s.customerId)?.name ?? null) : null)).filter(Boolean) };
        } else if (q.groupBy === 'customer') {
          // Trip cost follows the same share as the revenue (weight, else drops).
          for (const s of r.shares) {
            const c = s.customerId ? cn.get(s.customerId) : undefined;
            add(s.customerId ?? 'none', c?.name ?? 'No customer (general trips)', c?.code ?? null, s.revenue, r.cost * s.share);
          }
          if (!r.shares.length) add('none', 'No customer (general trips)', null, 0, r.cost);
        } else if (q.groupBy === 'vehicle') {
          if (r.t.vehicleId) add(r.t.vehicleId, r.t.vehicle?.plateNumber ?? '—', r.t.vehicle?.vehicleClass ?? null, r.revenue, r.cost);
        } else {
          add(r.branchId ?? 'none', r.branchId ? (bn.get(r.branchId) ?? '—') : 'No branch', null, r.revenue, r.cost);
        }
      }
      if (q.groupBy === 'customer' && anyBilled) for (const g of groups.values()) g.billed = r2(billedByCustomer.get(g.key) ?? 0);
      // Vehicles and branches: the full ledger cost of the period (fixed costs and idle days included).
      if (tco && (q.groupBy === 'vehicle' || q.groupBy === 'branch')) {
        const full = new Map<string, number>();
        for (const v of tco.vehicles) {
          const key = q.groupBy === 'vehicle' ? v.id : (v.branchId ?? 'none');
          full.set(key, (full.get(key) ?? 0) + v.total);
          if (q.groupBy === 'vehicle' && !groups.has(v.id)) groups.set(v.id, { key: v.id, label: v.plateNumber, sub: v.vehicleClass, trips: 0, revenue: 0, cost: 0, billed: null });
          if (q.groupBy === 'branch' && !groups.has(key)) groups.set(key, { key, label: v.branchId ? (bn.get(v.branchId) ?? '—') : 'No branch', sub: null, trips: 0, revenue: 0, cost: 0, billed: null });
        }
        for (const g of groups.values()) g.extra = { fullCost: r2(full.get(g.key) ?? 0), fullMargin: r2(g.revenue - (full.get(g.key) ?? 0)) };
      }
      const rows = [...groups.values()]
        .map((g) => {
          const revenue = r2(g.revenue);
          const cost = r2(g.cost);
          return { ...g, revenue, cost, margin: r2(revenue - cost), marginPct: pct(revenue - cost, revenue), ...(g.extra ?? {}) };
        })
        .sort((a, b) => a.margin - b.margin);
      const revenue = r2(tripRows.reduce((a, r) => a + r.revenue, 0));
      const cost = r2(tripRows.reduce((a, r) => a + r.cost, 0));
      return {
        range: { from: q.from, to: q.to, currency: company.currency, groupBy: q.groupBy },
        totals: {
          trips: tripRows.length,
          revenue,
          cost,
          margin: r2(revenue - cost),
          marginPct: pct(revenue - cost, revenue),
          unrated: tripRows.filter((r) => !r.rated).length,
          lossMaking: rows.filter((r) => r.margin < 0).length,
          billed: anyBilled ? r2(billed.reduce((a, b) => a + n(b.netAmount), 0)) : null,
          fullCost: tco ? r2(tco.totals.total) : null,
        },
        rows,
        method:
          'Revenue: rate cards applied to each completed trip (delivery trips per customer; failed drops are not charged). Cost: trip km × the vehicle’s full cost per km + the trip’s own expenses (+ driver day cost). Vehicles and branches also show the full ledger cost of the period, which includes idle days.',
        localToday: localDate(new Date(), tz),
      };
    });
  }

  async profitabilityCsv(user: AuthUser, q: { from: string; to: string; groupBy: GroupBy }) {
    const p = await this.profitability(user, q);
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ['name', 'detail', 'trips', 'revenue', 'cost', 'margin', 'margin_pct', 'billed'];
    return [head.join(','), ...p.rows.map((r) => [r.label, r.sub, r.trips, r.revenue, r.cost, r.margin, r.marginPct, r.billed].map(esc).join(','))].join('\n') + '\n';
  }
}
