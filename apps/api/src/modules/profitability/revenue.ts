import { Prisma } from '@prisma/client';
import type { Tx } from '../../common/db/prisma.service';
import { CardLike, pickCard, rate, splitTrip } from './rating';

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export function toCard(c: Prisma.RateCardGetPayload<object>): CardLike {
  return {
    id: c.id,
    customerId: c.customerId,
    vehicleClass: c.vehicleClass,
    branchId: c.branchId,
    validFrom: c.validFrom,
    validTo: c.validTo,
    active: c.active,
    priority: c.priority,
    perTrip: n(c.perTrip),
    perKm: n(c.perKm),
    perKg: n(c.perKg),
    perDrop: n(c.perDrop),
    perPallet: n(c.perPallet),
    minCharge: n(c.minCharge),
    fuelSurchargePct: n(c.fuelSurchargePct),
    waitingPerHour: n(c.waitingPerHour),
    freeWaitMinutes: c.freeWaitMinutes,
  };
}

/**
 * (Re)computes the rate-card revenue of a completed trip inside the caller's transaction.
 * Delivery trips: one row per customer over delivered / partial stops (failed drops are not charged),
 * weight as ordered, waiting = arrival → completion. Other trips: one row for the whole trip.
 */
export async function rateTrip(tx: Tx, companyId: string, tripId: string) {
  const trip = await tx.trip.findFirst({
    where: { id: tripId },
    select: {
      id: true, status: true, kind: true, branchId: true, cargoWeightKg: true, gpsDistanceKm: true, plannedKm: true, actualEnd: true, plannedEnd: true,
      vehicle: { select: { vehicleClass: true, branchId: true } },
      stops: { select: { customerId: true, status: true, arrivedAt: true, completedAt: true, orders: { select: { totalWeightKg: true, totalPallets: true } } } },
    },
  });
  if (!trip || trip.status !== 'COMPLETED') return [];
  await tx.tripRevenue.deleteMany({ where: { tripId } });
  const cards = (await tx.rateCard.findMany({ where: { active: true } })).map(toCard);
  const km = trip.gpsDistanceKm != null ? n(trip.gpsDistanceKm) : n(trip.plannedKm);
  const date = trip.actualEnd ?? trip.plannedEnd;
  const vehicleClass = trip.vehicle?.vehicleClass ?? null;
  const branchId = trip.branchId ?? trip.vehicle?.branchId ?? null;
  const charged = trip.stops.filter((s) => s.status === 'DELIVERED' || s.status === 'PARTIAL');
  const parts =
    trip.kind === 'DELIVERY' && charged.length
      ? splitTrip(
          charged.map((s) => ({
            customerId: s.customerId,
            kg: s.orders.reduce((a, o) => a + n(o.totalWeightKg), 0),
            pallets: s.orders.reduce((a, o) => a + n(o.totalPallets), 0),
            waitMinutes: s.arrivedAt && s.completedAt ? Math.max(0, Math.round((s.completedAt.getTime() - s.arrivedAt.getTime()) / 60_000)) : 0,
          })),
          km,
        )
      : [{ customerId: null as string | null, km, kg: n(trip.cargoWeightKg), drops: 0, pallets: 0, waitMinutes: 0, share: 1 }];
  const rows = parts.map((p) => {
    const card = pickCard(cards, { customerId: p.customerId, vehicleClass, branchId, date });
    const basis = { km: p.km, kg: Math.round(p.kg * 100) / 100, drops: p.drops, pallets: p.pallets, waitMinutes: p.waitMinutes, share: p.share };
    const r = card ? rate(card, basis) : null;
    return {
      companyId,
      tripId,
      customerId: p.customerId,
      rateCardId: card?.id ?? null,
      amount: r?.amount ?? 0,
      breakdown: (r?.breakdown ?? {}) as Prisma.InputJsonValue,
      basis: basis as Prisma.InputJsonValue,
      source: card ? 'RATE_CARD' : 'NO_CARD',
    };
  });
  await tx.tripRevenue.createMany({ data: rows });
  return rows;
}
