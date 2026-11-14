import type { ApprovalSettings } from '@fms/shared';

export type ApprovalKind = 'WORK_ORDER' | 'EXPENSE' | 'FUEL' | 'VEHICLE_REQUEST' | 'CLAIM';

const LIMIT: Record<Exclude<ApprovalKind, 'VEHICLE_REQUEST'>, keyof ApprovalSettings> = {
  WORK_ORDER: 'workOrderAbove',
  EXPENSE: 'expenseAbove',
  FUEL: 'fuelAbove',
  CLAIM: 'claimAbove',
};

/**
 * Whether an action needs approval and how many distinct approvers.
 * Booking requests always need one; amounts need approval only above the configured limit.
 */
export function approvalNeed(kind: ApprovalKind, amount: number | null, s: ApprovalSettings): { needed: boolean; required: 1 | 2 } {
  let needed: boolean;
  if (kind === 'VEHICLE_REQUEST') needed = true;
  else {
    const limit = s[LIMIT[kind]];
    needed = limit != null && amount != null && amount > limit;
  }
  const required = needed && amount != null && s.secondApproverAbove != null && amount >= s.secondApproverAbove ? 2 : 1;
  return { needed, required };
}

/** Why `userId` may not decide this request now, or null. */
export function decisionBlock(req: { status: string; requestedBy: string | null }, decisions: { approverId: string }[], userId: string): string | null {
  if (req.status !== 'PENDING') return `This request is already ${req.status.toLowerCase()}`;
  if (req.requestedBy === userId) return 'You cannot decide on your own request';
  if (decisions.some((d) => d.approverId === userId)) return 'You have already approved this request; a different approver is needed';
  return null;
}
