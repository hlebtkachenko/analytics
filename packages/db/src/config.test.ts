import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDatabaseConfiguration } from './config.js';

describe('loadDatabaseConfiguration', () => {
  it('loads a role password from a file without a URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-db-'));
    const file = join(directory, 'api-password');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    const configuration = await loadDatabaseConfiguration(
      {
        BAP_DATABASE_HOST: 'database',
        BAP_DATABASE_NAME: 'bap',
        BAP_DATABASE_PASSWORD_FILE: file,
        BAP_DATABASE_USER: 'bap_api',
      },
      { role: 'bap_api' },
    );

    expect(configuration).toMatchObject({
      database: 'bap',
      host: 'database',
      port: 5432,
      role: 'bap_api',
      user: 'bap_api',
    });
    expect(configuration.password).toBe('test-only-value');
  });

  it('does not include a password-file value in validation errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-db-'));
    const file = join(directory, 'api-password');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    await expect(
      loadDatabaseConfiguration(
        {
          BAP_DATABASE_HOST: 'database',
          BAP_DATABASE_NAME: 'bap',
          BAP_DATABASE_PASSWORD_FILE: file,
          BAP_DATABASE_PORT: 'invalid',
          BAP_DATABASE_USER: 'bap_api',
        },
        { role: 'bap_api' },
      ),
    ).rejects.not.toThrow('test-only-value');
  });

  it.each(['0', '65536'])('rejects out-of-range port %s', async (port) => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-db-'));
    const file = join(directory, 'api-password');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });

    await expect(
      loadDatabaseConfiguration(
        {
          BAP_DATABASE_HOST: 'database',
          BAP_DATABASE_NAME: 'bap',
          BAP_DATABASE_PASSWORD_FILE: file,
          BAP_DATABASE_PORT: port,
          BAP_DATABASE_USER: 'bap_api',
        },
        { role: 'bap_api' },
      ),
    ).rejects.toThrow();
  });

  it('rejects a writable password file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-db-'));
    const file = join(directory, 'api-password');
    await writeFile(file, 'test-only-value\n', { mode: 0o600 });
    await chmod(file, 0o644);

    await expect(
      loadDatabaseConfiguration(
        {
          BAP_DATABASE_HOST: 'database',
          BAP_DATABASE_NAME: 'bap',
          BAP_DATABASE_PASSWORD_FILE: file,
          BAP_DATABASE_USER: 'bap_api',
        },
        { role: 'bap_api' },
      ),
    ).rejects.toThrow('protected regular file');
  });
});
