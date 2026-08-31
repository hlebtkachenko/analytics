// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { DatabaseConfiguration, DatabasePool } from '@bap/db';

import { seedInitialOrganizationQuotaForCli } from './organization-quota.js';

const configuration: DatabaseConfiguration = {
  database: 'bap',
  host: 'database',
  password: 'test-only-password',
  port: 5432,
  role: 'bap_migrator',
  ssl: false,
  user: 'bap_migrator',
};

describe('one-shot initial organization quota seeder', () => {
  it('uses the separate migrator credential and closes it before returning', async () => {
    const end = vi.fn(async () => undefined);
    const pool = { end } as unknown as DatabasePool;
    const loadConfiguration = vi.fn(async () => configuration);
    const createPool = vi.fn(() => pool);
    const ensureQuota = vi.fn(async () => undefined);

    await expect(
      seedInitialOrganizationQuotaForCli(
        'user-1',
        {
          BAP_DATABASE_HOST: 'database',
          BAP_DATABASE_NAME: 'bap',
          BAP_DATABASE_PASSWORD_FILE: '/run/credentials/auth-password',
          BAP_DATABASE_USER: 'bap_auth',
          BAP_MIGRATOR_PASSWORD_FILE: '/run/credentials/migrator-password',
        },
        { createPool, ensureQuota, loadConfiguration },
      ),
    ).resolves.toBeUndefined();

    expect(loadConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        BAP_DATABASE_PASSWORD_FILE: '/run/credentials/migrator-password',
        BAP_DATABASE_USER: 'bap_migrator',
      }),
      { role: 'bap_migrator' },
    );
    expect(ensureQuota).toHaveBeenCalledWith(pool, 'user-1');
    expect(end).toHaveBeenCalledOnce();
  });

  it('closes the migrator pool after a failed seed', async () => {
    const end = vi.fn(async () => undefined);
    const providerDetail = 'provider-detail-that-must-not-be-emitted';

    await expect(
      seedInitialOrganizationQuotaForCli(
        'user-1',
        { BAP_MIGRATOR_PASSWORD_FILE: '/run/credentials/migrator-password' },
        {
          createPool: () => ({ end }) as unknown as DatabasePool,
          ensureQuota: async () => {
            throw new Error(providerDetail);
          },
          loadConfiguration: async () => configuration,
        },
      ),
    ).rejects.toThrow(providerDetail);
    expect(end).toHaveBeenCalledOnce();
  });

  it('fails before opening a pool when the one-shot credential is absent', async () => {
    const createPool = vi.fn(() => ({}) as DatabasePool);

    await expect(
      seedInitialOrganizationQuotaForCli(
        'user-1',
        {},
        {
          createPool,
          ensureQuota: async () => undefined,
          loadConfiguration: async () => configuration,
        },
      ),
    ).rejects.toThrow('Initial organization setup is unavailable.');
    expect(createPool).not.toHaveBeenCalled();
  });
});
