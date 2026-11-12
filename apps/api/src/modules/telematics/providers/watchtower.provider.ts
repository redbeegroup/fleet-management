import { Logger } from '@nestjs/common';
import type { PositionFix, TelematicsProvider } from './telematics-provider';

interface WatchTowerPosition {
  deviceId?: string;
  imei?: string;
  timestamp?: string;
  fixTime?: string;
  lat?: number;
  latitude?: number;
  lng?: number;
  lon?: number;
  longitude?: number;
  speed?: number;
  course?: number;
  heading?: number;
  altitude?: number;
  ignition?: boolean;
  odometer?: number;
  [key: string]: unknown;
}

/**
 * Watch Tower API adapter.
 *
 * NOTE: the exact Watch Tower endpoint/field names must be confirmed against the
 * Watch Tower API documentation. This adapter tolerates common field aliases and
 * keeps all field mapping in `toFix()` so it is the only place to change.
 */
export class WatchTowerProvider implements TelematicsProvider {
  readonly name = 'watchtower';
  private readonly logger = new Logger(WatchTowerProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchPositions(since?: Date): Promise<PositionFix[]> {
    const url = new URL('/api/v1/positions/latest', this.baseUrl);
    if (since) url.searchParams.set('since', since.toISOString());
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Watch Tower responded ${res.status}`);
    const body = (await res.json()) as WatchTowerPosition[] | { data: WatchTowerPosition[] };
    const rows = Array.isArray(body) ? body : body.data;
    const fixes: PositionFix[] = [];
    for (const row of rows ?? []) {
      const fix = WatchTowerProvider.toFix(row);
      if (fix) fixes.push(fix);
      else this.logger.warn(`Skipping malformed Watch Tower position: ${JSON.stringify(row).slice(0, 200)}`);
    }
    return fixes;
  }

  static toFix(row: WatchTowerPosition): PositionFix | null {
    const deviceId = row.deviceId ?? row.imei;
    const ts = row.fixTime ?? row.timestamp;
    const latitude = row.latitude ?? row.lat;
    const longitude = row.longitude ?? row.lng ?? row.lon;
    if (!deviceId || !ts || typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    const recordedAt = new Date(ts);
    if (Number.isNaN(recordedAt.getTime())) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return {
      deviceId: String(deviceId),
      recordedAt,
      latitude,
      longitude,
      speedKmh: row.speed ?? null,
      heading: row.heading ?? row.course ?? null,
      altitudeM: row.altitude ?? null,
      ignition: row.ignition ?? null,
      odometerKm: row.odometer ?? null,
    };
  }
}
