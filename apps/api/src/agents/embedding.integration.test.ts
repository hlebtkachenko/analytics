import type { AiEmbeddingModel, AiRegistry } from '@bap/ai';
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
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillDatasetEmbeddings } from '../worker/backfill-embeddings.js';
import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import { summarizeDataset } from '../worker/summarize-dataset.js';
import { WorkerMetrics } from '../worker/worker-metrics.js';
import { BACKFILL_EMBEDDINGS_QUEUE } from './contract.js';
import {
  EMBEDDING_DIMENSIONS,
  findDatasetsNearDataset,
  searchDatasetsByEmbedding,
} from './embedding-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const summaryText = 'A placeholder catalogue sentence.';

let apiPool: DatabasePool;
let boss: PgBoss;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let metrics: WorkerMetrics;
let embedCalls = 0;
const alpha = { datasetId: '', organizationId: 'org-1', userId: 'user-1' };
const beta = { datasetId: '', organizationId: 'org-1', userId: 'user-1' };
const foreign = { datasetId: '', organizationId: 'org-2', userId: 'user-2' };

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

// A deterministic one-hot vector per text, so two identical documents embed identically.
function vectorFor(text: string): number[] {
  const slot =
    [...text].reduce((total, character) => total + character.charCodeAt(0), 0) %
    EMBEDDING_DIMENSIONS;

  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_value, index) =>
    index === slot ? 1 : 0,
  );
}

function testRegistry(): AiRegistry {
  const embeddingModel = new MockEmbeddingModelV4({
    doEmbed: ({ values }) => {
      embedCalls += 1;

      return Promise.resolve({
        embeddings: values.map((value) => vectorFor(value)),
        usage: { tokens: values.length },
        warnings: [],
      });
    },
    maxEmbeddingsPerCall: 64,
    modelId: 'mock-embedding',
  });
  const languageModel = new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ text: summaryText, type: 'text' as const }],
        finishReason: { raw: 'end_turn', unified: 'stop' as const },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 11, total: 11 },
          outputTokens: { reasoning: 0, text: 5, total: 5 },
        },
        warnings: [],
      }),
    modelId: 'mock-model',
  });

  return {
    embeddingModel: () => embeddingModel as unknown as AiEmbeddingModel,
    languageModel: () => languageModel,
    modelId: (role: string) =>
      role === 'embedding' ? 'openai:mock-embedding' : 'openai:mock-model',
    provider: 'openai',
  };
}

const registry = (): Promise<AiRegistry> => Promise.resolve(testRegistry());

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

