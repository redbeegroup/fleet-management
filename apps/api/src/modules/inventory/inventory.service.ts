import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartInput, ReceiveStockInput, Role, StockCountInput, SupplierInput, TransferStockInput, WebhookEvent } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { count, giveBack, issue, money, receive, reorderSuggestion, StockError, StockState } from './stock';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

/** Parts catalogue, stock per branch store (moving average cost) and suppliers. */
@Injectable()
export class InventoryService {
  private readonly log = new Logger('Inventory');

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------- suppliers

  suppliers(user: AuthUser, q: { kind?: string; active?: boolean }) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.supplier.findMany({ where: { ...(q.kind && { kinds: { has: q.kind } }), ...(q.active !== undefined && { active: q.active }) }, orderBy: { name: 'asc' } }),
    );
  }

  createSupplier(user: AuthUser, body: SupplierInput) {
    return this.db.tenant(user.companyId, (tx) => tx.supplier.create({ data: { ...body, kinds: [...new Set(body.kinds)], companyId: user.companyId } }));
  }

  updateSupplier(user: AuthUser, id: string, body: Partial<SupplierInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.supplier.findFirst({ where: { id } }))) throw new NotFoundException('Supplier not found');
      return tx.supplier.update({ where: { id }, data: { ...body, ...(body.kinds && { kinds: [...new Set(body.kinds)] }) } });
    });
  }

  // ---------------------------------------------------------------- parts

  parts(user: AuthUser, q: { search?: string; active?: boolean }) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.part.findMany({
        where: {
          ...(q.active !== undefined && { active: q.active }),
          ...(q.search && { OR: [{ partNo: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }),
        },
        include: { stocks: { select: { branchId: true, qtyOnHand: true, avgCost: true } } },
        orderBy: { partNo: 'asc' },
        take: 500,
      }),
    );
  }

  private async checkSupplier(tx: Tx, id?: string | null) {
    if (id && !(await tx.supplier.findFirst({ where: { id } }))) throw new BadRequestException('Supplier not found');
  }

  createPart(user: AuthUser, body: PartInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.checkSupplier(tx, body.supplierId);
      return tx.part.create({ data: { ...body, companyId: user.companyId } });
    });
  }

  updatePart(user: AuthUser, id: string, body: Partial<PartInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.part.findFirst({ where: { id } }))) throw new NotFoundException('Part not found');
      await this.checkSupplier(tx, body.supplierId);
      return tx.part.update({ where: { id }, data: body });
    });
  }

  /** Catalogue import (rows parsed from CSV by the client): upsert by part number. */
  importParts(user: AuthUser, rows: PartInput[]) {
    return this.db.tenant(user.companyId, async (tx) => {
      let created = 0;
      let updated = 0;
      for (const r of rows) {
        const cur = await tx.part.findFirst({ where: { partNo: r.partNo } });
        if (cur) {
          await tx.part.update({ where: { id: cur.id }, data: r });
          updated++;
        } else {
          await tx.part.create({ data: { ...r, companyId: user.companyId } });
          created++;
        }
      }
      return { created, updated };
    });
  }

  // ---------------------------------------------------------------- stock core

  private async branch(tx: Tx, id: string) {
    const b = await tx.branch.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!b) throw new BadRequestException('Store (branch) not found');
    return b;
  }

  /** Locks (creating if needed) the stock row of a part in a store. */
  private async lockStock(tx: Tx, companyId: string, partId: string, branchId: string) {
    await tx.$executeRaw`INSERT INTO part_stocks (id, company_id, part_id, branch_id, updated_at)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${partId}::uuid, ${branchId}::uuid, now())
      ON CONFLICT (part_id, branch_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<{ id: string; qty_on_hand: Prisma.Decimal; avg_cost: Prisma.Decimal }[]>`
      SELECT id, qty_on_hand, avg_cost FROM part_stocks WHERE part_id = ${partId}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`;
    return { id: row.id, state: { qty: n(row.qty_on_hand), avgCost: n(row.avg_cost) } as StockState };
  }

  private async book(
    tx: Tx,
    user: AuthUser,
    stockId: string,
    state: StockState,
    m: { partId: string; branchId: string; kind: string; qty: number; unitCost: number; value: number; workOrderId?: string | null; lineId?: string | null; supplierId?: string | null; reference?: string | null; poNumber?: string | null; reason?: string | null; fileId?: string | null; occurredAt?: Date },
  ) {
    await tx.partStock.update({ where: { id: stockId }, data: { qtyOnHand: state.qty, avgCost: state.avgCost } });
    return tx.stockMovement.create({ data: { ...m, companyId: user.companyId, qtyAfter: state.qty, createdBy: user.userId } });
  }

  private async part(tx: Tx, id: string) {
    const p = await tx.part.findFirst({ where: { id } });
    if (!p) throw new BadRequestException('Part not found');
    return p;
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof StockError) throw new ConflictException(e.message);
      throw e;
    }
  }

  /** Issues stock to a work order line (called inside the work order transaction). */
  async issueTx(tx: Tx, user: AuthUser, a: { partId: string; branchId: string; qty: number; workOrderId: string; lineId: string; reference: string }) {
    const part = await this.part(tx, a.partId);
    await this.branch(tx, a.branchId);
    const s = await this.lockStock(tx, user.companyId, a.partId, a.branchId);
    const r = this.guard(() => issue(s.state, a.qty));
    await this.book(tx, user, s.id, r.state, { partId: a.partId, branchId: a.branchId, kind: 'ISSUE', qty: -a.qty, unitCost: r.unitCost, value: -r.value, workOrderId: a.workOrderId, lineId: a.lineId, reference: a.reference });
    return { part, unitCost: r.unitCost, value: r.value };
  }

  /** Puts the goods of a removed work order line back into its store at the cost they left with. */
  async returnTx(tx: Tx, user: AuthUser, a: { partId: string; branchId: string; qty: number; unitCost: number; workOrderId: string; lineId: string; reference: string }) {
    const s = await this.lockStock(tx, user.companyId, a.partId, a.branchId);
    const state = this.guard(() => giveBack(s.state, a.qty, a.unitCost));
    await this.book(tx, user, s.id, state, { partId: a.partId, branchId: a.branchId, kind: 'RETURN', qty: a.qty, unitCost: a.unitCost, value: money(a.qty * a.unitCost), workOrderId: a.workOrderId, lineId: a.lineId, reference: a.reference });
  }

  // ---------------------------------------------------------------- stock operations

  receive(user: AuthUser, body: ReceiveStockInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.branch(tx, body.branchId);
      await this.checkSupplier(tx, body.supplierId);
      const out = [];
      for (const l of body.lines) {
        await this.part(tx, l.partId);
        const s = await this.lockStock(tx, user.companyId, l.partId, body.branchId);
        const state = this.guard(() => receive(s.state, l.qty, l.unitCost));
        out.push(await this.book(tx, user, s.id, state, { partId: l.partId, branchId: body.branchId, kind: 'RECEIPT', qty: l.qty, unitCost: l.unitCost, value: money(l.qty * l.unitCost), supplierId: body.supplierId, reference: body.reference, poNumber: body.poNumber ?? null, fileId: body.fileId, occurredAt: body.occurredAt }));
      }
      return { movements: out.length, value: money(out.reduce((a, m) => a + n(m.value), 0)) };
    });
  }

  transfer(user: AuthUser, body: TransferStockInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [from, to] = [await this.branch(tx, body.fromBranchId), await this.branch(tx, body.toBranchId)];
      for (const l of body.lines) {
        await this.part(tx, l.partId);
        // Lock both rows in a fixed order to avoid deadlocks between opposite transfers.
        const [first, second] = [from.id, to.id].sort();
        const a = await this.lockStock(tx, user.companyId, l.partId, first);
        const b = await this.lockStock(tx, user.companyId, l.partId, second);
        const src = first === from.id ? a : b;
        const dst = first === from.id ? b : a;
        const out = this.guard(() => issue(src.state, l.qty));
        const ref = body.reference ?? `${from.name} → ${to.name}`;
        await this.book(tx, user, src.id, out.state, { partId: l.partId, branchId: from.id, kind: 'TRANSFER_OUT', qty: -l.qty, unitCost: out.unitCost, value: -out.value, reference: ref });
        const inState = receive(dst.state, l.qty, out.unitCost);
        await this.book(tx, user, dst.id, inState, { partId: l.partId, branchId: to.id, kind: 'TRANSFER_IN', qty: l.qty, unitCost: out.unitCost, value: out.value, reference: ref });
      }
      return { lines: body.lines.length };
    });
  }

  stockCount(user: AuthUser, body: StockCountInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.branch(tx, body.branchId);
      let changed = 0;
      let value = 0;
      for (const l of body.lines) {
        await this.part(tx, l.partId);
        const s = await this.lockStock(tx, user.companyId, l.partId, body.branchId);
        const c = this.guard(() => count(s.state, l.countedQty));
        if (c.diff === 0) continue;
        await this.book(tx, user, s.id, c.state, { partId: l.partId, branchId: body.branchId, kind: 'ADJUST', qty: c.diff, unitCost: s.state.avgCost, value: c.value, reason: body.reason });
        changed++;
        value += c.value;
      }
      return { changed, value: money(value) };
    });
  }

  // ---------------------------------------------------------------- reads

  stock(user: AuthUser, q: { branchId?: string; search?: string; belowMin?: boolean }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const [rows, branches] = await Promise.all([
        tx.partStock.findMany({
          where: {
            ...(q.branchId && { branchId: q.branchId }),
            ...(q.search && { part: { OR: [{ partNo: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } }),
          },
          include: { part: { select: { id: true, partNo: true, name: true, unit: true, category: true, minQty: true, reorderQty: true, supplierId: true, active: true } } },
          orderBy: [{ part: { partNo: 'asc' } }],
        }),
        tx.branch.findMany({ select: { id: true, name: true } }),
      ]);
      const bName = new Map(branches.map((b) => [b.id, b.name]));
      const items = rows
        .map((r) => {
          const min = r.minQty != null ? n(r.minQty) : n(r.part.minQty);
          const qty = n(r.qtyOnHand);
          return {
            id: r.id,
            part: r.part,
            branchId: r.branchId,
            branchName: bName.get(r.branchId) ?? '—',
            qtyOnHand: qty,
            avgCost: n(r.avgCost),
            value: money(qty * n(r.avgCost)),
            minQty: min,
            bin: r.bin,
            belowMin: min > 0 && qty <= min,
            suggestedOrder: reorderSuggestion(qty, min, n(r.part.reorderQty)),
          };
        })
        .filter((r) => !q.belowMin || r.belowMin);
      const byBranch = new Map<string, number>();
      for (const r of items) byBranch.set(r.branchName, money((byBranch.get(r.branchName) ?? 0) + r.value));
      return { items, totals: { value: money(items.reduce((a, r) => a + r.value, 0)), byBranch: Object.fromEntries(byBranch), belowMin: items.filter((r) => r.belowMin).length } };
    });
  }

  updateStock(user: AuthUser, id: string, body: { minQty?: number | null; bin?: string | null }) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.partStock.findFirst({ where: { id } }))) throw new NotFoundException('Stock row not found');
      return tx.partStock.update({ where: { id }, data: body });
    });
  }

  movements(user: AuthUser, q: { partId?: string; branchId?: string; kind?: string; workOrderId?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
    const where: Prisma.StockMovementWhereInput = {
      ...(q.partId && { partId: q.partId }),
      ...(q.branchId && { branchId: q.branchId }),
      ...(q.kind && { kind: q.kind }),
      ...(q.workOrderId && { workOrderId: q.workOrderId }),
      ...((q.from || q.to) && { occurredAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.stockMovement.findMany({ where, include: { part: { select: { partNo: true, name: true, unit: true } } }, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.stockMovement.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Movements as CSV (for SAP upload until the API integration exists). Formula-safe. */
  async movementsCsv(user: AuthUser, q: { from?: Date; to?: Date; branchId?: string }) {
    const { items } = await this.movements(user, { ...q, page: 1, pageSize: 50_000 });
    const branches = await this.db.tenant(user.companyId, (tx) => tx.branch.findMany({ select: { id: true, code: true } }));
    const parts = await this.db.tenant(user.companyId, (tx) => tx.part.findMany({ select: { id: true, externalRef: true } }));
    const code = new Map(branches.map((b) => [b.id, b.code]));
    const ext = new Map(parts.map((p) => [p.id, p.externalRef]));
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const cols = ['occurred_at', 'store', 'part_no', 'sap_material', 'part', 'kind', 'qty', 'unit', 'unit_cost', 'value', 'reference', 'work_order_id', 'reason'];
    const lines = items.map((m) => [m.occurredAt.toISOString(), code.get(m.branchId), m.part.partNo, ext.get(m.partId), m.part.name, m.kind, n(m.qty), m.part.unit, n(m.unitCost), n(m.value), m.reference, m.workOrderId, m.reason].map(cell).join(','));
    return [cols.join(','), ...lines].join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- alerts

  /** Daily: items at or below minimum, once a week per item and store. */
  async lowStockAlerts(now = new Date()): Promise<number> {
    const rows = await this.db.system((tx) =>
      tx.partStock.findMany({ where: { part: { active: true } }, include: { part: { select: { partNo: true, name: true, minQty: true, reorderQty: true, unit: true } } } }),
    );
    const branches = await this.db.system((tx) => tx.branch.findMany({ select: { id: true, name: true } }));
    const bName = new Map(branches.map((b) => [b.id, b.name]));
    let sent = 0;
    for (const r of rows) {
      const min = r.minQty != null ? n(r.minQty) : n(r.part.minQty);
      const qty = n(r.qtyOnHand);
      if (!(min > 0 && qty <= min)) continue;
      if (r.alertedAt && now.getTime() - r.alertedAt.getTime() < 7 * 86_400_000) continue;
      const order = reorderSuggestion(qty, min, n(r.part.reorderQty));
      const store = bName.get(r.branchId) ?? 'store';
      sent += await this.notifications.notify({
        companyId: r.companyId,
        roles: [Role.STOREKEEPER, Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
        topic: 'inventory.low_stock',
        severity: qty <= 0 ? 'warning' : 'info',
        title: `Low stock: ${r.part.partNo} ${r.part.name} (${store})`,
        body: `${qty} ${r.part.unit} on hand, minimum ${min}. Suggested order: ${order ?? '—'} ${r.part.unit}.`,
        data: { partId: r.partId, branchId: r.branchId, link: '/parts?tab=reorder' },
        dedupeKey: `stock-low:${r.id}:${now.toISOString().slice(0, 10)}`,
      });
      await this.db.tenant(r.companyId, async (tx) => {
        await tx.partStock.update({ where: { id: r.id }, data: { alertedAt: now } });
        await this.webhooks.emit(tx, r.companyId, WebhookEvent.STOCK_LOW, { partId: r.partId, partNo: r.part.partNo, name: r.part.name, branchId: r.branchId, store, qtyOnHand: qty, minQty: min, suggestedOrder: order });
      });
    }
    this.log.log(`Low stock alerts: ${sent}`);
    return sent;
  }
}
