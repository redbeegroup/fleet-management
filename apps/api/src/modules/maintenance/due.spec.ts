import { minutesInStatus, planDue } from './due';

const s = { dueSoonKm: 500, dueSoonDays: 7 };
const now = new Date('2026-06-01T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('planDue', () => {
  it('distance-based', () => {
    const p = { intervalKm: 5000, intervalDays: null, lastDoneAt: null, lastDoneOdometerKm: 10_000 };
    expect(planDue(p, 12_000, now, s)).toMatchObject({ status: 'OK', nextDueKm: 15_000, remainingKm: 3000 });
    expect(planDue(p, 14_600, now, s).status).toBe('DUE_SOON');
    expect(planDue(p, 15_100, now, s)).toMatchObject({ status: 'OVERDUE', remainingKm: -100 });
  });
  it('time-based', () => {
    const p = { intervalKm: null, intervalDays: 90, lastDoneAt: daysAgo(85), lastDoneOdometerKm: null };
    expect(planDue(p, 0, now, s)).toMatchObject({ status: 'DUE_SOON', remainingDays: 5 });
    expect(planDue({ ...p, lastDoneAt: daysAgo(100) }, 0, now, s).status).toBe('OVERDUE');
  });
  it('whichever comes first wins', () => {
    const p = { intervalKm: 5000, intervalDays: 180, lastDoneAt: daysAgo(200), lastDoneOdometerKm: 10_000 };
    expect(planDue(p, 11_000, now, s).status).toBe('OVERDUE');
  });
});

describe('minutesInStatus', () => {
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
  const ev = (t: number, from: string | null, to: string) => ({ createdAt: h(t), fromStatus: from, toStatus: to });
  it('sums episodes clipped to the window', () => {
    const events = [ev(-10, null, 'AVAILABLE'), ev(-2, 'AVAILABLE', 'UNDER_REPAIR'), ev(3, 'UNDER_REPAIR', 'AVAILABLE'), ev(5, 'AVAILABLE', 'UNDER_REPAIR'), ev(6, 'UNDER_REPAIR', 'AVAILABLE')];
    expect(minutesInStatus(events, 'UNDER_REPAIR', h(0), h(24), h(48))).toBe(4 * 60);
  });
  it('counts an open episode until now', () => {
    const events = [ev(0, 'AVAILABLE', 'UNDER_REPAIR')];
    expect(minutesInStatus(events, 'UNDER_REPAIR', h(-5), h(24), h(2))).toBe(120);
  });
});
