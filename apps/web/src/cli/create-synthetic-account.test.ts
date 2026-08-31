import { describe, expect, it, vi } from 'vitest';

import {
  assertSyntheticSetupEnabled,
  createSyntheticAccount,
  formatSyntheticAccountResult,
  parseSyntheticAccountInput,
  readSyntheticAccountInput,
  runSyntheticAccountCli,
} from './create-synthetic-account.js';

const validInput = {
  email: 'synthetic@example.test',
  name: 'Synthetic User',
  organizationName: 'Synthetic Organization',
  organizationSlug: 'synthetic-organizati',
  password: 'test-only-password',
};

async function* input(value: string): AsyncGenerator<string> {
  yield value;
}

describe('create-synthetic-account CLI', () => {
  it('requires the explicit E2E setup gate', () => {
    expect(() => assertSyntheticSetupEnabled({})).toThrow(
      'Synthetic account setup is disabled.',
    );
    expect(() =>
      assertSyntheticSetupEnabled({ BAP_E2E_SETUP: 'true' }),
    ).not.toThrow();
  });

  it('rejects invalid input without reflecting it in errors or output', async () => {
    const secret = 'do-not-reflect-this-password';
    let message = '';
    try {
      parseSyntheticAccountInput(
        JSON.stringify({ ...validInput, password: secret, extra: true }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('Invalid synthetic account input.');
    expect(message).not.toContain(secret);
    await expect(readSyntheticAccountInput(input('{invalid'))).rejects.toThrow(
      'Invalid synthetic account input.',
    );
    expect(
      parseSyntheticAccountInput(
        JSON.stringify({
          ...validInput,
          organizationSlug: '  Synthetic Organization  ',
        }),
      ).organizationSlug,
    ).toBe('synthetic-organizati');
    expect(() =>
      parseSyntheticAccountInput(
        JSON.stringify({ ...validInput, organizationSlug: 'api' }),
      ),
    ).toThrow('Invalid synthetic account input.');
  });

  it('creates a verified user, seeds quota, then creates the organization', async () => {
    const createOrganization = vi.fn(async () => ({ id: 'organization_1' }));
    const createUser = vi.fn(async () => ({ user: { id: 'user_1' } }));
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      createSyntheticAccount(
        validInput,
        {
          api: { createOrganization, createUser },
        },
        seedQuota,
      ),
    ).resolves.toEqual({ organizationId: 'organization_1', userId: 'user_1' });
    expect(createUser).toHaveBeenCalledWith({
      body: {
        data: { emailVerified: true },
        email: validInput.email,
        name: validInput.name,
        password: validInput.password,
      },
    });
    expect(createOrganization).toHaveBeenCalledWith({
      body: {
        name: validInput.organizationName,
        slug: validInput.organizationSlug,
        userId: 'user_1',
      },
    });
    expect(seedQuota).toHaveBeenCalledWith('user_1');
    expect(createUser.mock.invocationCallOrder[0]).toBeLessThan(
      seedQuota.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(seedQuota.mock.invocationCallOrder[0]).toBeLessThan(
      createOrganization.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it('validates a reserved slug before user or quota side effects', async () => {
    const createOrganization = vi.fn(async () => ({ id: 'organization_1' }));
    const createUser = vi.fn(async () => ({ user: { id: 'user_1' } }));
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      createSyntheticAccount(
        { ...validInput, organizationSlug: 'api' },
        { api: { createOrganization, createUser } },
        seedQuota,
      ),
    ).rejects.toThrow();
    expect(createUser).not.toHaveBeenCalled();
    expect(seedQuota).not.toHaveBeenCalled();
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('writes only status and identifiers after successful setup', async () => {
    const write = vi.fn(() => true);
    await runSyntheticAccountCli(
      input(JSON.stringify(validInput)),
      { write },
      { BAP_E2E_SETUP: 'true' },
      async () => ({
        api: {
          createOrganization: async () => ({ id: 'organization_1' }),
          createUser: async () => ({ user: { id: 'user_1' } }),
        },
      }),
      async () => undefined,
    );

    expect(write).toHaveBeenCalledWith(
      formatSyntheticAccountResult({
        organizationId: 'organization_1',
        userId: 'user_1',
      }),
    );
    expect(write).toHaveBeenCalledWith(
      '{"status":"created","organizationId":"organization_1","userId":"user_1"}\n',
    );
  });
});
