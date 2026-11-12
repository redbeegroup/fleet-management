import { Logger, Module } from '@nestjs/common';
import { env } from '../../common/config/env';
import { PrismaService } from '../../common/db/prisma.service';
import { MockTelematicsProvider } from './providers/mock.provider';
import { TELEMATICS_PROVIDER } from './providers/telematics-provider';
import { WatchTowerProvider } from './providers/watchtower.provider';
import { GeofencesController } from './geofences.controller';
import { LiveGateway } from './live.gateway';
import { TelemetryRulesService } from './telemetry-rules.service';
import { TelematicsController } from './telematics.controller';
import { TelematicsService } from './telematics.service';

/** Telematics core (ingest, rules, queries). Shared by api, worker, ingest and job processes. */
@Module({
  controllers: [TelematicsController, GeofencesController],
  providers: [
    TelematicsService,
    TelemetryRulesService,
    {
      provide: TELEMATICS_PROVIDER,
      inject: [PrismaService],
      useFactory: (db: PrismaService) => {
        const cfg = env();
        if (cfg.TELEMATICS_PROVIDER === 'watchtower') {
          if (!cfg.WATCHTOWER_BASE_URL || !cfg.WATCHTOWER_API_KEY) {
            throw new Error('WATCHTOWER_BASE_URL and WATCHTOWER_API_KEY are required for the watchtower provider');
          }
          return new WatchTowerProvider(cfg.WATCHTOWER_BASE_URL, cfg.WATCHTOWER_API_KEY);
        }
        if (cfg.NODE_ENV === 'production') {
          new Logger('Telematics').warn(
            'TELEMATICS_PROVIDER=mock: positions are SIMULATED for every vehicle with a GPS device id. Never use this with real data.',
          );
        }
        return new MockTelematicsProvider(async () => {
          const rows = await db.system((tx) =>
            tx.vehicle.findMany({ where: { gpsDeviceId: { not: null }, deletedAt: null }, select: { gpsDeviceId: true } }),
          );
          return rows.map((r) => r.gpsDeviceId!);
        });
      },
    },
  ],
  exports: [TelematicsService, TELEMATICS_PROVIDER],
})
export class TelematicsModule {}

/** HTTP-only additions: the WebSocket gateway lives in the API process only. */
@Module({ imports: [TelematicsModule], providers: [LiveGateway] })
export class TelematicsLiveModule {}
