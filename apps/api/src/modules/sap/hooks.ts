/** SAP hooks called inside other modules' transactions (no network calls here; the outbox sends). */
import { Prisma } from '@prisma/client';
import { env } from '../../common/config/env';
import type { Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { matchInvoice } from './posting';
import type { PoRequest } from './sap-client';

export async function sapSettings(tx: Tx) {
  const c = await tx.company.findFirstOrThrow({ select: { settings: true } });
  const s = parseCompanySettings(c.settings).sap;
  return { s, on: s.enabled && env().SAP_MODE !== 'none' };
}

/** Outside-garage job started with an accepted quote → purchase order request in the SAP outbox. */
export async function queueGaragePo(tx: Tx, companyId: string, woId: string) {
  const { s, on } = await sapSettings(tx);
  if (!on || !s.poForGarageJobs) return;
  const wo = await tx.workOrder.findFirst({
    where: { id: woId },
    select: { id: true, woNo: true, title: true, quoteAmount: true, poNumber: true, poStatus: true, supplier: { select: { externalRef: true } }, vehicle: { select: { plateNumber: true, department: { select: { sapCostCenter: true } } } } },
  });
  if (!wo?.supplier || wo.quoteAmount == null || wo.poNumber || wo.poStatus === 'REQUESTED') return;
  if (!wo.supplier.externalRef) {
    await tx.workOrder.update({ where: { id: woId }, data: { poStatus: 'NO_SAP_VENDOR' } });
    return;
  }
  const payload: PoRequest = {
    companyCode: s.companyCode,
    purchasingOrg: s.purchasingOrg,
    purchasingGroup: s.purchasingGroup,
    plant: s.plant,
    supplier: wo.supplier.externalRef,
    currency: s.currency,
    text: `${wo.woNo} ${wo.vehicle.plateNumber} ${wo.title}`,
    netAmount: Number(wo.quoteAmount),
    glAccount: s.serviceGlAccount || s.glAccounts.MAINTENANCE || s.glAccounts.default || '',
    costCenter: wo.vehicle.department?.sapCostCenter || s.defaultCostCenter,
    materialGroup: s.materialGroup,
  };
  await tx.sapDocument.create({ data: { companyId, kind: 'PO', ref: `wo:${woId}`, payload: payload as unknown as Prisma.InputJsonValue } });
  await tx.workOrder.update({ where: { id: woId }, data: { poStatus: 'REQUESTED' } });
}

/** Garage invoice against the PO (the PO value is the accepted quote). */
export async function checkGarageInvoice(tx: Tx, woId: string) {
  const wo = await tx.workOrder.findFirst({ where: { id: woId }, select: { poNumber: true, quoteAmount: true, invoiceAmount: true } });
  if (!wo?.poNumber || wo.quoteAmount == null || wo.invoiceAmount == null) return null;
  const { s } = await sapSettings(tx);
  const m = matchInvoice(Number(wo.quoteAmount), Number(wo.invoiceAmount), s.poTolerancePct);
  await tx.workOrder.update({ where: { id: woId }, data: { poStatus: m.ok ? 'MATCHED' : 'INVOICE_MISMATCH' } });
  return m;
}
