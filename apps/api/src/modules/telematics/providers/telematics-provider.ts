/**
 * Adapter contract for any GPS / telematics source. Watch Tower is the first
 * implementation; other device platforms or raw protocol gateways plug in here.
 */
export interface PositionFix {
  /** Device identifier as known by the provider; mapped to vehicles.gps_device_id. */
  deviceId: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  heading?: number | null;
  altitudeM?: number | null;
  ignition?: boolean | null;
  odometerKm?: number | null;
  attributes?: Record<string, unknown>;
}

export interface TelematicsProvider {
  readonly name: string;
  /** Returns fixes recorded after `since` (or the latest known per device when omitted). */
  fetchPositions(since?: Date): Promise<PositionFix[]>;
}

export const TELEMATICS_PROVIDER = Symbol('TELEMATICS_PROVIDER');
