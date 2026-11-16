import type { PositionFix, TelematicsProvider } from './telematics-provider';

/**
 * Simulated provider for local/Docker testing without Watch Tower access.
 * Moves each configured device around a point in Yangon.
 */
export class MockTelematicsProvider implements TelematicsProvider {
  readonly name = 'mock';
  private tick = 0;
  private levels = new Map<number, number>();

  private fuel(i: number, moving: boolean): number {
    let l = this.levels.get(i) ?? 60 + ((i * 17) % 40);
    if (this.tick % 240 === 0) l = 110;
    else if (moving) l = Math.max(5, l - 0.08);
    this.levels.set(i, l);
    return Math.round(l * 10) / 10;
  }

  constructor(private readonly deviceIds: () => Promise<string[]>) {}

  async fetchPositions(): Promise<PositionFix[]> {
    const ids = await this.deviceIds();
    this.tick += 1;
    const now = new Date();
    return ids.map((deviceId, i) => {
      const angle = (this.tick / 20 + i) % (2 * Math.PI);
      const phase = (this.tick + i * 7) % 60;
      // Mostly driving; a parked stop (engine off), an idling stop (engine on) and a speeding burst each cycle.
      const parked = phase >= 40 && phase < 46;
      const idling = phase >= 50 && phase < 56;
      const speeding = phase >= 20 && phase < 23;
      const moving = !parked && !idling;
      return {
        deviceId,
        recordedAt: now,
        latitude: 16.8409 + 0.03 * Math.sin(angle) + i * 0.005,
        longitude: 96.1735 + 0.03 * Math.cos(angle) + i * 0.005,
        speedKmh: speeding ? 95 : moving ? 25 + ((this.tick * 7 + i * 13) % 45) : 0,
        heading: ((angle * 180) / Math.PI + 90) % 360,
        ignition: !parked,
        attributes: {
          // Occasional simulated accelerometer events (as a device would report them).
          ...((this.tick + i * 11) % 47 === 0 && { event: ['harsh_braking', 'harsh_acceleration', 'harsh_cornering'][(this.tick + i) % 3] }),
          // Fuel level: falls while driving, refilled to 110 L at the start of each 240-tick day cycle.
          fuelLevelL: this.fuel(i, moving),
          coolantTempC: moving ? 88 : 80,
          batteryV: parked ? 12.4 : 13.9,
          // A trouble code appears for a while on one device in five.
          ...(i % 5 === 2 && (this.tick % 240) > 120 && { dtc: ['P0301'], mil: true }),
        },
      };
    });
  }
}
