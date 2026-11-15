import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateLoadInput, StopOutcomeInput, UpdateCustomerInput, UpdateLoadInput, WebhookEvent } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { dayBounds } from '../../common/time';
import { BLOCKING_VEHICLE_STATUSES } from '../dispatch/eligibility';
import { TripsService } from '../dispatch/trips.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { autofill } from './autofill';
import { checkLoad, describeViolations, LoadItem, loadTotals, VehicleCapacity } from './capacity';
import { routeKm, sequenceStops } from './sequence';
import { orderOutcome, PLANNABLE } from './status';

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
const orderSelect = {
  id: true,
  externalRef: true,
  status: true,
  priority: true,
  branchId: true,
  deliveryDate: true,
  windowStart: true,
  windowEnd: true,
  address: true,
  latitude: true,
  longitude: true,
  contactName: true,
  contactPhone: true,
  totalWeightKg: true,
  totalVolumeM3: true,
  totalCases: true,
  totalPallets: true,
  codAmount: true,
  notes: true,
  tripId: true,
  stopId: true,
  failureReason: true,
  version: true,
  customerId: true,
  customer: { select: { id: true, code: true, name: true, phone: true, address: true, township: true, city: true, latitude: true, longitude: true } },
} satisfies Prisma.DeliveryOrderSelect;
type OrderRow = Prisma.DeliveryOrderGetPayload<{ select: typeof orderSelect }>;

const vehicleSelect = {
  id: true,
  plateNumber: true,
  vehicleClass: true,
  status: true,
  branchId: true,
  capacityKg: true,
  capacityM3: true,
  capacityCases: true,
  capacityPallets: true,
  maxStops: true,
} satisfies Prisma.VehicleSelect;

export function toLoadItem(o: OrderRow): LoadItem {
  return {
    id: o.id,
    externalRef: o.externalRef,
    customerId: o.customerId,
    priority: o.priority,
    township: o.customer.township,
    city: o.customer.city,
    lat: o.latitude ?? o.customer.latitude,
    lng: o.longitude ?? o.customer.longitude,
    weightKg: n(o.totalWeightKg),
    volumeM3: n(o.totalVolumeM3),
    cases: n(o.totalCases),
    pallets: n(o.totalPallets),
  };
}

function toCapacity(v: Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>): VehicleCapacity {
  return { id: v.id, plateNumber: v.plateNumber, capacityKg: n(v.capacityKg), capacityM3: n(v.capacityM3), capacityCases: v.capacityCases, capacityPallets: v.capacityPallets, maxStops: v.maxStops };
}

@Injectable()
export class LogisticsService {
  constructor(
    private readonly db: PrismaService,
    private readonly trips: TripsService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ------------------------------------------------------------ planning

  planning(user: AuthUser, q: { date: string; branchId: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { depot, settings } = await this.context(tx, q.branchId);
      const orders = await this.plannable(tx, q.date, q.branchId);
      const vehicles = await tx.vehicle.findMany({
        where: { deletedAt: null, status: { notIn: [...BLOCKING_VEHICLE_STATUSES] }, OR: [{ branchId: q.branchId }, { branchId: null }] },
        select: vehicleSelect,
        orderBy: { plateNumber: 'asc' },
      });
      const loads = await this.loadsOn(tx, q.date, q.branchId);
      const drivers = await tx.driver.findMany({
        where: { active: true, OR: [{ branchId: q.branchId }, { branchId: null }] },
        select: { id: true, fullName: true, employeeNo: true },
        orderBy: { fullName: 'asc' },
      });
      return {
        date: q.date,
        depot,
        settings: { defaultMaxStops: settings.defaultMaxStops, departureTime: settings.departureTime },
        orders: orders.map((o) => ({ ...this.orderView(o), item: toLoadItem(o) })),
        totals: loadTotals(orders.map(toLoadItem)),
        vehicles: vehicles.map((v) => ({
          ...toCapacity(v),
          vehicleClass: v.vehicleClass,
          status: v.status,
          maxStopsEffective: v.maxStops ?? settings.defaultMaxStops,
          loads: loads.filter((l) => l.vehicleId === v.id).map((l) => ({ tripId: l.id, tripNo: l.tripNo, status: l.status })),
        })),
        drivers,
        loads: loads.map((l) => ({ tripId: l.id, tripNo: l.tripNo, status: l.status, vehicleId: l.vehicleId, plateNumber: l.vehicle?.plateNumber ?? null, driver: l.driver?.fullName ?? null, stops: l._count.stops })),
      };
    });
  }

