import { describe, expect, it } from 'vitest';

import type { AiConfiguration } from './config.js';
import { generateModelText } from './model.js';
import { createAiRegistry } from './registry.js';

function configuration(
  overrides: Partial<AiConfiguration> = {},
): AiConfiguration {
  return {
    models: { chat: { model: 'test-model', provider: 'anthropic' } },
    providers: {
      anthropic: { apiKey: 'test-only-value', baseUrl: undefined },
    },
    ...overrides,
  };
}

// Records every request the provider attempts and answers without touching the network.
function recordingFetch(requests: string[]): typeof globalThis.fetch {
  return (input) => {
    requests.push(input instanceof Request ? input.url : String(input));

    return Promise.resolve(
      new Response('{"error":"denied"}', {
        headers: { 'content-type': 'application/json' },
        status: 401,
      }),
    );
  };
}

describe('createAiRegistry', () => {
  it('builds an anthropic model for the configured provider', () => {
    const registry = createAiRegistry(configuration());
    const model = registry.languageModel('anthropic:claude-test');

    expect(model.modelId).toBe('claude-test');
    expect(model.provider).toContain('anthropic');
  });

  it('builds an openai model for the configured provider', () => {
    const registry = createAiRegistry(
      configuration({
        providers: {
          openai: { apiKey: 'test-only-value', baseUrl: undefined },
        },
      }),
    );
    const model = registry.languageModel('openai:gpt-test');

    expect(model.modelId).toBe('gpt-test');
    expect(model.provider).toContain('openai');
  });

  it('refuses a model from a provider the credential did not configure', () => {
    const registry = createAiRegistry(configuration());

    expect(() => registry.languageModel('openai:gpt-test')).toThrow();
  });

  it('resolves a model role named by the credential', () => {
    const registry = createAiRegistry(configuration());

    expect(registry.modelId('chat')).toBe('anthropic:test-model');
  });

  it('refuses a model role the credential does not name', () => {
    const registry = createAiRegistry(configuration());

    expect(() => registry.modelId('summary')).toThrow('names no model');
  });

  it('serves each role from the provider its credential names', () => {
    const registry = createAiRegistry({
      models: {
        chat: { model: 'claude-test', provider: 'anthropic' },
        embedding: { model: 'text-embedding-test', provider: 'openai' },
      },
      providers: {
        anthropic: { apiKey: 'anthropic-test-value', baseUrl: undefined },
        openai: { apiKey: 'openai-test-value', baseUrl: undefined },
      },
    });

    expect(registry.modelId('chat')).toBe('anthropic:claude-test');
    expect(registry.modelId('embedding')).toBe('openai:text-embedding-test');
    expect(registry.embeddingModel(registry.modelId('embedding')).modelId).toBe(
      'text-embedding-test',
    );
    expect(registry.languageModel(registry.modelId('chat')).provider).toContain(
      'anthropic',
    );
  });

  it('sends anthropic requests to the configured base URL', async () => {
    const requests: string[] = [];
    const registry = createAiRegistry(
      configuration({
        providers: {
          anthropic: {
            apiKey: 'test-only-value',
            baseUrl: 'https://anthropic.bap.invalid',
          },
        },
      }),
      { fetch: recordingFetch(requests) },
    );

    await expect(
      generateModelText(registry, 'anthropic:claude-test', {
        maxRetries: 0,
        prompt: 'ping',
      }),
    ).rejects.toThrow();

    expect(requests).toEqual(['https://anthropic.bap.invalid/messages']);
  });

  it('sends openai requests to the configured base URL', async () => {
    const requests: string[] = [];
    const registry = createAiRegistry(
      configuration({
        providers: {
          openai: {
            apiKey: 'test-only-value',
            baseUrl: 'https://openai.bap.invalid',
          },
        },
      }),
      { fetch: recordingFetch(requests) },
    );

    await expect(
      generateModelText(registry, 'openai:gpt-test', {
        maxRetries: 0,
        prompt: 'ping',
      }),
    ).rejects.toThrow();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^https:\/\/openai\.bap\.invalid\//);
  });
});
