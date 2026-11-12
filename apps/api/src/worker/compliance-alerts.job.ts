import { Injectable, Logger } from '@nestjs/common';
import { env } from '../common/config/env';
import { PrismaService } from '../common/db/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';

/** Daily scan: vehicle documents and driver licenses expiring soon (or expired). */
@Injectable()
export class ComplianceAlertsJob {
  private readonly logger = new Logger(ComplianceAlertsJob.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<{ documents: number; licenses: number }> {
    const until = new Date(now.getTime() + env().DOC_EXPIRY_ALERT_DAYS * 86_400_000);
    const [documents, licenses] = await this.db.system((tx) =>
      Promise.all([
        tx.vehicleDocument.findMany({
          where: { expiresAt: { lte: until }, vehicle: { deletedAt: null, status: { not: 'DISPOSED' } } },
          include: { vehicle: { select: { plateNumber: true } } },
        }),
        tx.driverLicense.findMany({
          where: { expiresAt: { lte: until }, driver: { active: true } },
          include: { driver: { select: { fullName: true, employeeNo: true } } },
        }),
      ]),
    );

    for (const d of documents) {
      const expired = d.expiresAt! < now;
      await this.notifications.notify({
        companyId: d.companyId,
        topic: 'vehicle.document.expiring',
        title: `${d.type} ${expired ? 'expired' : 'expiring'} — ${d.vehicle.plateNumber}`,
        body: `Document ${d.number ?? d.id} ${expired ? 'expired' : 'expires'} on ${d.expiresAt!.toISOString().slice(0, 10)}`,
        data: { documentId: d.id, vehicleId: d.vehicleId },
      });
    }
    for (const l of licenses) {
      const expired = l.expiresAt! < now;
      await this.notifications.notify({
        companyId: l.companyId,
        topic: 'driver.license.expiring',
        title: `Licence ${expired ? 'expired' : 'expiring'} — ${l.driver.fullName} (${l.driver.employeeNo})`,
        body: `Licence ${l.number} ${expired ? 'expired' : 'expires'} on ${l.expiresAt!.toISOString().slice(0, 10)}`,
        data: { licenseId: l.id, driverId: l.driverId },
      });
    }
    this.logger.log(`Compliance scan: ${documents.length} documents, ${licenses.length} licences`);
    return { documents: documents.length, licenses: licenses.length };
  }
}
