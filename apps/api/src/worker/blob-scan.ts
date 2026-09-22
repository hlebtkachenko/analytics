import type { TenantContext } from '@bap/db';
import type { PoolClient } from 'pg';

import { appendEvent } from '../inbox/inbox-repository-support.js';

// The scan verdict is written by the definer and evented; an error never reaches the database so a retry sees not_scanned.
export async function recordScan(
  transaction: PoolClient,
  tenant: TenantContext,
  itemId: string,
  blobId: string,
  status: 'clean' | 'infected' | 'failed',
): Promise<void> {
  await transaction.query('select app.record_blob_scan($1, $2)', [
    blobId,
    status,
  ]);
  await appendEvent(transaction, tenant, itemId, 'scanned');
}

// A terminal update guarded on the status the job read: a reaped or reassessed item is never resurrected.
export async function setItemStatus(
  transaction: PoolClient,
  itemId: string,
  status: string,
  expected: string | null,
): Promise<boolean> {
  const updated = await transaction.query(
    `update app.inbox_item set status = $2, updated_at = now()
      where id = $1 and ($3::text is null or status = $3::text)`,
    [itemId, status, expected],
  );

  return updated.rowCount === 1;
}
