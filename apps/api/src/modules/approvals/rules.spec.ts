import { approvalNeed, decisionBlock } from './rules';

const s = { workOrderAbove: 500_000, expenseAbove: 100_000, fuelAbove: null, claimAbove: 1_000_000, secondApproverAbove: 2_000_000 };

describe('approval rules', () => {
  it('needs approval only above the configured limit', () => {
    expect(approvalNeed('WORK_ORDER', 500_000, s)).toEqual({ needed: false, required: 1 });
    expect(approvalNeed('WORK_ORDER', 500_001, s)).toEqual({ needed: true, required: 1 });
    expect(approvalNeed('FUEL', 9_999_999, s).needed).toBe(false); // no limit configured
    expect(approvalNeed('EXPENSE', null, s).needed).toBe(false);
  });
  it('always needs approval for booking requests', () => {
    expect(approvalNeed('VEHICLE_REQUEST', null, s)).toEqual({ needed: true, required: 1 });
  });
  it('requires two approvers at or above the second-approver amount', () => {
    expect(approvalNeed('CLAIM', 2_000_000, s)).toEqual({ needed: true, required: 2 });
    expect(approvalNeed('CLAIM', 1_999_999, s)).toEqual({ needed: true, required: 1 });
    expect(approvalNeed('CLAIM', 5_000_000, { ...s, secondApproverAbove: null }).required).toBe(1);
  });
  it('blocks self-approval, repeat approval and decided requests', () => {
    const req = { status: 'PENDING', requestedBy: 'u1' };
    expect(decisionBlock(req, [], 'u1')).toMatch(/own request/);
    expect(decisionBlock(req, [{ approverId: 'u2' }], 'u2')).toMatch(/different approver/);
    expect(decisionBlock({ ...req, status: 'APPROVED' }, [], 'u3')).toMatch(/already approved/);
    expect(decisionBlock(req, [{ approverId: 'u2' }], 'u3')).toBeNull();
  });
});
