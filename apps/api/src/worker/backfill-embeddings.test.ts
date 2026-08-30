import type { AiEmbeddingModel, AiRegistry } from '@bap/ai';
import type { DatabasePool } from '@bap/db/pool';
import { MockEmbeddingModelV4 } from 'ai/test';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { hashDocument, renderDatasetDocument } from '../agents/document.js';
import { EMBEDDING_DIMENSIONS } from '../agents/embedding-repository.js';
import { backfillDatasetEmbeddings } from './backfill-embeddings.js';
import { WorkerMetrics } from './worker-metrics.js';

const organizationId = 'org-1';
const userId = 'user-1';
const modelId = 'openai:mock-embedding';
const membership = [{ email_verified: true, role: 'owner' }];

interface CandidateRow {
  columns: string;
  content_hash: string | null;
  dataset_id: string;
  description: string;
  model: string | null;
  name: string;
}

interface QueryResult {
  rowCount?: number;
  rows: unknown[];
}

interface TracingPool {
  connects: number;
  openDepth: () => number;
  pool: DatabasePool;
  trace: string[];
}

// Records transaction boundaries and statements in one ordered trace, so interleaving is assertable.
function createTracingPool(
  membershipRows: Record<string, unknown>[],
  respond: (text: string) => QueryResult,
): TracingPool {
  const trace: string[] = [];
  let open = 0;
  const state: TracingPool = {
    connects: 0,
    openDepth: () => open,
    pool: undefined as unknown as DatabasePool,
    trace,
  };
  const client = {
    query: async (text: string) => {
      if (text === 'begin') {
        open += 1;
        trace.push('begin');
        return { rows: [] };
      }

      if (text === 'commit' || text === 'rollback') {
        open -= 1;
        trace.push(text);
        return { rows: [] };
      }

      trace.push(text.includes('set_config') ? 'context' : 'query');
      return respond(text);
    },
    release: () => undefined,
  };

  state.pool = {
    connect: async () => {
      state.connects += 1;
      return client as unknown as PoolClient;
    },
    query: async () => ({ rows: membershipRows }),
  } as unknown as DatabasePool;

  return state;
}

function embedding(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);
}

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    columns: 'column_a (text)',
    content_hash: null,
    dataset_id: '00000000-0000-4000-8000-000000000001',
    description: 'placeholder description',
    model: null,
    name: 'alpha container',
    ...overrides,
  };
}

// The mock model marks the trace with the transaction depth it observed at call time.
function mockRegistry(
  trace: string[],
  openDepth: () => number,
  behaviour: 'fail' | 'succeed' = 'succeed',
): AiRegistry {
  const model = new MockEmbeddingModelV4({
    doEmbed: ({ values }) => {
      trace.push(`model(open=${String(openDepth())})`);

      if (behaviour === 'fail') {
        return Promise.reject(new Error('provider refused'));
      }

      return Promise.resolve({
        embeddings: values.map((_value, index) => embedding(index + 1)),
        usage: { tokens: values.length },
        warnings: [],
      });
    },
    maxEmbeddingsPerCall: 64,
    modelId: 'mock-embedding',
  });

  return {
    embeddingModel: () => model as unknown as AiEmbeddingModel,
    languageModel: () => {
      throw new Error('The backfill must not resolve a language model.');
    },
    modelId: () => modelId,
    provider: 'openai',
  };
}

function respondWith(
  candidates: CandidateRow[],
): (text: string) => QueryResult {
  let page = 0;

  return (text: string) => {
    if (text.includes('left join app.dataset_embedding')) {
      page += 1;
      return { rows: page === 1 ? candidates : [] };
    }

    if (text.includes('insert into app.dataset_embedding')) {
      return { rowCount: candidates.length, rows: [] };
    }

    return { rows: [] };
  };
}