// Neutral placeholder metadata; alpha and foreign are identical so their vectors collide by construction.
async function createDataset(
  tenant: { organizationId: string; userId: string },
  name: string,
  description: string,
): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.dataset (organization_id, name, description, status, created_by)
       values ($1, $2, $3, 'ready', $4)
       returning id`,
      [tenant.organizationId, name, description, tenant.userId],
    );
    const datasetId = created.rows[0]?.id ?? '';
    await transaction.query(
      "insert into app.dataset_column (dataset_id, name, position, inferred_type) values ($1, 'column_a', 0, 'text')",
      [datasetId],
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
      values ('user-1', 'Member', 'member@example.test', true),
             ('user-2', 'Other', 'other@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  metrics = new WorkerMetrics();
  alpha.datasetId = await createDataset(
    alpha,
    'alpha container',
    'placeholder description',
  );
  beta.datasetId = await createDataset(
    beta,
    'beta container',
    'another placeholder description',
  );
  foreign.datasetId = await createDataset(
    foreign,
    'alpha container',
    'placeholder description',
  );
  boss = createQueueClientFromConfiguration(configurationFor('bap_api'));
  boss.on('error', () => undefined);
  await boss.start();
  await createQueue(boss, BACKFILL_EMBEDDINGS_QUEUE);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('dataset embedding agents against PostgreSQL', () => {
  it('carries identifiers only in the queued backfill payload', async () => {
    await boss.send(
      BACKFILL_EMBEDDINGS_QUEUE,
      { organizationId: alpha.organizationId, userId: alpha.userId },
      { retryLimit: 0 },
    );
    const queued = await apiPool.query<{ data: Record<string, unknown> }>(
      'select data from pgboss.job where name = $1',
      [BACKFILL_EMBEDDINGS_QUEUE],
    );

    expect(queued.rows).toHaveLength(1);
    expect(Object.keys(queued.rows[0]?.data ?? {}).sort()).toEqual([
      'organizationId',
      'userId',
    ]);
    const payload = JSON.stringify(queued.rows[0]?.data);

    expect(payload).not.toContain('alpha container');
    expect(payload).not.toContain(alpha.datasetId);
  });

  it('embeds only the datasets the acting subject created in its own tenant', async () => {
    await backfillDatasetEmbeddings({
      data: { organizationId: alpha.organizationId, userId: alpha.userId },
      metrics,
      pool: apiPool,
      registry,
    });
    await backfillDatasetEmbeddings({
      data: { organizationId: foreign.organizationId, userId: foreign.userId },
      metrics,
      pool: apiPool,
      registry,
    });

    const owner = await asTenant(alpha, async (transaction) => {
      const result = await transaction.query<{
        dataset_id: string;
        model: string;
      }>('select dataset_id, model from app.dataset_embedding order by model');
      const audit = await transaction.query<{
        action: string;
        resource_id: string;
      }>(
        "select action, resource_id from app.audit_log where action = 'dataset.embedded' order by resource_id",
      );
      return { audit: audit.rows, rows: result.rows };
    });
    const stranger = await asTenant(foreign, async (transaction) => {
      const result = await transaction.query<{ dataset_id: string }>(
        'select dataset_id from app.dataset_embedding',
      );
      return result.rows;
    });

    expect(owner.rows.map(({ dataset_id }) => dataset_id).sort()).toEqual(
      [alpha.datasetId, beta.datasetId].sort(),
    );
    expect(owner.rows[0]?.model).toBe('openai:mock-embedding');
    expect(owner.audit).toHaveLength(2);
    expect(stranger).toEqual([{ dataset_id: foreign.datasetId }]);
  });

  it('never returns another tenant dataset from a similarity query', async () => {
    const probe = vectorFor(
      'name: alpha container\ndescription: placeholder description\ncolumns: column_a (text)',
    );
    const owner = await searchDatasetsByEmbedding(apiPool, {
      embedding: probe,
      limit: 10,
      organizationId: alpha.organizationId,
      userId: alpha.userId,
    });
    const stranger = await searchDatasetsByEmbedding(apiPool, {
      embedding: probe,
      limit: 10,
      organizationId: foreign.organizationId,
      userId: foreign.userId,
    });

    // org-2 holds a byte identical vector, so its absence from the org-1 answer is the isolation proof.
    expect(owner[0]).toMatchObject({
      datasetId: alpha.datasetId,
      name: 'alpha container',
    });
    expect(owner.map(({ datasetId }) => datasetId)).not.toContain(
      foreign.datasetId,
    );
    expect(stranger).toHaveLength(1);
    expect(stranger[0]?.datasetId).toBe(foreign.datasetId);
  });

  it('finds neighbours of a stored vector inside the tenant only', async () => {
    const neighbours = await findDatasetsNearDataset(apiPool, {
      datasetId: alpha.datasetId,
      limit: 10,
      organizationId: alpha.organizationId,
      userId: alpha.userId,
    });

    expect(neighbours.map(({ datasetId }) => datasetId)).toEqual([
      beta.datasetId,
    ]);
  });

  it('re-embeds only after the dataset text actually changes', async () => {
    const before = embedCalls;
    await backfillDatasetEmbeddings({
      data: { organizationId: alpha.organizationId, userId: alpha.userId },
      metrics,
      pool: apiPool,
      registry,
    });

    expect(embedCalls).toBe(before);
    await summarizeDataset({
      data: {
        datasetId: alpha.datasetId,
        organizationId: alpha.organizationId,
        userId: alpha.userId,
      },
      metrics,
      pool: apiPool,
      registry,
    });
    await backfillDatasetEmbeddings({
      data: { organizationId: alpha.organizationId, userId: alpha.userId },
      metrics,
      pool: apiPool,
      registry,
    });

    const stored = await asTenant(alpha, async (transaction) => {
      const dataset = await transaction.query<{ description: string }>(
        'select description from app.dataset where id = $1',
        [alpha.datasetId],
      );
      const audit = await transaction.query<{ metadata: unknown }>(
        "select metadata from app.audit_log where action = 'dataset.summarized'",
      );
      return { audit: audit.rows, dataset: dataset.rows };
    });

    expect(embedCalls).toBe(before + 1);
    expect(stored.dataset[0]?.description).toBe(summaryText);
    expect(stored.audit[0]?.metadata).toMatchObject({
      modelId: 'openai:mock-model',
      outcome: 'success',
    });
    expect(JSON.stringify(stored.audit[0]?.metadata)).not.toContain(
      summaryText,
    );
  });

  it('exports agent counters without an identifier label', async () => {
    const output = await metrics.render();

    expect(output).toContain(
      'bap_worker_jobs_total{outcome="completed",queue="backfill_dataset_embeddings"} 4',
    );
    expect(output).toContain(
      'bap_worker_jobs_total{outcome="completed",queue="summarize_dataset"} 1',
    );
    expect(output).not.toContain(alpha.datasetId);
    expect(output).not.toContain('org-1');
    expect(output).not.toContain('user-1');
  });
});
