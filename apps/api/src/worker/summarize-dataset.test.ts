import type { AiRegistry } from '@bap/ai';
import type { DatabasePool } from '@bap/db/pool';
import { MockLanguageModelV4 } from 'ai/test';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { summarizeDataset } from './summarize-dataset.js';
import { WorkerMetrics } from './worker-metrics.js';

const datasetId = '00000000-0000-4000-8000-000000000001';
const organizationId = 'org-1';
const userId = 'user-1';
const membership = [{ email_verified: true, role: 'owner' }];
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 11, total: 11 },
  outputTokens: { reasoning: 0, text: 5, total: 5 },
};

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface QueryResult {
  rowCount?: number;
  rows: unknown[];
}

interface TracingPool {
  connects: number;
  openDepth: () => number;
  pool: DatabasePool;
  queries: RecordedQuery[];
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
    queries: [],
    trace,
  };
  const client = {
    query: async (text: string, values: unknown[] = []) => {
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
      state.queries.push({ text, values });
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

// The mock model marks the trace with the transaction depth it observed at call time.
function mockRegistry(
  trace: string[],
  openDepth: () => number,
  text: string,
): AiRegistry {
  const model = new MockLanguageModelV4({
    doGenerate: () => {
      trace.push(`model(open=${String(openDepth())})`);

      return Promise.resolve({
        content: [{ text, type: 'text' as const }],
        finishReason: { raw: 'end_turn', unified: 'stop' as const },
        usage,
        warnings: [],
      });
    },
    modelId: 'mock-model',
  });

  return {
    embeddingModel: () => {
      throw new Error('The summary job must not resolve an embedding model.');
    },
    languageModel: () => model,
    modelId: () => 'anthropic:mock-model',
    provider: 'anthropic',
  };
}

function respondWith(updatedRows: number): (text: string) => QueryResult {
  return (text: string) => {
    if (text.includes('from app.dataset as d')) {
      return {
        rows: [
          {
            columns: 'column_a (text), column_b (number)',
            name: 'alpha container',
            rows: '2',
          },
        ],
      };
    }

    if (text.startsWith('update app.dataset')) {
      return { rowCount: updatedRows, rows: [] };
    }

    return { rows: [] };
  };
}

describe('summarizeDataset', () => {
  it('never holds a transaction open across the provider call', async () => {
    const fake = createTracingPool(membership, respondWith(1));

    await summarizeDataset({
      data: { datasetId, organizationId, userId },
      metrics: new WorkerMetrics(),
      pool: fake.pool,
      registry: () =>
        Promise.resolve(
          mockRegistry(fake.trace, fake.openDepth, 'A placeholder summary.'),
        ),
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
    const fake = createTracingPool(membership, respondWith(1));
    let resolved = 0;

    await expect(
      summarizeDataset({
        data: { datasetId, organizationId, sample: 'row content', userId },
        metrics: new WorkerMetrics(),
        pool: fake.pool,
        registry: () => {
          resolved += 1;
          return Promise.resolve(
            mockRegistry(fake.trace, fake.openDepth, 'unused'),
          );
        },
      }),
    ).rejects.toThrow();
    expect(resolved).toBe(0);
    expect(fake.connects).toBe(0);
  });

  it('aborts without opening a transaction when membership is revoked', async () => {
    const fake = createTracingPool([], respondWith(1));

    await expect(
      summarizeDataset({
        data: { datasetId, organizationId, userId },
        metrics: new WorkerMetrics(),
        pool: fake.pool,
        registry: () =>
          Promise.resolve(
            mockRegistry(fake.trace, fake.openDepth, 'A placeholder summary.'),
          ),
      }),
    ).rejects.toThrow('Job subject has no membership in the organization.');
    expect(fake.connects).toBe(0);
    expect(fake.trace).toEqual([]);
  });

  it('sends schema only to the model and no stored cell value', async () => {
    const fake = createTracingPool(membership, respondWith(1));
    const registry = mockRegistry(
      fake.trace,
      fake.openDepth,
      'A placeholder summary.',
    );

    await summarizeDataset({
      data: { datasetId, organizationId, userId },
      metrics: new WorkerMetrics(),
      pool: fake.pool,
      registry: () => Promise.resolve(registry),
    });

    const profileQuery = fake.queries.find(({ text }) =>
      text.includes('from app.dataset as d'),
    );

    // The profile statement reads names, types and a count; it never selects app.dataset_row.data.
    expect(profileQuery?.text).toContain('inferred_type');
    expect(profileQuery?.text).not.toMatch(/\bdata\b/);
  });

  it('sanitizes and bounds the model answer before storing it', async () => {
    const fake = createTracingPool(membership, respondWith(1));

    await summarizeDataset({
      data: { datasetId, organizationId, userId },
      metrics: new WorkerMetrics(),
      pool: fake.pool,
      registry: () =>
        Promise.resolve(
          mockRegistry(
            fake.trace,
            fake.openDepth,
            `  ${'long '.repeat(200)}\u0000tail  `,
          ),
        ),
    });

    const update = fake.queries.find(({ text }) =>
      text.startsWith('update app.dataset'),
    );
    const stored = update?.values[1];

    expect(typeof stored).toBe('string');
    expect(String(stored)).toHaveLength(500);
    expect(String(stored).startsWith('long ')).toBe(true);
    expect(String(stored)).not.toContain('\u0000');
  });

  it('audits the call without copying the prompt or the completion', async () => {
    const fake = createTracingPool(membership, respondWith(1));

    await summarizeDataset({
      data: { datasetId, organizationId, userId },
      metrics: new WorkerMetrics(),
      pool: fake.pool,
      registry: () =>
        Promise.resolve(
          mockRegistry(fake.trace, fake.openDepth, 'A placeholder summary.'),
        ),
    });

    const audit = fake.queries.find(({ text }) =>
      text.includes('record_audit'),
    );
    const metadata = JSON.parse(String(audit?.values[1])) as Record<
      string,
      unknown
    >;

    expect(metadata).toEqual({
      finishReason: 'stop',
      inputTokens: 11,
      modelId: 'anthropic:mock-model',
      outcome: 'success',
      outputTokens: 5,
      totalTokens: 16,
    });
    expect(JSON.stringify(metadata)).not.toContain('A placeholder summary.');
    expect(JSON.stringify(metadata)).not.toContain('alpha container');
  });

  it('refuses to finish when the update policy matches no row', async () => {
    const fake = createTracingPool(membership, respondWith(0));
    const metrics = new WorkerMetrics();

    await expect(
      summarizeDataset({
        data: { datasetId, organizationId, userId },
        metrics,
        pool: fake.pool,
        registry: () =>
          Promise.resolve(
            mockRegistry(fake.trace, fake.openDepth, 'A placeholder summary.'),
          ),
      }),
    ).rejects.toThrow('not writable by the job subject');
    expect(fake.trace.at(-1)).toBe('rollback');
    await expect(metrics.render()).resolves.toContain(
      'bap_worker_jobs_total{outcome="failed",queue="summarize_dataset"} 1',
    );
  });
});