describe('backfillDatasetEmbeddings', () => {
  it('never holds a transaction open across the provider call', async () => {
    const rows = [
      candidate(),
      candidate({
        dataset_id: '00000000-0000-4000-8000-000000000002',
        name: 'beta container',
      }),
    ];
    const fake = createTracingPool(membership, respondWith(rows));
    const metrics = new WorkerMetrics();

    await backfillDatasetEmbeddings({
      data: { organizationId, userId },
      metrics,
      pool: fake.pool,
      registry: () => Promise.resolve(mockRegistry(fake.trace, fake.openDepth)),
    });

    // The read commits, the model answers with no transaction open, then the write opens its own.
    expect(fake.trace).toEqual([
      'begin',
      'context',
      'query',
      'commit',
      'model(open=0)',
      'begin',
      'context',
      'query',
      'query',
      'commit',
    ]);
    expect(fake.openDepth()).toBe(0);
  });

  it('fails a malformed payload before resolving the model or the database', async () => {
    const fake = createTracingPool(membership, respondWith([]));
    let resolved = 0;

    await expect(
      backfillDatasetEmbeddings({
        data: { organizationId, prompt: 'leaked', userId },
        metrics: new WorkerMetrics(),
        pool: fake.pool,
        registry: () => {
          resolved += 1;
          return Promise.resolve(mockRegistry(fake.trace, fake.openDepth));
        },
      }),
    ).rejects.toThrow();
    expect(resolved).toBe(0);
    expect(fake.connects).toBe(0);
    expect(fake.trace).toEqual([]);
  });

  it('aborts without opening a transaction when membership is revoked', async () => {
    const fake = createTracingPool([], respondWith([candidate()]));

    await expect(
      backfillDatasetEmbeddings({
        data: { organizationId, userId },
        metrics: new WorkerMetrics(),
        pool: fake.pool,
        registry: () =>
          Promise.resolve(mockRegistry(fake.trace, fake.openDepth)),
      }),
    ).rejects.toThrow('Job subject has no membership in the organization.');
    expect(fake.connects).toBe(0);
    expect(fake.trace).toEqual([]);
  });

  it('skips a dataset whose stored vector already matches the model and the text', async () => {
    const unchanged = candidate();
    const document = renderDatasetDocument({
      columns: unchanged.columns,
      description: unchanged.description,
      name: unchanged.name,
    });
    const fake = createTracingPool(
      membership,
      respondWith([
        { ...unchanged, content_hash: hashDocument(document), model: modelId },
      ]),
    );
    const metrics = new WorkerMetrics();

    await backfillDatasetEmbeddings({
      data: { organizationId, userId },
      metrics,
      pool: fake.pool,
      registry: () => Promise.resolve(mockRegistry(fake.trace, fake.openDepth)),
    });

    // Only the read transaction runs: no provider call and no write.
    expect(fake.trace).toEqual(['begin', 'context', 'query', 'commit']);
    await expect(metrics.render()).resolves.toContain(
      'bap_worker_embedded_datasets_total 0',
    );
  });

  it('re-embeds a dataset whose stored vector came from another model', async () => {
    const stale = candidate();
    const document = renderDatasetDocument({
      columns: stale.columns,
      description: stale.description,
      name: stale.name,
    });
    const fake = createTracingPool(
      membership,
      respondWith([
        {
          ...stale,
          content_hash: hashDocument(document),
          model: 'openai:previous-embedding',
        },
      ]),
    );

    await backfillDatasetEmbeddings({
      data: { organizationId, userId },
      metrics: new WorkerMetrics(),
      pool: fake.pool,
      registry: () => Promise.resolve(mockRegistry(fake.trace, fake.openDepth)),
    });

    expect(fake.trace).toContain('model(open=0)');
  });

  it('counts the provider failure and leaves no transaction open', async () => {
    const fake = createTracingPool(membership, respondWith([candidate()]));
    const metrics = new WorkerMetrics();

    await expect(
      backfillDatasetEmbeddings({
        data: { organizationId, userId },
        metrics,
        pool: fake.pool,
        registry: () =>
          Promise.resolve(mockRegistry(fake.trace, fake.openDepth, 'fail')),
      }),
    ).rejects.toThrow();

    const output = await metrics.render();

    expect(fake.openDepth()).toBe(0);
    expect(output).toContain('bap_worker_model_calls_total{outcome="error"} 1');
    expect(output).toContain(
      'bap_worker_jobs_total{outcome="failed",queue="backfill_dataset_embeddings"} 1',
    );
    expect(output).not.toContain(organizationId);
    expect(output).not.toContain(userId);
  });

  it('exports agent counters without an identifier label', async () => {
    const fake = createTracingPool(membership, respondWith([candidate()]));
    const metrics = new WorkerMetrics();

    await backfillDatasetEmbeddings({
      data: { organizationId, userId },
      metrics,
      pool: fake.pool,
      registry: () => Promise.resolve(mockRegistry(fake.trace, fake.openDepth)),
    });

    const output = await metrics.render();

    expect(output).toContain(
      'bap_worker_model_calls_total{outcome="success"} 1',
    );
    expect(output).toContain('bap_worker_embedded_datasets_total 1');
    expect(output).toContain(
      'bap_worker_jobs_total{outcome="completed",queue="backfill_dataset_embeddings"} 1',
    );
    expect(output).not.toContain(organizationId);
    expect(output).not.toContain(userId);
    expect(output).not.toContain('alpha container');
  });
});
