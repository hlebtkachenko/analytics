import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { developmentPlaceholderApiKey, loadAiConfiguration } from './config.js';

async function writeCredential(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bap-ai-'));
  const file = join(directory, 'ai-provider-config');
  await writeFile(file, content, { mode: 0o600 });

  return file;
}

describe('loadAiConfiguration', () => {
  it('rejects a missing credential file path', async () => {
    await expect(loadAiConfiguration({ NODE_ENV: 'test' })).rejects.toThrow();
  });

  it('rejects a world-readable credential file', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}}}\n',
    );
    await chmod(file, 0o644);

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('protected regular file');
  });

  it('rejects a non-regular credential file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-ai-'));

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: directory }),
    ).rejects.toThrow('protected regular file');
  });

  it('rejects an empty credential file', async () => {
    const file = await writeCredential('\n');

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is empty');
  });

  it('rejects a credential file that is not JSON', async () => {
    const file = await writeCredential('provider=anthropic\n');

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('not valid JSON');
  });

  it('rejects a credential that configures no provider', async () => {
    const file = await writeCredential('{"providers":{}}\n');

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: providers');
  });

  it('rejects an unknown provider name', async () => {
    const file = await writeCredential(
      '{"providers":{"mistral":{"apiKey":"test-only-value"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: providers');
  });

  it('rejects an unknown credential field', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}},"organization":"bap"}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: unrecognized_keys');
  });

  it('rejects a base URL that is not an http endpoint', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value","baseUrl":"ftp://ai.bap.invalid"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: providers.anthropic.baseUrl');
  });

  it('rejects a model role that names no provider', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}},"models":{"chat":"claude-test"}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: models.chat');
  });

  it('refuses the development placeholder key on any provider', async () => {
    const file = await writeCredential(
      `{"providers":{"anthropic":{"apiKey":"test-only-value"},"openai":{"apiKey":"${developmentPlaceholderApiKey}"}}}\n`,
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('requires a real API key');
  });

  it('refuses a model role whose provider is not configured', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}},"models":{"embedding":{"provider":"openai","model":"text-embedding-3-small"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow(
      'names model role embedding on provider openai, which it does not configure',
    );
  });

  it('never surfaces the API key in a validation error', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}},"models":{"chat":{"provider":"anthropic","model":""}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow(
      /^AI provider credential file is invalid: models\.chat\.model\.$/,
    );
  });

  it('accepts a minimal single-provider credential', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"test-only-value"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).resolves.toEqual({
      models: {},
      providers: {
        anthropic: { apiKey: 'test-only-value', baseUrl: undefined },
      },
    });
  });

  it('accepts a base URL and model defaults', async () => {
    const file = await writeCredential(
      '{"providers":{"openai":{"apiKey":"test-only-value","baseUrl":"https://ai.bap.invalid/v1"}},"models":{"chat":{"provider":"openai","model":"gpt-test"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).resolves.toEqual({
      models: { chat: { model: 'gpt-test', provider: 'openai' } },
      providers: {
        openai: {
          apiKey: 'test-only-value',
          baseUrl: 'https://ai.bap.invalid/v1',
        },
      },
    });
  });

  it('accepts one provider for chat and another for embeddings', async () => {
    const file = await writeCredential(
      '{"providers":{"anthropic":{"apiKey":"anthropic-test-value"},"openai":{"apiKey":"openai-test-value"}},"models":{"chat":{"provider":"anthropic","model":"claude-test"},"embedding":{"provider":"openai","model":"text-embedding-3-small"}}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).resolves.toEqual({
      models: {
        chat: { model: 'claude-test', provider: 'anthropic' },
        embedding: { model: 'text-embedding-3-small', provider: 'openai' },
      },
      providers: {
        anthropic: { apiKey: 'anthropic-test-value', baseUrl: undefined },
        openai: { apiKey: 'openai-test-value', baseUrl: undefined },
      },
    });
  });
});
