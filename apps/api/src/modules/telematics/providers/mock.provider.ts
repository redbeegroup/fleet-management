import type { PositionFix, TelematicsProvider } from './telematics-provider';

/**
 * Simulated provider for local/Docker testing without Watch Tower access.
 * Moves each configured device around a point in Yangon.
 */
export class MockTelematicsProvider implements TelematicsProvider {
  readonly name = 'mock';
  private tick = 0;

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
      };
    });
  }
}
