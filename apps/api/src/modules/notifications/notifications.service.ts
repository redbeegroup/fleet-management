import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Role } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { notificationsSent } from '../../common/observability/metrics';
import { PrismaService } from '../../common/db/prisma.service';

export type Severity = 'info' | 'warning' | 'critical';

export interface Notification {
  companyId: string;
  topic: string;
  title: string;
  body: string;
  severity?: Severity;
  data?: Record<string, unknown>;
  /** Same key + same user = delivered once. e.g. `doc-expiring:<id>:7d` */
  dedupeKey?: string;
  /** Recipients: explicit user ids, otherwise users holding any of these roles. */
  userIds?: string[];
  roles?: string[];
}

export interface Recipient {
  id: string;
  email: string;
  fullName: string;
}

/** External delivery channel (email/SMTP, FCM push, Viber/Telegram/SMS…). */
export interface NotificationChannel {
  readonly name: string;
  /** Return false to skip this notification (e.g. severity filter). */
  accepts(n: Notification): boolean;
  send(to: Recipient, n: Notification): Promise<void>;
}

export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

const DEFAULT_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER];

/**
 * Notification engine: resolves recipients, stores one in-app notification per
 * user (deduplicated), then fans out new ones to external channels.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: PrismaService,
    @Optional() @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[] = [],
  ) {}

  /** Returns the number of notifications newly created (after dedupe). */
  async notify(n: Notification): Promise<number> {
    const recipients = await this.db.system((tx) =>
      tx.user.findMany({
        where: {
          companyId: n.companyId,
          active: true,
          ...(n.userIds?.length ? { id: { in: n.userIds } } : { roles: { hasSome: n.roles ?? DEFAULT_ROLES } }),
        },
        select: { id: true, email: true, fullName: true },
      }),
    );
    if (!recipients.length) return 0;

    const created = await this.db.system((tx) =>
      tx.notification.createManyAndReturn({
        data: recipients.map((r) => ({
          companyId: n.companyId,
          userId: r.id,
          topic: n.topic,
          severity: n.severity ?? 'info',
          title: n.title,
          body: n.body,
          data: (n.data ?? undefined) as object | undefined,
          dedupeKey: n.dedupeKey ?? null,
        })),
        skipDuplicates: true,
        select: { id: true, userId: true },
      }),
    );

    notificationsSent.inc({ channel: 'in-app', result: 'ok' }, created.length);
    const byUser = new Map(recipients.map((r) => [r.id, r]));
    for (const channel of this.channels.filter((c) => c.accepts(n))) {
      const delivered: string[] = [];
      for (const row of created) {
        try {
          await channel.send(byUser.get(row.userId)!, n);
          delivered.push(row.id);
        } catch (err) {
          this.logger.warn(`${channel.name} delivery failed for ${row.userId}: ${(err as Error).message}`);
        }
      }
      if (channel.name === 'email' && delivered.length) {
        await this.db.system((tx) =>
          tx.notification.updateMany({ where: { id: { in: delivered } }, data: { emailedAt: new Date() } }),
        );
      }
    }
    return created.length;
  }

  list(user: AuthUser, unreadOnly: boolean, take = 50) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.notification.findMany({
        where: { userId: user.userId, ...(unreadOnly && { readAt: null }) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    );
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    const count = await this.db.tenant(user.companyId, (tx) =>
      tx.notification.count({ where: { userId: user.userId, readAt: null } }),
    );
    return { count };
  }

  async markRead(user: AuthUser, id?: string): Promise<{ updated: number }> {
    const { count } = await this.db.tenant(user.companyId, (tx) =>
      tx.notification.updateMany({
        where: { userId: user.userId, readAt: null, ...(id && { id }) },
        data: { readAt: new Date() },
      }),
    );
    return { updated: count };
  }
}
