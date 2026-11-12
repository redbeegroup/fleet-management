import { VEHICLE_STATUS_TRANSITIONS, VehicleStatus } from '@fms/shared';
import { canTransition } from './vehicles.service';

describe('vehicle status transitions', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('AVAILABLE', 'ASSIGNED')).toBe(true);
    expect(canTransition('UNDER_REPAIR', 'AVAILABLE')).toBe(true);
    expect(canTransition('INACTIVE', 'DISPOSED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('AVAILABLE', 'DISPOSED')).toBe(false);
    expect(canTransition('UNDER_REPAIR', 'OPERATING')).toBe(false);
  });

  it('treats DISPOSED as terminal', () => {
    for (const s of Object.values(VehicleStatus)) {
      if (s !== 'DISPOSED') expect(canTransition('DISPOSED', s)).toBe(false);
    }
    expect(VEHICLE_STATUS_TRANSITIONS.DISPOSED).toEqual([]);
  });

  it('is a no-op for same status', () => {
    expect(canTransition('OPERATING', 'OPERATING')).toBe(true);
  });
});
