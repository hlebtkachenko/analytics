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

const validMemberInput = {
  email: 'synthetic-member@example.test',
  name: 'Synthetic Member',
  organizationSlug: 'synthetic-organizati',
  password: 'test-only-password',
  role: 'member',
} as const;

function stubApi() {
  return {
    addMember: vi.fn(async () => ({ id: 'member_1' })),
    createOrganization: vi.fn(async () => ({ id: 'organization_1' })),
    createUser: vi.fn(async () => ({ user: { id: 'user_1' } })),
  };
}

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
    const addMember = vi.fn(async () => ({ id: 'member_1' }));
    const createOrganization = vi.fn(async () => ({ id: 'organization_1' }));
    const createUser = vi.fn(async () => ({ user: { id: 'user_1' } }));
    const findOrganizationId = vi.fn(async () => 'organization_1');
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      createSyntheticAccount(
        validInput,
        { api: { addMember, createOrganization, createUser } },
        seedQuota,
        findOrganizationId,
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
    expect(addMember).not.toHaveBeenCalled();
    expect(findOrganizationId).not.toHaveBeenCalled();
    expect(createUser.mock.invocationCallOrder[0]).toBeLessThan(
      seedQuota.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(seedQuota.mock.invocationCallOrder[0]).toBeLessThan(
      createOrganization.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it('validates a reserved slug before user or quota side effects', async () => {
    const api = stubApi();
    const findOrganizationId = vi.fn(async () => 'organization_1');
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      createSyntheticAccount(
        { ...validInput, organizationSlug: 'api' },
        { api },
        seedQuota,
        findOrganizationId,
      ),
    ).rejects.toThrow();
    expect(api.createUser).not.toHaveBeenCalled();
    expect(seedQuota).not.toHaveBeenCalled();
    expect(api.createOrganization).not.toHaveBeenCalled();
    expect(findOrganizationId).not.toHaveBeenCalled();
  });

  it('joins an existing organization by slug without creating one', async () => {
    const api = stubApi();
    const findOrganizationId = vi.fn(async () => 'organization_1');
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      createSyntheticAccount(
        { ...validMemberInput, role: 'admin' },
        { api },
        seedQuota,
        findOrganizationId,
      ),
    ).resolves.toEqual({ organizationId: 'organization_1', userId: 'user_1' });
    expect(findOrganizationId).toHaveBeenCalledWith('synthetic-organizati');
    expect(api.createUser).toHaveBeenCalledWith({
      body: {
        data: { emailVerified: true },
        email: validMemberInput.email,
        name: validMemberInput.name,
        password: validMemberInput.password,
      },
    });
    expect(api.addMember).toHaveBeenCalledWith({
      body: {
        organizationId: 'organization_1',
        role: 'admin',
        userId: 'user_1',
      },
    });
    expect(api.createOrganization).not.toHaveBeenCalled();
    expect(seedQuota).not.toHaveBeenCalled();
    expect(findOrganizationId.mock.invocationCallOrder[0]).toBeLessThan(
      api.createUser.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('refuses an unknown organization slug before creating the member', async () => {
    const api = stubApi();
    const findOrganizationId = vi.fn(async () => null);

    await expect(
      createSyntheticAccount(
        validMemberInput,
        { api },
        async () => undefined,
        findOrganizationId,
      ),
    ).rejects.toThrow('Invalid synthetic account input.');
    expect(api.createUser).not.toHaveBeenCalled();
    expect(api.addMember).not.toHaveBeenCalled();
  });

  it('rejects a member input that also names an organization or an unknown role', () => {
    expect(() =>
      parseSyntheticAccountInput(
        JSON.stringify({
          ...validMemberInput,
          organizationName: 'Synthetic Organization',
        }),
      ),
    ).toThrow('Invalid synthetic account input.');
    expect(() =>
      parseSyntheticAccountInput(
        JSON.stringify({ ...validMemberInput, role: 'owner' }),
      ),
    ).toThrow('Invalid synthetic account input.');
    expect(
      parseSyntheticAccountInput(JSON.stringify(validMemberInput)),
    ).toEqual(validMemberInput);
  });

  it('writes only status and identifiers after successful setup', async () => {
    const write = vi.fn(() => true);
    await runSyntheticAccountCli(
      input(JSON.stringify(validInput)),
      { write },
      { BAP_E2E_SETUP: 'true' },
      async () => ({
        api: {
          addMember: async () => ({ id: 'member_1' }),
          createOrganization: async () => ({ id: 'organization_1' }),
          createUser: async () => ({ user: { id: 'user_1' } }),
        },
      }),
      async () => undefined,
      async () => 'organization_1',
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
