import { Global, Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

/** Global (in every process): owning modules register their outcome handlers and open requests. */
@Global()
@Module({ providers: [ApprovalsService], exports: [ApprovalsService] })
export class ApprovalsModule {}

/** HTTP inbox (API process only). */
@Module({ controllers: [ApprovalsController] })
export class ApprovalsApiModule {}
