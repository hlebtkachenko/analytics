import type { AiRegistry } from '@bap/ai';
import { describe, expect, it } from 'vitest';

import {
  enqueueDatasetSummary,
  enqueueEmbeddingBackfill,
} from './agent-queue.js';
import type { AgentJobSender } from './agent-queue.js';

const datasetId = '00000000-0000-4000-8000-000000000001';
const organizationId = 'org-1';
const userId = 'user-1';

interface RecordingQueue {
  queue: AgentJobSender;
  sent: { data: object; name: string }[];
}

function recordingQueue(): RecordingQueue {
  const sent: { data: object; name: string }[] = [];

  return {
    queue: {
      send: (name, data) => {
        sent.push({ data, name });
        return Promise.resolve('job-1');
      },
    },
    sent,
  };
}

// Only the role lookup matters here, so the models themselves are never resolved.
function registryNaming(roles: readonly string[]): () => Promise<AiRegistry> {
  const resolved: AiRegistry = {
    embeddingModel: () => {
      throw new Error('The chain must not resolve an embedding model.');
    },
    languageModel: () => {
      throw new Error('The chain must not resolve a language model.');
    },
    modelId: (role: string) => {
      if (!roles.includes(role)) {
        throw new Error(`The AI credential names no model for role ${role}.`);
      }

      return `openai:mock-${role}`;
    },
  };

  return () => Promise.resolve(resolved);
}

describe('enqueueDatasetSummary', () => {
  it('sends identifiers only when the credential names a summary model', async () => {
    const fake = recordingQueue();

    await expect(
      enqueueDatasetSummary(
        { queue: fake.queue, registry: registryNaming(['summary']) },
        { datasetId, organizationId, userId },
      ),
    ).resolves.toBe(true);
    expect(fake.sent).toEqual([
      {
        data: { datasetId, organizationId, userId },
        name: 'summarize_dataset',
      },
    ]);
  });

  it('enqueues nothing when the credential names no summary model', async () => {
    const fake = recordingQueue();

    await expect(
      enqueueDatasetSummary(
        { queue: fake.queue, registry: registryNaming(['chat']) },
        { datasetId, organizationId, userId },
      ),
    ).resolves.toBe(false);
    expect(fake.sent).toEqual([]);
  });
});

describe('enqueueEmbeddingBackfill', () => {
  it('sends identifiers only when the credential names an embedding model', async () => {
    const fake = recordingQueue();

    await expect(
      enqueueEmbeddingBackfill(
        { queue: fake.queue, registry: registryNaming(['embedding']) },
        { organizationId, userId },
      ),
    ).resolves.toBe(true);
    expect(fake.sent).toEqual([
      {
        data: { organizationId, userId },
        name: 'backfill_dataset_embeddings',
      },
    ]);
  });

  it('enqueues nothing when the credential names no embedding model', async () => {
    const fake = recordingQueue();

    await expect(
      enqueueEmbeddingBackfill(
        { queue: fake.queue, registry: registryNaming(['chat']) },
        { organizationId, userId },
      ),
    ).resolves.toBe(false);
    expect(fake.sent).toEqual([]);
  });

  it('enqueues nothing when the AI credential cannot be loaded', async () => {
    const fake = recordingQueue();

    await expect(
      enqueueEmbeddingBackfill(
        {
          queue: fake.queue,
          registry: () =>
            Promise.reject(
              new Error('The AI provider requires a real API key.'),
            ),
        },
        { organizationId, userId },
      ),
    ).resolves.toBe(false);
    expect(fake.sent).toEqual([]);
  });
});
