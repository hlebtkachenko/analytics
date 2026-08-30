import { describe, expect, it } from 'vitest';

import type { AiConfiguration, AiProviderName } from './config.js';
import { generateModelText } from './model.js';
import { createAiRegistry } from './registry.js';

function configuration(
  provider: AiProviderName,
  overrides: Partial<AiConfiguration> = {},
): AiConfiguration {
  return {
    apiKey: 'test-only-value',
    baseUrl: undefined,
    models: { chat: 'test-model' },
    provider,
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
    const registry = createAiRegistry(configuration('anthropic'));
    const model = registry.languageModel('anthropic:claude-test');

    expect(registry.provider).toBe('anthropic');
    expect(model.modelId).toBe('claude-test');
    expect(model.provider).toContain('anthropic');
  });

  it('builds an openai model for the configured provider', () => {
    const registry = createAiRegistry(configuration('openai'));
    const model = registry.languageModel('openai:gpt-test');

    expect(registry.provider).toBe('openai');
    expect(model.modelId).toBe('gpt-test');
    expect(model.provider).toContain('openai');
  });

  it('refuses a model from a provider the credential did not select', () => {
    const registry = createAiRegistry(configuration('anthropic'));

    expect(() => registry.languageModel('openai:gpt-test')).toThrow();
  });

  it('resolves a model role named by the credential', () => {
    const registry = createAiRegistry(configuration('openai'));

    expect(registry.modelId('chat')).toBe('openai:test-model');
  });

  it('refuses a model role the credential does not name', () => {
    const registry = createAiRegistry(configuration('openai'));

    expect(() => registry.modelId('summary')).toThrow('names no model');
  });

  it('sends anthropic requests to the configured base URL', async () => {
    const requests: string[] = [];
    const registry = createAiRegistry(
      configuration('anthropic', { baseUrl: 'https://anthropic.bap.invalid' }),
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
      configuration('openai', { baseUrl: 'https://openai.bap.invalid' }),
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
