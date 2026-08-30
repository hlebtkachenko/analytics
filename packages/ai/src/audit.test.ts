import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { describeModelCall } from './audit.js';
import { generateModelText } from './model.js';
import type { AiLanguageModel, AiRegistry } from './registry.js';

const secretPrompt = 'Summarise the confidential quarterly figures.';
const secretCompletion = 'Revenue fell by 12 percent.';

function mockRegistry(model: AiLanguageModel): AiRegistry {
  return {
    embeddingModel: () => {
      throw new Error('The audit helper must not resolve an embedding model.');
    },
    languageModel: () => model,
    modelId: () => 'anthropic:mock-model',
    provider: 'anthropic',
  };
}

describe('describeModelCall', () => {
  it('reports token counts and the outcome', () => {
    expect(
      describeModelCall({
        finishReason: 'stop',
        modelId: 'anthropic:mock-model',
        outcome: 'success',
        usage: {
          inputTokens: 11,
          inputTokenDetails: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            noCacheTokens: 11,
          },
          outputTokens: 5,
          outputTokenDetails: { reasoningTokens: 0, textTokens: 5 },
          totalTokens: 16,
        },
      }),
    ).toEqual({
      finishReason: 'stop',
      inputTokens: 11,
      modelId: 'anthropic:mock-model',
      outcome: 'success',
      outputTokens: 5,
      totalTokens: 16,
    });
  });

  it('reports a failed call without token counts', () => {
    expect(
      describeModelCall({ modelId: 'anthropic:mock-model', outcome: 'error' }),
    ).toEqual({
      finishReason: undefined,
      inputTokens: undefined,
      modelId: 'anthropic:mock-model',
      outcome: 'error',
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });

  it('never returns prompt or completion content', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () =>
        Promise.resolve({
          content: [{ text: secretCompletion, type: 'text' as const }],
          finishReason: { raw: 'end_turn', unified: 'stop' as const },
          usage: {
            inputTokens: {
              cacheRead: 0,
              cacheWrite: 0,
              noCache: 11,
              total: 11,
            },
            outputTokens: { reasoning: 0, text: 5, total: 5 },
          },
          warnings: [],
        }),
      modelId: 'mock-model',
    });

    const result = await generateModelText(
      mockRegistry(model),
      'anthropic:mock-model',
      { prompt: secretPrompt },
    );
    const audit = describeModelCall({
      finishReason: result.finishReason,
      modelId: 'anthropic:mock-model',
      outcome: 'success',
      usage: result.usage,
    });
    const serialized = JSON.stringify(audit);

    expect(result.text).toBe(secretCompletion);
    expect(serialized).not.toContain(secretCompletion);
    expect(serialized).not.toContain(secretPrompt);
    expect(Object.keys(audit).toSorted()).toEqual([
      'finishReason',
      'inputTokens',
      'modelId',
      'outcome',
      'outputTokens',
      'totalTokens',
    ]);
  });
});
