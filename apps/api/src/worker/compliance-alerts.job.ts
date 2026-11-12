import { Injectable, Logger } from '@nestjs/common';
import { env } from '../common/config/env';
import { PrismaService } from '../common/db/prisma.service';
import { NotificationsService, Severity } from '../modules/notifications/notifications.service';

const DAY = 86_400_000;

/** Alert thresholds: each one fires once per document/licence expiry date. */
export function expiryBucket(expiresAt: Date, now: Date): { bucket: string; severity: Severity; days: number } {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
  if (days < 0) return { bucket: 'expired', severity: 'critical', days };
  if (days <= 1) return { bucket: '1d', severity: 'critical', days };
  if (days <= 7) return { bucket: '7d', severity: 'warning', days };
  if (days <= 14) return { bucket: '14d', severity: 'warning', days };
  return { bucket: '30d', severity: 'info', days };
}

/** Keeps only the latest-expiring item per group, so renewed documents stop alerting. */
export function latestPerGroup<T extends { expiresAt: Date | null }>(items: T[], key: (t: T) => string): T[] {
  const best = new Map<string, T>();
  for (const it of items) {
    const k = key(it);
    const cur = best.get(k);
    if (!cur || (it.expiresAt?.getTime() ?? 0) > (cur.expiresAt?.getTime() ?? 0)) best.set(k, it);
  }
  return [...best.values()];
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const when = (days: number) => (days < 0 ? `expired ${-days} day(s) ago` : days === 0 ? 'expires today' : `expires in ${days} day(s)`);

/** Daily scan: vehicle documents and driver licences expiring soon (or expired). */
@Injectable()
export class ComplianceAlertsJob {
  private readonly logger = new Logger(ComplianceAlertsJob.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<{ documents: number; licenses: number; notified: number }> {
    const until = new Date(now.getTime() + env().DOC_EXPIRY_ALERT_DAYS * DAY);
    const [allDocs, allLicenses] = await this.db.system((tx) =>
      Promise.all([
        tx.vehicleDocument.findMany({
          where: { expiresAt: { not: null }, vehicle: { deletedAt: null, status: { notIn: ['DISPOSED', 'INACTIVE'] } } },
          include: { vehicle: { select: { plateNumber: true } } },
        }),
        tx.driverLicense.findMany({
          where: { expiresAt: { not: null }, driver: { active: true } },
          include: { driver: { select: { fullName: true, employeeNo: true, userId: true } } },
        }),
      ]),
    );
    const documents = latestPerGroup(allDocs, (d) => `${d.vehicleId}:${d.type}`).filter((d) => d.expiresAt! <= until);
    const licenses = latestPerGroup(allLicenses, (l) => l.driverId).filter((l) => l.expiresAt! <= until);

    let notified = 0;
    for (const d of documents) {
      const b = expiryBucket(d.expiresAt!, now);
      notified += await this.notifications.notify({
        companyId: d.companyId,
        topic: 'vehicle.document.expiring',
        severity: b.severity,
        title: `${d.vehicle.plateNumber}: ${d.type.replace('_', ' ').toLowerCase()} ${when(b.days)}`,
        body: `Document ${d.number ?? ''} for ${d.vehicle.plateNumber} ${when(b.days)} (${fmt(d.expiresAt!)}).`,
        data: { documentId: d.id, vehicleId: d.vehicleId, link: `/vehicles/${d.vehicleId}` },
        dedupeKey: `doc:${d.id}:${fmt(d.expiresAt!)}:${b.bucket}`,
      });
    }
    for (const l of licenses) {
      const b = expiryBucket(l.expiresAt!, now);
      const n = {
        companyId: l.companyId,
        topic: 'driver.license.expiring',
        severity: b.severity,
        title: `Licence of ${l.driver.fullName} ${when(b.days)}`,
        body: `Driving licence ${l.number} (class ${l.licenseClass}) of ${l.driver.fullName} (${l.driver.employeeNo}) ${when(b.days)} (${fmt(l.expiresAt!)}).`,
        data: { licenseId: l.id, driverId: l.driverId, link: `/drivers/${l.driverId}` },
        dedupeKey: `lic:${l.id}:${fmt(l.expiresAt!)}:${b.bucket}`,
      };
      notified += await this.notifications.notify(n);
      // The driver is told too, when they have a login.
      if (l.driver.userId) notified += await this.notifications.notify({ ...n, userIds: [l.driver.userId] });
    }
    this.logger.log(`Compliance scan: ${documents.length} documents, ${licenses.length} licences, ${notified} new notifications`);
    return { documents: documents.length, licenses: licenses.length, notified };
  }
}
