import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { upsertOrderSchema, UpsertOrderInput, WebhookEvent } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { EDITABLE, lineRows, orderColumns, payloadHash } from './order-mapping';
import { WebhooksService } from './webhooks.service';

const SOURCE = 'dms';
const include = { customer: true, lines: { orderBy: { lineNo: 'asc' as const } } } satisfies Prisma.DeliveryOrderInclude;
type OrderRow = Prisma.DeliveryOrderGetPayload<{ include: typeof include }>;
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

/** Public contract representation (no internal ids except `fmsId`). */
export function toApiOrder(o: OrderRow) {
  return {
    externalRef: o.externalRef,
    fmsId: o.id,
    status: o.status,
    version: o.version,
    priority: o.priority,
    orderDate: o.orderDate,
    deliveryWindow: o.windowStart && o.windowEnd ? { start: o.windowStart, end: o.windowEnd } : null,
    customer: {
      code: o.customer.code,
      name: o.customer.name,
      phone: o.customer.phone,
      email: o.customer.email,
      address: o.customer.address,
      township: o.customer.township,
      city: o.customer.city,
      latitude: o.customer.latitude,
      longitude: o.customer.longitude,
    },
    address: o.address,
    latitude: o.latitude,
    longitude: o.longitude,
    contactName: o.contactName,
    contactPhone: o.contactPhone,
    codAmount: num(o.codAmount),
    totalWeightKg: num(o.totalWeightKg),
    totalVolumeM3: num(o.totalVolumeM3),
    notes: o.notes,
    lines: o.lines.map((l) => ({ lineNo: l.lineNo, sku: l.sku, description: l.description, quantity: Number(l.quantity), uom: l.uom, weightKg: num(l.weightKg), volumeM3: num(l.volumeM3) })),
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export type UpsertResult = { result: 'created' | 'updated' | 'unchanged'; order: ReturnType<typeof toApiOrder> };

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  async upsert(companyId: string, externalRef: string, input: UpsertOrderInput): Promise<UpsertResult> {
    try {
      return await this.upsertOnce(companyId, externalRef, input);
    } catch (e) {
      // Two concurrent first PUTs of the same order: the loser retries as an update.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.upsertOnce(companyId, externalRef, input);
      throw e;
    }
  }

  private upsertOnce(companyId: string, externalRef: string, input: UpsertOrderInput): Promise<UpsertResult> {
    const hash = payloadHash(input);
    return this.db.tenant(companyId, async (tx) => {
      const existing = await tx.deliveryOrder.findUnique({ where: { companyId_source_externalRef: { companyId, source: SOURCE, externalRef } }, include });
      if (existing && existing.payloadHash === hash) return { result: 'unchanged', order: toApiOrder(existing) };
      if (existing && !EDITABLE.includes(existing.status)) {
        throw new ConflictException(`Order ${externalRef} is ${existing.status} and can no longer be changed`);
      }
      const c = input.customer;
      const customerData = { name: c.name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null, township: c.township ?? null, city: c.city ?? null, latitude: c.latitude ?? null, longitude: c.longitude ?? null };
      const customer = await tx.customer.upsert({
        where: { companyId_code: { companyId, code: c.code } },
        create: { companyId, code: c.code, ...customerData },
        update: customerData,
      });
      const lines = lineRows(input).map((l) => ({ ...l, companyId }));
      let order: OrderRow;
      if (!existing) {
        order = await tx.deliveryOrder.create({
          data: { companyId, source: SOURCE, externalRef, customerId: customer.id, payloadHash: hash, ...orderColumns(input), lines: { create: lines } },
          include,
        });
      } else {
        await tx.deliveryOrderLine.deleteMany({ where: { orderId: existing.id } });
        order = await tx.deliveryOrder.update({
          where: { id: existing.id },
          data: { customerId: customer.id, payloadHash: hash, version: { increment: 1 }, ...orderColumns(input), lines: { create: lines } },
          include,
        });
      }
      const api = toApiOrder(order);
      await this.webhooks.emit(tx, companyId, existing ? WebhookEvent.ORDER_UPDATED : WebhookEvent.ORDER_RECEIVED, api);
      return { result: existing ? 'updated' : 'created', order: api };
    });
  }

  async batch(companyId: string, items: { externalRef: string; order?: unknown }[]) {
    const results = [];
    for (const it of items) {
      const parsed = upsertOrderSchema.safeParse(it.order);
      if (!parsed.success) {
        results.push({ externalRef: it.externalRef, result: 'error', status: 400, errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
        continue;
      }
      try {
        const r = await this.upsert(companyId, it.externalRef, parsed.data);
        results.push({ externalRef: it.externalRef, result: r.result, status: r.result === 'created' ? 201 : 200, version: r.order.version, orderStatus: r.order.status });
      } catch (e) {
        const status = e instanceof ConflictException ? 409 : 500;
        results.push({ externalRef: it.externalRef, result: 'error', status, errors: [{ path: '', message: status === 409 ? (e as Error).message : 'Internal error' }] });
      }
    }
    return { results };
  }

  cancel(companyId: string, externalRef: string, reason?: string | null) {
    return this.db.tenant(companyId, async (tx) => {
      const o = await this.findByRef(tx, companyId, externalRef);
      if (o.status === 'CANCELLED') return toApiOrder(o);
      if (!EDITABLE.includes(o.status)) throw new ConflictException(`Order ${externalRef} is ${o.status} and can no longer be cancelled`);
      const updated = await tx.deliveryOrder.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null, version: { increment: 1 } }, include });
      const api = toApiOrder(updated);
      await this.webhooks.emit(tx, companyId, WebhookEvent.ORDER_CANCELLED, api);
      return api;
    });
  }

  get(companyId: string, externalRef: string) {
    return this.db.tenant(companyId, async (tx) => toApiOrder(await this.findByRef(tx, companyId, externalRef)));
  }

  /** Changes feed for the DMS: orders updated at/after `updatedSince`, oldest first, with a cursor. */
  list(companyId: string, q: { updatedSince?: Date; status?: string; limit: number; cursor?: string }) {
    return this.db.tenant(companyId, async (tx) => {
      let after: { updatedAt: Date; id: string } | null = null;
      if (q.cursor) {
        const [t, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
        after = { updatedAt: new Date(t), id };
      }
      const rows = await tx.deliveryOrder.findMany({
        where: {
          ...(q.status && { status: q.status as never }),
          ...(q.updatedSince && { updatedAt: { gte: q.updatedSince } }),
          ...(after && { OR: [{ updatedAt: { gt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { gt: after.id } }] }),
        },
        include,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(toApiOrder),
        nextCursor: more && last ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`).toString('base64url') : null,
      };
    });
  }

  /** Web console list. */
  adminList(user: AuthUser, q: { status?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.DeliveryOrderWhereInput = {
      ...(q.status && { status: q.status as never }),
      ...(q.search && { OR: [{ externalRef: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }] }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.deliveryOrder.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.deliveryOrder.count({ where }),
      ]);
      return { items: items.map(toApiOrder), total, page: q.page, pageSize: q.pageSize };
    });
  }

  private async findByRef(tx: Tx, companyId: string, externalRef: string) {
    const o = await tx.deliveryOrder.findUnique({ where: { companyId_source_externalRef: { companyId, source: SOURCE, externalRef } }, include });
    if (!o) throw new NotFoundException(`Order ${externalRef} not found`);
    return o;
  }
}
