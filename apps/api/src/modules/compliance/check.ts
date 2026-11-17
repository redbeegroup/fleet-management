import type { Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { dispatchBlocks, evaluate } from './rules';

/** Reasons the vehicles may not be dispatched under the company's rule pack (only when enforcement is on). */
export async function complianceBlocks(tx: Tx, vehicleIds: (string | null | undefined)[], today = new Date()): Promise<string[]> {
  const ids = vehicleIds.filter((x): x is string => !!x);
  if (!ids.length) return [];
  const company = await tx.company.findFirstOrThrow({ select: { settings: true } });
  const s = parseCompanySettings(company.settings).compliance;
  if (!s.enforceDispatch) return [];
  const [vehicles, docs] = await Promise.all([
    tx.vehicle.findMany({ where: { id: { in: ids } }, select: { id: true, plateNumber: true, vehicleClass: true, assetKind: true } }),
    tx.vehicleDocument.findMany({ where: { vehicleId: { in: ids } }, select: { id: true, vehicleId: true, type: true, number: true, issuedAt: true, expiresAt: true } }),
  ]);
  return vehicles.flatMap((v) => dispatchBlocks(v.plateNumber, evaluate(v, docs.filter((d) => d.vehicleId === v.id), s, today)));
}
