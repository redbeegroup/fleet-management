import { Logger } from '@nestjs/common';
import { notificationsSent } from '../../common/observability/metrics';
import type { PrismaService } from '../../common/db/prisma.service';
import type { Notification, NotificationChannel, Recipient } from './notifications.service';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Mobile push via the Expo push service (which relays to FCM / APNs).
 * Sends warning/critical alerts and anything addressed to specific users
 * (e.g. a driver's new trip). Tokens the service reports as unregistered are removed.
 */
export class ExpoPushChannel implements NotificationChannel {
  readonly name = 'push';
  private readonly logger = new Logger(ExpoPushChannel.name);

  constructor(
    private readonly db: PrismaService,
    private readonly url: string,
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  accepts(n: Notification): boolean {
    return n.severity === 'warning' || n.severity === 'critical' || Boolean(n.userIds?.length);
  }

  async send(to: Recipient, n: Notification): Promise<void> {
    const devices = await this.db.system((tx) => tx.userDevice.findMany({ where: { userId: to.id }, select: { id: true, pushToken: true } }));
    if (!devices.length) return;
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      },
      body: JSON.stringify(
        devices.map((d) => ({
          to: d.pushToken,
          title: n.title,
          body: n.body.slice(0, 200),
          sound: n.severity === 'info' ? undefined : 'default',
          priority: n.severity === 'critical' ? 'high' : 'default',
          data: { topic: n.topic, ...(n.data ?? {}) },
        })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      notificationsSent.inc({ channel: 'push', result: 'error' });
      throw new Error(`Expo push responded ${res.status}`);
    }
    const body = (await res.json()) as { data?: ExpoTicket[] };
    const dead: string[] = [];
    (body.data ?? []).forEach((t, i) => {
      notificationsSent.inc({ channel: 'push', result: t.status });
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(devices[i].id);
      else if (t.status === 'error') this.logger.warn(`Push error: ${t.message}`);
    });
    if (dead.length) await this.db.system((tx) => tx.userDevice.deleteMany({ where: { id: { in: dead } } }));
  }
}