  /** Proposal only; nothing is saved. Vehicles that already have a load that day are skipped unless listed. */
  autofill(user: AuthUser, q: { date: string; branchId: string; vehicleIds?: string[] }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { depot, settings } = await this.context(tx, q.branchId);
      const orders = await this.plannable(tx, q.date, q.branchId);
      const busy = new Set((await this.loadsOn(tx, q.date, q.branchId)).map((l) => l.vehicleId));
      const vehicles = await tx.vehicle.findMany({
        where: {
          deletedAt: null,
          status: { notIn: [...BLOCKING_VEHICLE_STATUSES] },
          ...(q.vehicleIds?.length ? { id: { in: q.vehicleIds } } : { OR: [{ branchId: q.branchId }, { branchId: null }] }),
        },
        select: vehicleSelect,
      });
      const usable = vehicles.filter((v) => q.vehicleIds?.length || !busy.has(v.id)).map(toCapacity);
      const point = depot.latitude != null && depot.longitude != null ? { lat: depot.latitude, lng: depot.longitude } : null;
      const r = autofill(orders.map(toLoadItem), usable, point, settings.defaultMaxStops);
      const byId = new Map(orders.map((o) => [o.id, o]));
      return {
        loads: r.loads.map((l) => {
          const v = usable.find((x) => x.id === l.vehicleId)!;
          const items = l.orderIds.map((id) => toLoadItem(byId.get(id)!));
          return { ...l, plateNumber: v.plateNumber, totals: loadTotals(items), check: checkLoad(v, loadTotals(items), settings.defaultMaxStops) };
        }),
        unplaced: r.unplaced,
      };
    });
  }

  // --------------------------------------------------------------- loads

  async createLoad(user: AuthUser, input: CreateLoadInput) {
    const trip = await this.db.tenant(user.companyId, async (tx) => {
      const { depot, settings, tz } = await this.context(tx, input.branchId);
      const orders = await this.lockOrders(tx, input.orderIds);
      for (const o of orders) {
        if (o.branchId !== input.branchId) throw new BadRequestException(`Order ${o.externalRef} ships from another depot`);
        if (!(PLANNABLE as readonly string[]).includes(o.status) || (o.status === 'RECEIVED' && o.tripId)) throw new ConflictException(`Order ${o.externalRef} is ${o.status.toLowerCase()} and cannot be planned`);
      }
      const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null }, select: vehicleSelect });
      if (!vehicle) throw new BadRequestException('Vehicle not found');
      this.assertCapacity(toCapacity(vehicle), orders, settings.defaultMaxStops);

      const stops = this.buildStops(orders, depot);
      const km = routeKm(depot.latitude != null ? { lat: depot.latitude, lng: depot.longitude! } : null, stops);
      const start = input.departAt ?? this.departure(input.date, settings.departureTime, tz);
      const minutes = stops.length * settings.serviceMinutesPerStop + Math.ceil((km / settings.avgSpeedKmh) * 60);
      const t = await this.trips.createIn(
        tx,
        user,
        {
          originName: depot.name,
          originLat: depot.latitude,
          originLng: depot.longitude,
          destinationName: depot.name,
          destinationLat: depot.latitude,
          destinationLng: depot.longitude,
          plannedStart: start,
          plannedEnd: new Date(start.getTime() + Math.max(30, minutes) * 60_000),
          branchId: input.branchId,
          purpose: `Delivery: ${stops.length} stop(s), ${orders.length} order(s)`,
          cargoDescription: `${orders.length} delivery order(s)`,
          cargoWeightKg: loadTotals(orders.map(toLoadItem)).kg || null,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
        } as Parameters<TripsService['create']>[1],
        { kind: 'DELIVERY', plannedDate: new Date(input.date) },
      );
      await this.writeStops(tx, user.companyId, t.id, stops);
      await this.orderHook(tx, user.companyId, t.id, WebhookEvent.ORDER_PLANNED);
      return t;
    });
    await this.trips.afterAssign(trip);
    return this.load(user, trip.id);
  }

  async updateLoad(user: AuthUser, tripId: string, input: UpdateLoadInput) {
    const res = await this.db.tenant(user.companyId, async (tx) => {
      const trip = await this.lockLoad(tx, tripId);
      if (trip.status !== 'PLANNED' && trip.status !== 'ASSIGNED') throw new BadRequestException(`A ${trip.status.toLowerCase()} load cannot be changed`);
      const { depot, settings } = await this.context(tx, trip.branchId!);
      if (input.removeOrderIds?.length) {
        await tx.deliveryOrder.updateMany({
          where: { id: { in: input.removeOrderIds }, tripId },
          data: { status: 'RECEIVED', tripId: null, stopId: null, version: { increment: 1 } },
        });
      }
      let added: OrderRow[] = [];
      if (input.addOrderIds?.length) {
        added = await this.lockOrders(tx, input.addOrderIds);
        for (const o of added) {
          if (o.branchId !== trip.branchId) throw new BadRequestException(`Order ${o.externalRef} ships from another depot`);
          if (!(PLANNABLE as readonly string[]).includes(o.status) || o.tripId === tripId) throw new ConflictException(`Order ${o.externalRef} is ${o.status.toLowerCase()} and cannot be added`);
        }
      }
      const current = await tx.deliveryOrder.findMany({ where: { tripId }, select: orderSelect });
      const all = [...current, ...added];
      if (!all.length) throw new BadRequestException('A load needs at least one order; cancel the trip instead');
      let vehicleId = trip.vehicleId;
      if (input.vehicleId || input.driverId) {
        const v = input.vehicleId ?? trip.vehicleId;
        const d = input.driverId ?? trip.driverId;
        if (!v || !d) throw new BadRequestException('Give both vehicleId and driverId');
        await this.trips.assignIn(tx, user, tripId, { vehicleId: v, driverId: d });
        vehicleId = v;
      }
      if (vehicleId) {
        const v = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: vehicleSelect });
        this.assertCapacity(toCapacity(v), all, settings.defaultMaxStops);
      }
      // Rebuild stops: keep manual order (stopIds) or existing order, append new customers, drop empty stops.
      const existingStops = await tx.tripStop.findMany({ where: { tripId }, orderBy: { seq: 'asc' } });
      let order = existingStops.map((s) => s.customerId);
      if (input.stopIds) {
        const byId = new Map(existingStops.map((s) => [s.id, s.customerId]));
        if (input.stopIds.some((id) => !byId.has(id)) || new Set(input.stopIds).size !== existingStops.length) throw new BadRequestException('stopIds must list every stop of the load exactly once');
        order = input.stopIds.map((id) => byId.get(id)!);
      }
      const fresh = this.buildStops(all, depot);
      const known = fresh.filter((s) => order.includes(s.customerId)).sort((a, b) => order.indexOf(a.customerId) - order.indexOf(b.customerId));
      const newOnes = fresh.filter((s) => !order.includes(s.customerId));
      await tx.deliveryOrder.updateMany({ where: { tripId }, data: { stopId: null } });
      await tx.tripStop.deleteMany({ where: { tripId } });
      await tx.deliveryOrder.updateMany({ where: { id: { in: added.map((o) => o.id) } }, data: { tripId, status: 'PLANNED', failureReason: null, version: { increment: 1 } } });
      await this.writeStops(tx, user.companyId, tripId, [...known, ...newOnes]);
      if (added.length) await this.orderHook(tx, user.companyId, tripId, WebhookEvent.ORDER_PLANNED, { id: { in: added.map((o) => o.id) } });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: { vehicle: true, driver: true } });
    });
    if (input.vehicleId || input.driverId) await this.trips.afterAssign(res);
    return this.load(user, tripId);
  }

  loads(user: AuthUser, q: { date: string; branchId?: string }) {
    return this.db.tenant(user.companyId, async (tx) => {
      const rows = await tx.trip.findMany({
        where: { kind: 'DELIVERY', plannedDate: new Date(q.date), ...(q.branchId && { branchId: q.branchId }) },
        include: { vehicle: { select: vehicleSelect }, driver: { select: { id: true, fullName: true } }, stops: { select: { status: true } }, orders: { select: orderSelect } },
        orderBy: { plannedStart: 'asc' },
      });
      const settings = parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).logistics;
      return rows.map((t) => {
        const totals = loadTotals(t.orders.map(toLoadItem));
        return {
          tripId: t.id,
          tripNo: t.tripNo,
          status: t.status,
          plannedStart: t.plannedStart,
          vehicle: t.vehicle ? { id: t.vehicle.id, plateNumber: t.vehicle.plateNumber } : null,
          driver: t.driver,
          totals,
          check: t.vehicle ? checkLoad(toCapacity(t.vehicle), totals, settings.defaultMaxStops) : null,
          stops: { total: t.stops.length, done: t.stops.filter((s) => ['DELIVERED', 'PARTIAL', 'FAILED'].includes(s.status)).length },
          cod: t.orders.reduce((s, o) => s + (n(o.codAmount) ?? 0), 0),
        };
      });
    });
  }

  load(user: AuthUser, tripId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const t = await tx.trip.findFirst({
        where: { id: tripId, kind: 'DELIVERY' },
        include: {
          vehicle: { select: vehicleSelect },
          driver: { select: { id: true, fullName: true, employeeNo: true, phone: true } },
          stops: { orderBy: { seq: 'asc' }, include: { orders: { select: { ...orderSelect, lines: { orderBy: { lineNo: 'asc' } } }, orderBy: { externalRef: 'asc' } } } },
        },
      });
      if (!t) throw new NotFoundException('Load not found');
      const { depot, settings } = await this.context(tx, t.branchId!);
      const orders = t.stops.flatMap((s) => s.orders);
      const totals = loadTotals(orders.map(toLoadItem));
      return {
        tripId: t.id,
        tripNo: t.tripNo,
        status: t.status,
        plannedDate: t.plannedDate?.toISOString().slice(0, 10) ?? null,
        plannedStart: t.plannedStart,
        plannedEnd: t.plannedEnd,
        actualStart: t.actualStart,
        actualEnd: t.actualEnd,
        depot,
        vehicle: t.vehicle ? { ...toCapacity(t.vehicle), vehicleClass: t.vehicle.vehicleClass } : null,
        driver: t.driver,
        totals,
        check: t.vehicle ? checkLoad(toCapacity(t.vehicle), totals, settings.defaultMaxStops) : null,
        cod: Math.round(orders.reduce((s, o) => s + (n(o.codAmount) ?? 0), 0) * 100) / 100,
        routeKm: routeKm(depot.latitude != null ? { lat: depot.latitude, lng: depot.longitude! } : null, t.stops.map((s) => ({ lat: s.latitude, lng: s.longitude }))),
        stops: t.stops.map((s) => ({
          id: s.id,
          seq: s.seq,
          status: s.status,
          name: s.name,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          contactName: s.contactName,
          contactPhone: s.contactPhone,
          arrivedAt: s.arrivedAt,
          completedAt: s.completedAt,
          failureReason: s.failureReason,
          notes: s.notes,
          customer: { id: s.customerId },
          orders: s.orders.map((o) => ({
            ...this.orderView(o),
            lines: o.lines.map((l) => ({ lineNo: l.lineNo, sku: l.sku, description: l.description, quantity: Number(l.quantity), uom: l.uom, cases: n(l.cases), pallets: n(l.pallets), weightKg: n(l.weightKg), deliveredQty: n(l.deliveredQty) })),
          })),
        })),
        failureReasons: settings.failureReasons,
      };
    });
  }

  // --------------------------------------------------------------- stops

  async arrive(user: AuthUser, stopId: string, driverId?: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { stop } = await this.stopFor(tx, stopId, driverId);
      if (stop.status !== 'PENDING') throw new BadRequestException(`Stop is already ${stop.status.toLowerCase()}`);
      return tx.tripStop.update({ where: { id: stopId }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
    });
  }

  async complete(user: AuthUser, stopId: string, input: StopOutcomeInput, driverId?: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { stop } = await this.stopFor(tx, stopId, driverId);
      if (!['PENDING', 'ARRIVED'].includes(stop.status)) throw new BadRequestException(`Stop is already ${stop.status.toLowerCase()}`);
      const orders = await tx.deliveryOrder.findMany({ where: { stopId }, include: { lines: true } });
      const now = new Date();
      for (const o of orders) {
        const lines = o.lines.map((l) => {
          const given = input.deliveredLines?.find((d) => d.orderId === o.id && d.lineNo === l.lineNo);
          const qty = input.outcome === 'FAILED' ? 0 : input.outcome === 'DELIVERED' ? Number(l.quantity) : given ? Math.min(given.quantity, Number(l.quantity)) : Number(l.quantity);
          return { id: l.id, quantity: Number(l.quantity), deliveredQty: qty };
        });
        for (const l of lines) await tx.deliveryOrderLine.update({ where: { id: l.id }, data: { deliveredQty: l.deliveredQty } });
        const status = orderOutcome(input.outcome, lines);
        await tx.deliveryOrder.update({
          where: { id: o.id },
          data: { status, deliveredAt: status === 'FAILED' ? null : now, failureReason: status === 'FAILED' ? (input.reason ?? 'Not delivered') : status === 'PARTIAL' ? (input.reason ?? null) : null, version: { increment: 1 } },
        });
        const event = status === 'DELIVERED' ? WebhookEvent.ORDER_DELIVERED : status === 'PARTIAL' ? WebhookEvent.ORDER_PARTIALLY_DELIVERED : WebhookEvent.ORDER_FAILED;
        await this.webhooks.emit(tx, user.companyId, event, {
          externalRef: o.externalRef,
          fmsId: o.id,
          status,
          version: o.version + 1,
          tripId: stop.tripId,
          deliveredAt: status === 'FAILED' ? null : now,
          reason: input.reason ?? null,
          lines: o.lines.map((l) => ({ lineNo: l.lineNo, sku: l.sku, quantity: Number(l.quantity), deliveredQty: lines.find((x) => x.id === l.id)!.deliveredQty })),
        });
      }
      return tx.tripStop.update({
        where: { id: stopId },
        data: { status: input.outcome, completedAt: now, arrivedAt: stop.arrivedAt ?? now, failureReason: input.outcome === 'DELIVERED' ? null : (input.reason ?? null), notes: input.notes ?? null },
      });
    });
  }

  // ----------------------------------------------------------- customers

  customers(user: AuthUser, q: { search?: string; page: number; pageSize: number }) {
    const where: Prisma.CustomerWhereInput = q.search
      ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { township: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.customer.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { orders: true } } } }),
        tx.customer.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  updateCustomer(user: AuthUser, id: string, input: UpdateCustomerInput) {
    if ((input.latitude == null) !== (input.longitude == null) && (input.latitude !== undefined || input.longitude !== undefined)) {
      throw new BadRequestException('latitude and longitude go together');
    }
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.customer.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Customer not found');
      return tx.customer.update({ where: { id }, data: input });
    });
  }

  // ------------------------------------------------------------- helpers

  private async context(tx: Tx, branchId: string) {
    const [company, depot] = await Promise.all([
      tx.company.findFirstOrThrow({ select: { timezone: true, settings: true } }),
      tx.branch.findFirst({ where: { id: branchId }, select: { id: true, code: true, name: true, address: true, latitude: true, longitude: true } }),
    ]);
    if (!depot) throw new BadRequestException('Depot (branch) not found');
    return { depot, settings: parseCompanySettings(company.settings).logistics, tz: company.timezone };
  }

  /** RECEIVED orders for the day, plus failed orders from that day or earlier (to re-plan). */
  private plannable(tx: Tx, date: string, branchId: string) {
    return tx.deliveryOrder.findMany({
      where: {
        branchId,
        OR: [
          { status: 'RECEIVED', deliveryDate: new Date(date) },
          { status: 'FAILED', deliveryDate: { lte: new Date(date) } },
        ],
      },
      select: orderSelect,
      orderBy: [{ priority: 'asc' }, { externalRef: 'asc' }],
    });
  }

  private loadsOn(tx: Tx, date: string, branchId: string) {
    return tx.trip.findMany({
      where: { kind: 'DELIVERY', plannedDate: new Date(date), branchId, status: { not: 'CANCELLED' } },
      select: { id: true, tripNo: true, status: true, vehicleId: true, vehicle: { select: { plateNumber: true } }, driver: { select: { fullName: true } }, _count: { select: { stops: true } } },
      orderBy: { plannedStart: 'asc' },
    });
  }

  private async lockOrders(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)];
    await tx.$queryRaw`SELECT id FROM delivery_orders WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
    const rows = await tx.deliveryOrder.findMany({ where: { id: { in: unique } }, select: orderSelect });
    if (rows.length !== unique.length) throw new BadRequestException('Some orders were not found');
    return rows;
  }

  private async lockLoad(tx: Tx, tripId: string) {
    await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
    const t = await tx.trip.findFirst({ where: { id: tripId, kind: 'DELIVERY' } });
    if (!t) throw new NotFoundException('Load not found');
    return t;
  }

  private assertCapacity(v: VehicleCapacity, orders: OrderRow[], defaultMaxStops: number | null) {
    const c = checkLoad(v, loadTotals(orders.map(toLoadItem)), defaultMaxStops);
    if (!c.ok) throw new UnprocessableEntityException({ message: `Load exceeds ${v.plateNumber}'s capacity: ${describeViolations(c)}`, violations: c.violations, warnings: c.warnings });
  }

  /** One stop per customer (address/coordinates of the first order), sequenced from the depot. */
  private buildStops(orders: OrderRow[], depot: { latitude: number | null; longitude: number | null }) {
    const byCustomer = new Map<string, OrderRow[]>();
    for (const o of [...orders].sort((a, b) => a.externalRef.localeCompare(b.externalRef))) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
    const stops = [...byCustomer.entries()].map(([customerId, os]) => {
      const f = os[0];
      return {
        id: customerId,
        customerId,
        name: f.customer.name,
        address: f.address ?? f.customer.address,
        lat: f.latitude ?? f.customer.latitude,
        lng: f.longitude ?? f.customer.longitude,
        contactName: f.contactName,
        contactPhone: f.contactPhone ?? f.customer.phone,
        orderIds: os.map((o) => o.id),
      };
    });
    const seq = sequenceStops(depot.latitude != null && depot.longitude != null ? { lat: depot.latitude, lng: depot.longitude } : null, stops);
    return seq.map((s) => ({ ...s, latitude: s.lat, longitude: s.lng }));
  }

  private async writeStops(tx: Tx, companyId: string, tripId: string, stops: ReturnType<LogisticsService['buildStops']>) {
    for (const [i, s] of stops.entries()) {
      const row = await tx.tripStop.create({
        data: { companyId, tripId, seq: i + 1, customerId: s.customerId, name: s.name, address: s.address, latitude: s.lat, longitude: s.lng, contactName: s.contactName, contactPhone: s.contactPhone },
      });
      await tx.deliveryOrder.updateMany({ where: { id: { in: s.orderIds } }, data: { tripId, stopId: row.id, status: 'PLANNED', failureReason: null } });
      await tx.deliveryOrderLine.updateMany({ where: { orderId: { in: s.orderIds } }, data: { deliveredQty: null } });
    }
  }

  private async orderHook(tx: Tx, companyId: string, tripId: string, event: WebhookEvent, where: Prisma.DeliveryOrderWhereInput = {}) {
    const orders = await tx.deliveryOrder.findMany({ where: { tripId, ...where }, select: { id: true, externalRef: true, status: true, version: true, customer: { select: { code: true } } } });
    for (const o of orders) {
      await tx.deliveryOrder.update({ where: { id: o.id }, data: { version: { increment: 1 } } });
      await this.webhooks.emit(tx, companyId, event, { externalRef: o.externalRef, fmsId: o.id, status: o.status, version: o.version + 1, customerCode: o.customer.code, tripId });
    }
  }

  /** Company-local `date` + `HH:MM`. */
  private departure(date: string, hhmm: string, tz: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(dayBounds(date, tz).start.getTime() + (h * 60 + m) * 60_000);
  }

  private async stopFor(tx: Tx, stopId: string, driverId?: string) {
    const stop = await tx.tripStop.findFirst({ where: { id: stopId }, include: { trip: { select: { id: true, status: true, driverId: true } } } });
    if (!stop) throw new NotFoundException('Stop not found');
    if (driverId && stop.trip.driverId !== driverId) throw new NotFoundException('Stop not found');
    if (stop.trip.status !== 'ONGOING') throw new ForbiddenException('Start the trip before updating its stops');
    return { stop };
  }

  private orderView(o: OrderRow) {
    return {
      id: o.id,
      externalRef: o.externalRef,
      status: o.status,
      priority: o.priority,
      deliveryDate: o.deliveryDate?.toISOString().slice(0, 10) ?? null,
      window: o.windowStart && o.windowEnd ? { start: o.windowStart, end: o.windowEnd } : null,
      customer: o.customer,
      address: o.address ?? o.customer.address,
      contactName: o.contactName,
      contactPhone: o.contactPhone ?? o.customer.phone,
      weightKg: n(o.totalWeightKg),
      volumeM3: n(o.totalVolumeM3),
      cases: n(o.totalCases),
      pallets: n(o.totalPallets),
      codAmount: n(o.codAmount),
      notes: o.notes,
      failureReason: o.failureReason,
      tripId: o.tripId,
    };
  }
}
