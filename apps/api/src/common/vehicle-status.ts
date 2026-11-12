import { BadRequestException } from '@nestjs/common';
import { VEHICLE_STATUS_TRANSITIONS, VehicleStatus } from '@fms/shared';
import type { Tx } from './db/prisma.service';

/** Changes a vehicle's status inside a tenant transaction, validating and recording it. */
export async function changeVehicleStatus(
  tx: Tx,
  ctx: { companyId: string; userId?: string | null },
  vehicleId: string,
  to: VehicleStatus,
  reason: string,
): Promise<void> {
  const v = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { status: true } });
  if (v.status === to) return;
  if (!VEHICLE_STATUS_TRANSITIONS[v.status].includes(to)) {
    throw new BadRequestException(`Vehicle cannot go from ${v.status} to ${to}`);
  }
  await tx.vehicleStatusEvent.create({
    data: { companyId: ctx.companyId, vehicleId, fromStatus: v.status, toStatus: to, reason, userId: ctx.userId ?? null },
  });
  await tx.vehicle.update({ where: { id: vehicleId }, data: { status: to } });
}

/** Status a vehicle returns to after repair/trip: ASSIGNED if a driver holds it, else AVAILABLE. */
export async function restingStatus(tx: Tx, vehicleId: string): Promise<'ASSIGNED' | 'AVAILABLE'> {
  const held = await tx.vehicleAssignment.count({ where: { vehicleId, endAt: null, driverId: { not: null } } });
  return held ? 'ASSIGNED' : 'AVAILABLE';
}

/** Atomic per-company sequence, e.g. nextNumber(tx, id, 'wo', 2026) → 17. */
export async function nextNumber(tx: Tx, companyId: string, key: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO company_counters (company_id, key, value) VALUES (${companyId}::uuid, ${key}, 1)
    ON CONFLICT (company_id, key) DO UPDATE SET value = company_counters.value + 1
    RETURNING value`;
  return row.value;
}
