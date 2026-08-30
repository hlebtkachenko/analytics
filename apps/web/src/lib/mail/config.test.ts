import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  developmentPlaceholderApiKey,
  loadMailConfiguration,
} from './config.ts';

describe('loadMailConfiguration', () => {
  it('rejects a missing key-file path', async () => {
    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow();
  });

  it('rejects a world-readable key file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });
    await chmod(file, 0o644);

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('protected regular file');
  });

  it('rejects a non-regular key file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_RESEND_API_KEY_FILE: directory,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('protected regular file');
  });

  it('rejects an invalid sender address', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'not-an-email',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).resolves.toEqual({
      apiKey: 'test-only-value',
      sender: 'team@bap.invalid',
      transport: 'resend',
    });
  });

  it('accepts an absent key file for the opt-in log transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'missing-resend-api-key');

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_MAIL_TRANSPORT: 'log',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).resolves.toEqual({
      apiKey: undefined,
      sender: 'team@bap.invalid',
      transport: 'log',
    });
  });

  it('refuses the resend transport when the key file is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'missing-resend-api-key');

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('requires a real API key');
  });

  it('refuses the resend transport for the development placeholder', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, `${developmentPlaceholderApiKey}\n`, { mode: 0o600 });

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('requires a real API key');
  });

  it('rejects an unknown transport name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    await expect(
      loadMailConfiguration({
        BAP_MAIL_SENDER: 'team@bap.invalid',
        BAP_MAIL_TRANSPORT: 'smtp',
        BAP_RESEND_API_KEY_FILE: file,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow();
  });

  it('applies the documented default sender', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-mail-'));
    const file = join(directory, 'resend-api-key');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    const configuration = await loadMailConfiguration({
      BAP_RESEND_API_KEY_FILE: file,
      NODE_ENV: 'test',
    });

    expect(configuration.sender).toBe('no-reply@bap.localhost');
  });
});
