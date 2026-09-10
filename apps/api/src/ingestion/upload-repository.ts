import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { withTenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';

import type { TenantSelector } from '../tenant-access.js';

export interface RecordUploadInput extends TenantSelector {
  byteSize: number;
  filename: string;
  legalEntityId: string;
  uploadId: string;
}

export interface FailUploadInput extends TenantSelector {
  uploadId: string;
}

export abstract class UploadRepository {
  abstract fail(input: FailUploadInput): Promise<void>;
  // false means the legal entity is unknown inside this organization, which the route answers with 400.
  abstract record(input: RecordUploadInput): Promise<boolean>;
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

  async record(input: RecordUploadInput): Promise<boolean> {
    return this.inTenantContext(input, async (transaction) => {
      // Metadata only: the raw bytes stay on the staging volume and never enter the database.
      // The entity is resolved through row level security, so an id from another organization inserts nothing.
      const recorded = await transaction.query(
        `insert into app.upload (id, organization_id, legal_entity_id, filename, byte_size, status)
         select $1, $2, entity.id, $4, $5, 'pending'
         from app.legal_entity as entity
         where entity.id = $3`,
        [
          input.uploadId,
          input.organizationId,
          input.legalEntityId,
          input.filename,
          input.byteSize,
        ],
      );

      if (recorded.rowCount === 0) {
        return false;
      }

      await transaction.query(
        "select app.record_audit('upload.received', 'upload', $1, '{}'::jsonb)",
        [input.uploadId],
      );
      return true;
    });
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }

  private async inTenantContext<T>(
    tenant: TenantSelector,
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
