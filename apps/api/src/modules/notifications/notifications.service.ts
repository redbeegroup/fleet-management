import { Injectable, Logger } from '@nestjs/common';

export interface Notification {
  companyId: string;
  topic: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Delivery channel contract (email/SMTP, FCM push, Viber/Telegram/SMS…). */
export interface NotificationChannel {
  readonly name: string;
  send(n: Notification): Promise<void>;
}

class LogChannel implements NotificationChannel {
  readonly name = 'log';
  private readonly logger = new Logger('Notification');
  async send(n: Notification): Promise<void> {
    this.logger.log(`[${n.companyId}] ${n.topic}: ${n.title} — ${n.body}`);
  }
}

/**
 * Notification engine (Phase 1 skeleton). Channels are pluggable; recipient
 * resolution and per-user preferences arrive in Sprint 6.
 */
@Injectable()
export class NotificationsService {
  private readonly channels: NotificationChannel[] = [new LogChannel()];

  register(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  async notify(n: Notification): Promise<void> {
    await Promise.allSettled(this.channels.map((c) => c.send(n)));
  }
}
