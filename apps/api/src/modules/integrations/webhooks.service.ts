import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role, UpdateWebhookEndpointInput, WebhookEndpointInput, WebhookEvent } from '@fms/shared';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertSafeTarget, DISABLE_AFTER, MAX_ATTEMPTS, newWebhookSecret, nextAttempt, signPayload } from './webhook-delivery';

const LEASE_MS = 120_000;
const endpointSelect = {
  id: true,
  url: true,
  description: true,
  events: true,
  active: true,
  consecutiveFailures: true,
  disabledReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebhookEndpointSelect;

/** JSON-safe copy (Decimal → string, Date → ISO). */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Outbox: queue `event` for every subscribed endpoint inside the caller's transaction,
   * so a rolled-back change never produces a webhook and a committed one always does.
   */
  async emit(tx: Tx, companyId: string, event: WebhookEvent, data: unknown): Promise<number> {
    const endpoints = await tx.webhookEndpoint.findMany({ where: { companyId, active: true, events: { has: event } }, select: { id: true } });
    if (!endpoints.length) return 0;
    const envelope = { id: randomUUID(), event, createdAt: new Date().toISOString(), data: plain(data) };
    await tx.webhookDelivery.createMany({ data: endpoints.map((e) => ({ companyId, endpointId: e.id, event, payload: envelope })) });
    return endpoints.length;
  }

  // ---------------------------------------------------------------- admin

  list(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.webhookEndpoint.findMany({ select: endpointSelect, orderBy: { createdAt: 'asc' } }));
  }

  async create(user: AuthUser, input: WebhookEndpointInput) {
    await this.checkUrl(input.url);
    return this.db.tenant(user.companyId, async (tx) => {
      // The secret is returned here and on explicit rotation only.
      return tx.webhookEndpoint.create({
        data: { ...input, secret: newWebhookSecret(), companyId: user.companyId, createdBy: user.userId },
        select: { ...endpointSelect, secret: true },
      });
    });
  }

  async update(user: AuthUser, id: string, input: UpdateWebhookEndpointInput) {
    if (input.url) await this.checkUrl(input.url);
    return this.db.tenant(user.companyId, async (tx) => {
      await this.find(tx, id);
      return tx.webhookEndpoint.update({
        where: { id },
        data: { ...input, ...(input.active && { consecutiveFailures: 0, disabledReason: null }) },
        select: endpointSelect,
      });
    });
  }

  rotateSecret(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.find(tx, id);
      return tx.webhookEndpoint.update({ where: { id }, data: { secret: newWebhookSecret() }, select: { id: true, secret: true } });
    });
  }

  remove(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.find(tx, id);
      await tx.webhookEndpoint.delete({ where: { id } });
    });
  }

  /** Queue a `ping` to one endpoint (delivered by the normal dispatcher). */
  ping(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.find(tx, id);
      const envelope = { id: randomUUID(), event: 'ping', createdAt: new Date().toISOString(), data: { message: 'Test delivery from FMS' } };
      return tx.webhookDelivery.create({ data: { companyId: user.companyId, endpointId: id, event: 'ping', payload: envelope } });
    });
  }

  deliveries(user: AuthUser, q: { endpointId?: string; status?: string; take: number }) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.webhookDelivery.findMany({
        where: { ...(q.endpointId && { endpointId: q.endpointId }), ...(q.status && { status: q.status as never }) },
        orderBy: { createdAt: 'desc' },
        take: q.take,
      }),
    );
  }

  /** Send a delivery again now (any status); keeps the same payload and event id. */
  redeliver(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const d = await tx.webhookDelivery.findFirst({ where: { id } });
      if (!d) throw new NotFoundException('Delivery not found');
      return tx.webhookDelivery.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    });
  }

  // ----------------------------------------------------------- dispatcher

  /** Worker: claim due deliveries (lease), send them, record the outcome. Returns the number sent. */
  async dispatchDue(limit = 50, now = new Date()): Promise<{ sent: number; failed: number }> {
    const claimed = await this.db.system(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.status = 'PENDING' AND d.next_attempt_at <= ${now} AND e.active
        ORDER BY d.next_attempt_at LIMIT ${limit} FOR UPDATE OF d SKIP LOCKED`;
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      await tx.webhookDelivery.updateMany({ where: { id: { in: ids } }, data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) } });
      return tx.webhookDelivery.findMany({ where: { id: { in: ids } }, include: { endpoint: true } });
    });
    let sent = 0;
    let failed = 0;
    for (const d of claimed) {
      const ok = await this.deliver(d, d.endpoint);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  }

  private async deliver(
    d: { id: string; companyId: string; event: string; payload: Prisma.JsonValue; attempts: number },
    ep: { id: string; url: string; secret: string; consecutiveFailures: number },
  ): Promise<boolean> {
    const body = JSON.stringify(d.payload);
    const started = new Date();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const url = await assertSafeTarget(ep.url, { allowInsecure: env().WEBHOOK_ALLOW_INSECURE, allowPrivate: env().WEBHOOK_ALLOW_PRIVATE });
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'FMS-Webhooks/1',
          'x-fms-event': d.event,
          'x-fms-delivery': d.id,
          'x-fms-signature': signPayload(ep.secret, body),
        },
        body,
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 500);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await this.db.system(async (tx) => {
        await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: 'SENT', attempts, lastAttemptAt: started, deliveredAt: new Date(), responseStatus: status, lastError: null } });
        await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { consecutiveFailures: 0 } });
      });
      return true;
    }
    const next = nextAttempt(attempts, started);
    const failures = ep.consecutiveFailures + 1;
    const disable = failures >= DISABLE_AFTER;
    await this.db.system(async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: d.id },
        data: { status: next ? 'PENDING' : 'FAILED', attempts, lastAttemptAt: started, responseStatus: status, lastError: error, ...(next && { nextAttemptAt: next }) },
      });
      await tx.webhookEndpoint.update({
        where: { id: ep.id },
        data: { consecutiveFailures: failures, ...(disable && { active: false, disabledReason: `Disabled after ${failures} consecutive failed deliveries (last: ${error})` }) },
      });
    });
    ep.consecutiveFailures = failures;
    if (disable && failures === DISABLE_AFTER) {
      await this.notifications
        .notify({
          companyId: d.companyId,
          roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
          topic: 'integration.webhook_disabled',
          severity: 'critical',
          title: `Webhook disabled: ${ep.url}`,
          body: `${failures} consecutive deliveries failed (last error: ${error}). Fix the receiver, then re-enable the endpoint in Settings → Integrations.`,
          data: { endpointId: ep.id, link: '/integrations' },
          dedupeKey: `webhook-disabled:${ep.id}:${started.toISOString().slice(0, 10)}`,
        })
        .catch((e: Error) => this.logger.warn(e.message));
    }
    this.logger.warn(`Webhook ${d.event} → ${ep.url} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${error}`);
    return false;
  }

  private async checkUrl(url: string) {
    try {
      await assertSafeTarget(url, { allowInsecure: env().WEBHOOK_ALLOW_INSECURE, allowPrivate: env().WEBHOOK_ALLOW_PRIVATE });
    } catch (e) {
      throw new BadRequestException({ message: 'Invalid webhook URL', errors: [{ path: 'url', message: (e as Error).message }] });
    }
  }

  private async find(tx: Tx, id: string) {
    const ep = await tx.webhookEndpoint.findFirst({ where: { id } });
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return ep;
  }
}
