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
        dimensions: 1_536,
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
        dimensions: 1_536,
        maxParallelCalls: 1,
        values: ['alpha placeholder', 'beta placeholder'],
      },
    );

    expect(result.embeddings).toHaveLength(2);
    expect(model.doEmbedCalls).toHaveLength(2);
  });

  it('requests the reduced width from the provider that serves the model', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => [1, 0, 0]),
          usage: { tokens: values.length },
          warnings: [],
        }),
      maxEmbeddingsPerCall: 8,
      modelId: 'mock-embedding',
    });

    await embedTexts(mockRegistry(model), 'openai:mock-embedding', {
      dimensions: 1_536,
      values: ['first placeholder'],
    });

    // The provider reads its own namespace, so the width must arrive under the provider name.
    expect(model.doEmbedCalls[0]?.providerOptions).toEqual({
      openai: { dimensions: 1_536 },
    });
  });

  it('keys the requested width by the provider the model id names', async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => [1, 0, 0]),
          usage: { tokens: values.length },
          warnings: [],
        }),
      maxEmbeddingsPerCall: 8,
      modelId: 'mock-embedding',
    });
    const registry: AiRegistry = {
      ...mockRegistry(model),
      modelId: () => 'anthropic:mock-embedding',
    };

    await embedTexts(registry, 'anthropic:mock-embedding', {
      dimensions: 256,
      values: ['first placeholder'],
    });

    expect(model.doEmbedCalls[0]?.providerOptions).toEqual({
      anthropic: { dimensions: 256 },
    });
  });
});
