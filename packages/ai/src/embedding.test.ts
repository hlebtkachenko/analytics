import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { embedTexts } from './embedding.js';
import type { AiEmbeddingModel, AiRegistry } from './registry.js';

// The registry seam is the only thing the wrapper touches, so a mock model satisfies it.
function mockRegistry(model: AiEmbeddingModel): AiRegistry {
  return {
    embeddingModel: () => model,
    languageModel: () => {
      throw new Error(
        'The embedding wrapper must not resolve a language model.',
      );
    },
    modelId: () => 'openai:mock-embedding',
    provider: 'openai',
  };
}

describe('embedTexts', () => {
  it('embeds every value through the model the registry resolves', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map((_value, index) => [index, 0, 1]),
          usage: { tokens: values.length },
          warnings: [],
        }),
      maxEmbeddingsPerCall: 8,
      modelId: 'mock-embedding',
    });

    const result = await embedTexts(
      mockRegistry(model),
      'openai:mock-embedding',
      {
        values: ['first placeholder', 'second placeholder'],
      },
    );

    expect(result.embeddings).toEqual([
      [0, 0, 1],
      [1, 0, 1],
    ]);
    expect(result.values).toEqual(['first placeholder', 'second placeholder']);
    expect(model.doEmbedCalls).toHaveLength(1);
  });

  it('splits the values into the batches the model declares', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => [1, 0, 0]),
          usage: { tokens: values.length },
          warnings: [],
        }),
      maxEmbeddingsPerCall: 1,
      modelId: 'mock-embedding',
    });

    const result = await embedTexts(
      mockRegistry(model),
      'openai:mock-embedding',
      {
        maxParallelCalls: 1,
        values: ['alpha placeholder', 'beta placeholder'],
      },
    );

    expect(result.embeddings).toHaveLength(2);
    expect(model.doEmbedCalls).toHaveLength(2);
  });
});
