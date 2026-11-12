import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
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
    this.logger.log('Job schedulers registered');
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'compliance-alerts':
        return this.compliance.run();
      case 'position-partitions':
        return this.telematics.maintainPartitions();
      default:
        this.logger.warn(`Unknown job ${job.name}`);
        return undefined;
    }
  }
}
