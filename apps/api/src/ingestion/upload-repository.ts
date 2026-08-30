import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { withTenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';

export interface RecordUploadInput {
  byteSize: number;
  filename: string;
  organizationId: string;
  uploadId: string;
  userId: string;
}

export interface FailUploadInput {
  organizationId: string;
  uploadId: string;
  userId: string;
}

export abstract class UploadRepository {
  abstract fail(input: FailUploadInput): Promise<void>;
  abstract record(input: RecordUploadInput): Promise<void>;
}

@Injectable()
export class DatabaseUploadRepository
  extends UploadRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async fail(input: FailUploadInput): Promise<void> {
    await this.inTenantContext(input, async (transaction) => {
      await transaction.query(
        "update app.upload set status = 'failed', error = $2, updated_at = now() where id = $1",
        [input.uploadId, 'The ingestion job could not be enqueued.'],
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async record(input: RecordUploadInput): Promise<void> {
    await this.inTenantContext(input, async (transaction) => {
      // Metadata only: the raw bytes stay on the staging volume and never enter the database.
      await transaction.query(
        `insert into app.upload (id, organization_id, filename, byte_size, status)
         values ($1, $2, $3, $4, 'pending')`,
        [input.uploadId, input.organizationId, input.filename, input.byteSize],
      );
      await transaction.query(
        "select app.record_audit('upload.received', 'upload', $1, '{}'::jsonb)",
        [input.uploadId],
      );
    });
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }

  private async inTenantContext<T>(
    tenant: { organizationId: string; userId: string },
    operation: Parameters<typeof withTenantContext<T>>[2],
  ): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();

    try {
      return await withTenantContext(client, tenant, operation);
    } finally {
      client.release();
    }
  }
}
