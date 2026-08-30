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
      '{"provider":"anthropic","apiKey":"test-only-value"}\n',
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

  it('rejects an unknown provider name', async () => {
    const file = await writeCredential(
      '{"provider":"mistral","apiKey":"test-only-value"}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: provider');
  });

  it('rejects an unknown credential field', async () => {
    const file = await writeCredential(
      '{"provider":"anthropic","apiKey":"test-only-value","organization":"bap"}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: unrecognized_keys');
  });

  it('rejects a base URL that is not an http endpoint', async () => {
    const file = await writeCredential(
      '{"provider":"anthropic","apiKey":"test-only-value","baseUrl":"ftp://ai.bap.invalid"}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('is invalid: baseUrl');
  });

  it('refuses the development placeholder key', async () => {
    const file = await writeCredential(
      `{"provider":"anthropic","apiKey":"${developmentPlaceholderApiKey}"}\n`,
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow('requires a real API key');
  });

  it('never surfaces the API key in a validation error', async () => {
    const file = await writeCredential(
      '{"provider":"anthropic","apiKey":"test-only-value","models":{"chat":""}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).rejects.toThrow(
      /^AI provider credential file is invalid: models\.chat\.$/,
    );
  });

  it('accepts a minimal credential', async () => {
    const file = await writeCredential(
      '{"provider":"anthropic","apiKey":"test-only-value"}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).resolves.toEqual({
      apiKey: 'test-only-value',
      baseUrl: undefined,
      models: {},
      provider: 'anthropic',
    });
  });

  it('accepts a base URL and model defaults', async () => {
    const file = await writeCredential(
      '{"provider":"openai","apiKey":"test-only-value","baseUrl":"https://ai.bap.invalid/v1","models":{"chat":"gpt-test"}}\n',
    );

    await expect(
      loadAiConfiguration({ BAP_AI_PROVIDER_CONFIG_FILE: file }),
    ).resolves.toEqual({
      apiKey: 'test-only-value',
      baseUrl: 'https://ai.bap.invalid/v1',
      models: { chat: 'gpt-test' },
      provider: 'openai',
    });
  });
});
