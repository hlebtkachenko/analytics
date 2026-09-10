import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import { resolveMembership } from '@bap/db/access';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantSelector } from '../tenant-access.js';
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

// Neutral placeholder tenants: an owner, a read-only member beside it, and a stranger in another one.
const creator: TenantSelector = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const reader: TenantSelector = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-2',
};
const stranger: TenantSelector = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-3',
};
// The absence of an entity filter is the "all entities" view.
const allEntities = { legalEntityIds: null };
let foreignDatasetId = '';
let foreignEntityId = '';
let ownedDatasetId = '';
let ownedEntityId = '';
let secondDatasetId = '';
let secondEntityId = '';

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
  tenant: TenantSelector,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

// One neutral placeholder entity per organization; every dataset attaches to exactly one.
async function createLegalEntity(
  tenant: TenantSelector,
  name: string,
): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, $2, 'company', $3)
       returning id`,
      [tenant.organizationId, name, tenant.userId],
    );
    return created.rows[0]?.id ?? '';
  });
}

async function createDataset(
  tenant: TenantSelector,
  legalEntityId: string,
): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.dataset (organization_id, legal_entity_id, name, description, status, created_by)
       values ($1, $2, 'placeholder container', 'placeholder description', 'ready', $3)
       returning id`,
      [tenant.organizationId, legalEntityId, tenant.userId],
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
  ownedEntityId = await createLegalEntity(creator, 'Placeholder Holding');
  secondEntityId = await createLegalEntity(creator, 'Placeholder Trader');
  foreignEntityId = await createLegalEntity(stranger, 'Placeholder Foreign');
  ownedDatasetId = await createDataset(creator, ownedEntityId);
  secondDatasetId = await createDataset(creator, secondEntityId);
  foreignDatasetId = await createDataset(stranger, foreignEntityId);
  // The member is restricted to the second entity only, which the API resolver reads back.
  await asTenant(creator, async (transaction) => {
    await transaction.query(
      `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by)
       values ($1, $2, 'restricted', $3)`,
      [creator.organizationId, reader.userId, creator.userId],
    );
    await transaction.query(
      `insert into app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by)
       values ($1, $2, $3, $4)`,
      [creator.organizationId, reader.userId, secondEntityId, creator.userId],
    );
  });
});

afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('dataset read and export queries against PostgreSQL', () => {
  it('never returns another tenant dataset or its rows', async () => {
    const strangerList = await listDatasets(apiPool, {
      ...stranger,
      ...allEntities,
    });
    const strangerPage = await readDatasetRowPage(apiPool, {
      ...stranger,
      ...allEntities,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });
    // A forged tenant selector cannot be built at all: the resolver denies this subject that organization.
    const forgedMembership = await resolveMembership(apiPool, {
      organizationId: creator.organizationId,
      subjectId: stranger.userId,
    });

    expect(strangerList.map((dataset) => dataset.id)).toEqual([
      foreignDatasetId,
    ]);
    expect(strangerPage).toBeNull();
    expect(forgedMembership).toBeNull();
  });

  it('lists every dataset of the organization with its row count and entity', async () => {
    const owned = await listDatasets(apiPool, { ...creator, ...allEntities });

    expect(owned.map((dataset) => dataset.id).sort()).toEqual(
      [ownedDatasetId, secondDatasetId].sort(),
    );
    expect(
      owned.find((dataset) => dataset.id === ownedDatasetId),
    ).toMatchObject({
      description: 'placeholder description',
      id: ownedDatasetId,
      legalEntityId: ownedEntityId,
      name: 'placeholder container',
      rowCount: ROW_COUNT,
      status: 'ready',
    });
  });

  it('applies the entity filter the scope resolver produced', async () => {
    const scoped = await listDatasets(apiPool, {
      ...reader,
      legalEntityIds: [secondEntityId],
    });
    const inScope = await readDatasetRowPage(apiPool, {
      ...reader,
      after: null,
      datasetId: secondDatasetId,
      legalEntityIds: [secondEntityId],
      pageSize: 10,
    });
    const outOfScope = await readDatasetRowPage(apiPool, {
      ...reader,
      after: null,
      datasetId: ownedDatasetId,
      legalEntityIds: [secondEntityId],
      pageSize: 10,
    });
    // An empty list is a caller who may see nothing, which is not the same as no filter at all.
    const nothing = await listDatasets(apiPool, {
      ...reader,
      legalEntityIds: [],
    });

    expect(scoped.map((dataset) => dataset.id)).toEqual([secondDatasetId]);
    expect(inScope?.rows).toHaveLength(ROW_COUNT);
    // A dataset outside the scope answers exactly like a missing one.
    expect(outOfScope).toBeNull();
    expect(nothing).toEqual([]);
  });

  it('lets a read-only member read the datasets and never write them', async () => {
    const visible = await listDatasets(apiPool, { ...reader, ...allEntities });
    const page = await readDatasetRowPage(apiPool, {
      ...reader,
      ...allEntities,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });

    // Without the application filter row level security shows the member the whole organization.
    expect(visible.map((dataset) => dataset.id).sort()).toEqual(
      [ownedDatasetId, secondDatasetId].sort(),
    );
    expect(page?.columns.map((column) => column.name)).toEqual([
      'label',
      'count',
    ]);
    expect(page?.rows).toHaveLength(ROW_COUNT);

    const writes = await asTenant(reader, async (transaction) => {
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

    // The member role confers visibility only, so every write silently matches no row.
    expect(writes).toEqual({ deletedRow: 0, renamed: 0, updatedRow: 0 });

    await expect(
      asTenant(reader, (transaction) =>
        transaction.query(
          `insert into app.dataset_row (dataset_id, organization_id, row_number, data)
           values ($1, $2, 99, '{}'::jsonb)`,
          [ownedDatasetId, reader.organizationId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    const unchanged = await readDatasetRowPage(apiPool, {
      ...creator,
      ...allEntities,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 10,
    });

    expect(unchanged?.rows).toHaveLength(ROW_COUNT);
  });

  it('walks the rows by keyset instead of by offset', async () => {
    const first = await readDatasetRowPage(apiPool, {
      ...creator,
      ...allEntities,
      after: null,
      datasetId: ownedDatasetId,
      pageSize: 2,
    });
    const second = await readDatasetRowPage(apiPool, {
      ...creator,
      ...allEntities,
      after: 1,
      datasetId: ownedDatasetId,
      pageSize: 2,
    });
    const last = await readDatasetRowPage(apiPool, {
      ...creator,
      ...allEntities,
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
        ...allEntities,
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
      ...allEntities,
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

  it('hides a dataset that belongs to another organization', async () => {
    const page = await readDatasetRowPage(apiPool, {
      ...creator,
      ...allEntities,
      after: null,
      datasetId: foreignDatasetId,
      pageSize: 10,
    });

    expect(page).toBeNull();
  });
});
