import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service';
import { env } from '../../common/config/env';
import { EmailChannel, LogChannel } from './channels';
import { ExpoPushChannel } from './push.channel';
import { NotificationsController } from './notifications.controller';
import { NOTIFICATION_CHANNELS, NotificationChannel, NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_CHANNELS,
      inject: [PrismaService],
      useFactory: (db: PrismaService): NotificationChannel[] => {
        const cfg = env();
        const channels: NotificationChannel[] = [new LogChannel()];
        if (cfg.SMTP_URL) channels.push(new EmailChannel(cfg.SMTP_URL, cfg.MAIL_FROM, cfg.APP_URL));
        if (cfg.PUSH_ENABLED) channels.push(new ExpoPushChannel(db, cfg.EXPO_PUSH_URL, cfg.EXPO_ACCESS_TOKEN));
        return channels;
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
