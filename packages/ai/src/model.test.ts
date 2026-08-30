import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { generateModelText, streamModelText } from './model.js';
import type { AiLanguageModel, AiRegistry } from './registry.js';

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 11, total: 11 },
  outputTokens: { reasoning: 0, text: 5, total: 5 },
};

// The registry seam is the only thing the wrappers touch, so a mock model satisfies it.
function mockRegistry(model: AiLanguageModel): AiRegistry {
  return {
    embeddingModel: () => {
      throw new Error('The text wrappers must not resolve an embedding model.');
    },
    languageModel: () => model,
    modelId: () => 'anthropic:mock-model',
    provider: 'anthropic',
  };
}

describe('generateModelText', () => {
  it('calls the model the registry resolves and returns its text', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () =>
        Promise.resolve({
          content: [{ text: 'mocked answer', type: 'text' as const }],
          finishReason: { raw: 'end_turn', unified: 'stop' as const },
          usage,
          warnings: [],
        }),
      modelId: 'mock-model',
    });

    const result = await generateModelText(
      mockRegistry(model),
      'anthropic:mock-model',
      { prompt: 'ping' },
    );

    expect(result.text).toBe('mocked answer');
    expect(result.usage.inputTokens).toBe(11);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});

describe('streamModelText', () => {
  it('streams the chunks the mocked model produces', async () => {
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              { id: '1', type: 'text-start' as const },
              { delta: 'mocked ', id: '1', type: 'text-delta' as const },
              { delta: 'stream', id: '1', type: 'text-delta' as const },
              { id: '1', type: 'text-end' as const },
              {
                finishReason: { raw: 'end_turn', unified: 'stop' as const },
                type: 'finish' as const,
                usage,
              },
            ],
          }),
        }),
      modelId: 'mock-model',
    });

    const result = streamModelText(
      mockRegistry(model),
      'anthropic:mock-model',
      { prompt: 'ping' },
    );

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('mocked stream');
    expect(await result.finishReason).toBe('stop');
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
