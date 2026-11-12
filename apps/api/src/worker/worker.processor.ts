import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { jobRuns } from '../common/observability/metrics';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import { MaintenanceService } from '../modules/maintenance/maintenance.service';
import { TelematicsService } from '../modules/telematics/telematics.service';
import { ComplianceAlertsJob } from './compliance-alerts.job';

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
    await this.queue.upsertJobScheduler('daily-stats', { every: 30 * 60_000 }, { name: 'daily-stats' });
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
      case 'daily-stats':
        return this.analytics.rollup();
      case 'compliance-alerts':
        return this.compliance.run();
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
