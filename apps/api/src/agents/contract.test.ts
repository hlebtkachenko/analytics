import { describe, expect, it } from 'vitest';

import {
  BACKFILL_EMBEDDINGS_QUEUE,
  backfillEmbeddingsJobSchema,
  SUMMARIZE_DATASET_QUEUE,
  summarizeDatasetJobSchema,
} from './contract.js';

const datasetId = '00000000-0000-4000-8000-000000000001';

describe('backfillEmbeddingsJobSchema', () => {
  it('accepts a payload carrying identifiers only', () => {
    expect(
      backfillEmbeddingsJobSchema.parse({
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toEqual({ organizationId: 'org-1', userId: 'user-1' });
  });

  it('rejects any key that could carry content into pgboss.job', () => {
    expect(() =>
      backfillEmbeddingsJobSchema.parse({
        documents: ['confidential text'],
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toThrow();
    expect(() =>
      backfillEmbeddingsJobSchema.parse({
        apiKey: 'secret',
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toThrow();
  });

  it('rejects a missing tenant or subject identifier', () => {
    expect(() =>
      backfillEmbeddingsJobSchema.parse({ userId: 'user-1' }),
    ).toThrow();
    expect(() =>
      backfillEmbeddingsJobSchema.parse({ organizationId: 'org-1' }),
    ).toThrow();
  });
});

describe('summarizeDatasetJobSchema', () => {
  it('accepts identifiers only', () => {
    expect(
      summarizeDatasetJobSchema.parse({
        datasetId,
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toEqual({ datasetId, organizationId: 'org-1', userId: 'user-1' });
  });

  it('rejects a prompt, a sample or any other unknown key', () => {
    expect(() =>
      summarizeDatasetJobSchema.parse({
        datasetId,
        organizationId: 'org-1',
        prompt: 'Summarise the confidential figures.',
        userId: 'user-1',
      }),
    ).toThrow();
  });

  it('rejects a dataset identifier that is not a uuid', () => {
    expect(() =>
      summarizeDatasetJobSchema.parse({
        datasetId: 'dataset-1',
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toThrow();
  });
});

describe('agent queue names', () => {
  it('keeps the queue names distinct and snake cased', () => {
    expect(BACKFILL_EMBEDDINGS_QUEUE).toBe('backfill_dataset_embeddings');
    expect(SUMMARIZE_DATASET_QUEUE).toBe('summarize_dataset');
  });
});
