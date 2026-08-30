import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  listDatasets,
  readDatasetRowPage,
  streamDatasetRows,
} from './dataset-repository.js';
import type { DatasetRowRecord } from './dataset-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const ROW_COUNT = 5;

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;

// Neutral placeholder tenants: a creator, a grantee in the same tenant, and a stranger in another one.
const creator = { organizationId: 'org-1', userId: 'user-1' };
const grantee = { organizationId: 'org-1', userId: 'user-2' };
const stranger = { organizationId: 'org-2', userId: 'user-3' };
let ownedDatasetId = '';
let foreignDatasetId = '';

function configurationFor(role: DatabaseRole): DatabaseConfiguration {
  return {
    database: container.getDatabase(),
    host: container.getHost(),
    password: testPassword,
    port: container.getPort(),
    role,
    ssl: false,
    user: role,
  };
}

async function asTenant<T>(
  tenant: { organizationId: string; userId: string },
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

async function createDataset(tenant: {
  organizationId: string;
  userId: string;
}): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.dataset (organization_id, name, description, status, created_by)
       values ($1, 'placeholder container', 'placeholder description', 'ready', $2)
       returning id`,
      [tenant.organizationId, tenant.userId],
    );
    const datasetId = created.rows[0]?.id ?? '';
    await transaction.query(
      `insert into app.dataset_column (dataset_id, name, position, inferred_type)
       values ($1, 'label', 0, 'text'), ($1, 'count', 1, 'number')`,
      [datasetId],
    );
    await transaction.query(
      `insert into app.dataset_row (dataset_id, organization_id, row_number, data)
       select $1, $2, position_number, jsonb_build_object('label', 'row-' || position_number, 'count', position_number)
       from generate_series(0, $3::int - 1) as position_number`,
      [datasetId, tenant.organizationId, ROW_COUNT],
    );
    return datasetId;
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  const rootPool = createDatabasePool(configurationFor('postgres'));
  const root = await rootPool.connect();

  try {
    await bootstrapDatabaseRoles(root, {
      bap_api: testPassword,
      bap_auth: testPassword,
      bap_backup: testPassword,
      bap_migrator: testPassword,
      bap_reporting: testPassword,
    });
  } finally {
    root.release();
  }

  migratorPool = createDatabasePool(configurationFor('bap_migrator'));
  await runMigrations(migratorPool);
  const migrator = await migratorPool.connect();

  try {
    await migrator.query('begin');
    await migrator.query('set local role bap_owner');
    await migrator.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Creator', 'creator@example.test', true),
             ('user-2', 'Grantee', 'grantee@example.test', true),
             ('user-3', 'Stranger', 'stranger@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-1', 'user-2', 'member'),
             ('member-3', 'org-2', 'user-3', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  ownedDatasetId = await createDataset(creator);
  foreignDatasetId = await createDataset(stranger);
  await asTenant(creator, async (transaction) => {
    await transaction.query(
      `insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope)
       values ($1, $2, 'dataset', $3, 'read')`,
      [creator.organizationId, grantee.userId, ownedDatasetId],
    );
  });
});

afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('dataset read and export queries against PostgreSQL', () => {
  it('never returns another tenant dataset or its rows', async () => {
    const strangerList = await listDatasets(apiPool, stranger);
    const strangerPage = await readDatasetRowPage(apiPool, {
      ...stranger,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });
    // The same subject with a forged tenant selector still resolves to nothing.
    const forgedTenant = await readDatasetRowPage(apiPool, {
      after: null,
      datasetId: ownedDatasetId,
      organizationId: creator.organizationId,
      pageSize: 10,
      userId: stranger.userId,
    });

    expect(strangerList.map((dataset) => dataset.id)).toEqual([
      foreignDatasetId,
    ]);
    expect(strangerPage).toBeNull();
    expect(forgedTenant).toBeNull();
  });

  it('lists a dataset with its row count for the creator', async () => {
    const owned = await listDatasets(apiPool, creator);

    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      description: 'placeholder description',
      id: ownedDatasetId,
      name: 'placeholder container',
      rowCount: ROW_COUNT,
      status: 'ready',
    });
  });

  it('lets a grant read the dataset but never write it', async () => {
    const visible = await listDatasets(apiPool, grantee);
    const page = await readDatasetRowPage(apiPool, {
      ...grantee,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });

    expect(visible.map((dataset) => dataset.id)).toEqual([ownedDatasetId]);
    expect(page?.columns.map((column) => column.name)).toEqual([
      'label',
      'count',
    ]);
    expect(page?.rows).toHaveLength(ROW_COUNT);

    const writes = await asTenant(grantee, async (transaction) => {
      const updatedRow = await transaction.query(
        "update app.dataset_row set data = '{}'::jsonb where dataset_id = $1",
        [ownedDatasetId],
      );
      const deletedRow = await transaction.query(
        'delete from app.dataset_row where dataset_id = $1',
        [ownedDatasetId],
      );
      const renamed = await transaction.query(
        "update app.dataset set name = 'renamed' where id = $1",
        [ownedDatasetId],
      );
      return {
        deletedRow: deletedRow.rowCount,
        renamed: renamed.rowCount,
        updatedRow: updatedRow.rowCount,
      };
    });

    // A read grant confers visibility only, so every write silently matches no row.
    expect(writes).toEqual({ deletedRow: 0, renamed: 0, updatedRow: 0 });

    await expect(
      asTenant(grantee, (transaction) =>
        transaction.query(
          `insert into app.dataset_row (dataset_id, organization_id, row_number, data)
           values ($1, $2, 99, '{}'::jsonb)`,
          [ownedDatasetId, grantee.organizationId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    const unchanged = await readDatasetRowPage(apiPool, {
      ...creator,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });

    expect(unchanged?.rows).toHaveLength(ROW_COUNT);
  });

  it('walks the rows by keyset instead of by offset', async () => {
    const first = await readDatasetRowPage(apiPool, {
      ...creator,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 2,
    });
    const second = await readDatasetRowPage(apiPool, {
      ...creator,
      after: 1,
      datasetId: ownedDatasetId,
      pageSize: 2,
    });
    const last = await readDatasetRowPage(apiPool, {
      ...creator,
      after: 3,
      datasetId: ownedDatasetId,
      pageSize: 2,
    });

    expect(first?.rows.map((row) => row.rowNumber)).toEqual([0, 1]);
    expect(second?.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(last?.rows.map((row) => row.rowNumber)).toEqual([4]);
    expect(first?.rows[0]?.data).toEqual({ count: 0, label: 'row-0' });
  });

  it('streams an export in bounded batches instead of one resident read', async () => {
    let acquired = 0;
    const countAcquire = (): void => {
      acquired += 1;
    };
    apiPool.on('acquire', countAcquire);
    const batches: (readonly DatasetRowRecord[])[] = [];

    try {
      for await (const batch of streamDatasetRows(apiPool, {
        ...creator,
        batchSize: 2,
        datasetId: ownedDatasetId,
      })) {
        batches.push(batch);
      }
    } finally {
      apiPool.off('acquire', countAcquire);
    }

    // Structural, not timed: one bounded tenant transaction per batch, and no batch wider than the bound.
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(acquired).toBe(3);

    let earlyAcquired = 0;
    const countEarly = (): void => {
      earlyAcquired += 1;
    };
    apiPool.on('acquire', countEarly);
    const iterator = streamDatasetRows(apiPool, {
      ...creator,
      batchSize: 2,
      datasetId: ownedDatasetId,
    });
    const firstBatch = await iterator.next();
    await iterator.return(undefined);
    apiPool.off('acquire', countEarly);

    // Abandoning the download after one batch reads one batch, so nothing was fetched ahead.
    expect(firstBatch.value).toHaveLength(2);
    expect(earlyAcquired).toBe(1);
  });

  it('hides a dataset from a tenant that has no grant for it', async () => {
    const page = await readDatasetRowPage(apiPool, {
      ...creator,
      after: null,
      datasetId: foreignDatasetId,
      pageSize: 10,
    });

    expect(page).toBeNull();
  });
});
