import { ReportsService } from '../modules/reports/reports.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { TiresService } from '../modules/tires/tires.service';
import { WarrantyService } from '../modules/warranty/warranty.service';
import { ComplianceService } from '../modules/compliance/compliance.service';
import { AuditsService } from '../modules/audits/audits.service';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { jobRuns } from '../common/observability/metrics';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import { MaintenanceService } from '../modules/maintenance/maintenance.service';
import { SafetyService } from '../modules/safety/safety.service';
import { TrainingService } from '../modules/training/training.service';
import { IncentivesService } from '../modules/incentives/incentives.service';
import { WebhooksService } from '../modules/integrations/webhooks.service';
import { TelematicsService } from '../modules/telematics/telematics.service';
import { ComplianceAlertsJob } from './compliance-alerts.job';
import { CostsService } from '../modules/costs/costs.service';
import { FuelCardsService } from '../modules/fuel/cards/fuel-cards.service';

export const MAINTENANCE_QUEUE = 'fms-maintenance';

/** BullMQ consumer for scheduled housekeeping and alert jobs. */
@Processor(MAINTENANCE_QUEUE)
export class WorkerProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerProcessor.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly compliance: ComplianceAlertsJob,
    private readonly telematics: TelematicsService,
    private readonly maintenance: MaintenanceService,
    private readonly analytics: AnalyticsService,
    private readonly safety: SafetyService,
    private readonly training: TrainingService,
    private readonly incentives: IncentivesService,
    private readonly webhooks: WebhooksService,
    private readonly costs: CostsService,
    private readonly fuelCards: FuelCardsService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly tires: TiresService,
    private readonly warranty: WarrantyService,
    private readonly compliancePack: ComplianceService,
    private readonly audits: AuditsService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Repeatable jobs are de-duplicated by BullMQ via the scheduler id.
    await this.queue.upsertJobScheduler('compliance-alerts', { pattern: '0 30 1 * * *', tz: 'Asia/Yangon' }, {
      name: 'compliance-alerts',
    });
    await this.queue.upsertJobScheduler('position-partitions', { pattern: '0 0 2 * * *' }, {
      name: 'position-partitions',
    });
    await this.queue.upsertJobScheduler('maintenance-due', { pattern: '0 0 2 * * *', tz: 'Asia/Yangon' }, { name: 'maintenance-due' });
    await this.queue.upsertJobScheduler('incentives-monthly', { pattern: '0 0 8 1 * *', tz: 'Asia/Yangon' }, { name: 'incentives-monthly' });
    await this.queue.upsertJobScheduler('safety-alerts', { pattern: '0 30 7 * * *', tz: 'Asia/Yangon' }, { name: 'safety-alerts' });
    await this.queue.upsertJobScheduler('budget-alerts', { pattern: '0 15 8 * * *', tz: 'Asia/Yangon' }, { name: 'budget-alerts' });
    await this.queue.upsertJobScheduler('stock-alerts', { pattern: '0 45 7 * * *', tz: 'Asia/Yangon' }, { name: 'stock-alerts' });
    await this.queue.upsertJobScheduler('tire-alerts', { pattern: '0 50 7 * * *', tz: 'Asia/Yangon' }, { name: 'tire-alerts' });
    await this.queue.upsertJobScheduler('warranty-alerts', { pattern: '0 55 7 * * *', tz: 'Asia/Yangon' }, { name: 'warranty-alerts' });
    await this.queue.upsertJobScheduler('compliance-pack', { pattern: '0 0 8 * * *', tz: 'Asia/Yangon' }, { name: 'compliance-pack' });
    await this.queue.upsertJobScheduler('audit-actions', { pattern: '0 5 8 * * *', tz: 'Asia/Yangon' }, { name: 'audit-actions' });
    // Hourly at :05; each company's reports go out from 07:00 local time.
    await this.queue.upsertJobScheduler('report-dispatch', { pattern: '0 5 * * * *' }, { name: 'report-dispatch' });
    await this.queue.upsertJobScheduler('fuel-card-sync', { pattern: '0 20 * * * *' }, { name: 'fuel-card-sync' });
    await this.queue.upsertJobScheduler('daily-stats', { every: 30 * 60_000 }, { name: 'daily-stats' });
    await this.queue.upsertJobScheduler('webhook-dispatch', { every: 15_000 }, { name: 'webhook-dispatch' });
    await this.queue.upsertJobScheduler('gps-offline', { every: 5 * 60_000 }, { name: 'gps-offline' });
    this.logger.log('Job schedulers registered');
  }

  async process(job: Job): Promise<unknown> {
    try {
      const result = await this.run(job);
      jobRuns.inc({ job: job.name, result: 'ok' });
      return result;
    } catch (err) {
      jobRuns.inc({ job: job.name, result: 'error' });
      throw err;
    }
  }

  private async run(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'safety-alerts':
        return this.safety.lowScoreAlerts();
      case 'stock-alerts':
        return this.inventory.lowStockAlerts();
      case 'tire-alerts':
        return this.tires.alerts();
      case 'warranty-alerts':
        return this.warranty.alerts();
      case 'compliance-pack':
        return this.compliancePack.alerts();
      case 'audit-actions':
        return this.audits.overdueAlerts();
      case 'report-dispatch':
        return this.reports.dispatch();
      case 'fuel-card-sync':
        return this.fuelCards.syncAll();
      case 'budget-alerts':
        return this.costs.budgetAlerts();
      case 'daily-stats':
        return this.analytics.rollup();
      case 'compliance-alerts': {
        const r = await this.compliance.run();
        return { ...r, training: await this.training.expiryAlerts() };
      }
      case 'webhook-dispatch': {
        let total = { sent: 0, failed: 0 };
        for (let i = 0; i < 20; i++) {
          const r = await this.webhooks.dispatchDue(50);
          total = { sent: total.sent + r.sent, failed: total.failed + r.failed };
          if (r.sent + r.failed < 50) break;
        }
        return total;
      }
      case 'incentives-monthly':
        return this.incentives.proposeMonthly();
      case 'position-partitions':
        return this.telematics.maintainPartitions();
      case 'maintenance-due':
        return this.maintenance.dueAlerts();
      case 'gps-offline':
        return this.telematics.checkOffline();
      default:
        this.logger.warn(`Unknown job ${job.name}`);
        return undefined;
    }
  }
}
