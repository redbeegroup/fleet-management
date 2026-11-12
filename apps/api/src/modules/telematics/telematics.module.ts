import { Module } from '@nestjs/common';
import { env } from '../../common/config/env';
import { PrismaService } from '../../common/db/prisma.service';
import { MockTelematicsProvider } from './providers/mock.provider';
import { TELEMATICS_PROVIDER } from './providers/telematics-provider';
import { WatchTowerProvider } from './providers/watchtower.provider';
import { TelematicsController } from './telematics.controller';
import { TelematicsService } from './telematics.service';

@Module({
  controllers: [TelematicsController],
  providers: [
    TelematicsService,
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
