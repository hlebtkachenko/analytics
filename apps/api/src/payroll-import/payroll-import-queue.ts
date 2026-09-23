import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { loadDatabaseConfiguration } from '@bap/db/config';
import type { PgBoss } from 'pg-boss';
import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import { PAYROLL_IMPORT_QUEUE, type PayrollImportJob } from './contract.js';
export abstract class PayrollImportQueue {
  abstract enqueue(job: PayrollImportJob): Promise<void>;
}
@Injectable()
export class PgBossPayrollImportQueue
  extends PayrollImportQueue
  implements OnModuleDestroy
{
  private client: Promise<PgBoss> | undefined;
  async enqueue(job: PayrollImportJob) {
    await (await this.get()).send(PAYROLL_IMPORT_QUEUE, job, { retryLimit: 1 });
  }
  async onModuleDestroy() {
    await (await this.client?.catch(() => undefined))?.stop({ graceful: true });
  }
  private get() {
    this.client ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(async (c) => {
      const q = createQueueClientFromConfiguration(c);
      q.on('error', () => undefined);
      await q.start();
      await createQueue(q, PAYROLL_IMPORT_QUEUE);
      return q;
    });
    return this.client;
  }
}
