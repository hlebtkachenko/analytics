import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { admin, organization } from 'better-auth/plugins';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('../mail/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mail/index.ts')>()),
  sendMail: sendMailMock,
}));

import type { MailConfiguration } from '../mail/index.js';
import { disabledAuthPaths, resourceJwtConfiguration } from './contract.js';
import {
  accountDeletionSoleOwnerErrorCode,
  accountDeletionUnavailableErrorCode,
  accountSessionFreshAgeSeconds,
  adminPluginOptions,
  authLoggerConfiguration,
  authRateLimitRules,
  beforeCreateOrganization,
  createAccountDeletionBeforeHook,
  createAuthBeforeHook,
  createPublicSignUpBeforeHook,
  createInvitationSender,
  createPasswordResetSender,
  createVerificationSender,
  customSyntheticUser,
  invalidOrganizationSlugErrorCode,
  loadAuthEnvironment,
  organizationCreationConfiguration,
  organizationIdRequiredErrorCode,
  organizationIdRequiredPaths,
  organizationLimitReached,
  publicSignUpAllowed,
  publicSignUpErrorCode,
  readAuthSecret,
  unsupportedActiveOrganizationEndpointErrorCode,
  unsupportedActiveOrganizationPath,
} from './server.js';
import { organizationAuthSchema } from './models.js';

const mailConfiguration: MailConfiguration = {
  apiKey: undefined,
  sender: 'team@bap.invalid',
  transport: 'log',
};

function createDeferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

async function createControlledAdminFixture() {
  const createdAt = new Date('2026-08-31T12:00:00.000Z');
  const targetUser = {
    banExpires: null,
    banned: false,
    banReason: null,
    createdAt,
    email: 'target@bap.invalid',
    emailVerified: true,
    id: 'controlled-target',
    image: null,
    name: 'Controlled Target',
    role: 'user',
    updatedAt: createdAt,
  };
  const database = {
    account: [],
    session: [],
    user: [] as Array<Record<string, unknown>>,
    verification: [],
  } satisfies MemoryDB;
  const erasureRequests: string[] = [];
  const auth = betterAuth({
    baseURL: 'https://bap.invalid',
    database: memoryAdapter(database),
    disabledPaths: [...disabledAuthPaths],
    emailAndPassword: { enabled: true },
    plugins: [admin()],
    secret: 'test-only-secret-that-is-long-enough',
    user: {
      deleteUser: {
        beforeDelete: async (user) => {
          erasureRequests.push(user.id);
        },
        enabled: true,
      },
    },
  });
  const signUpResponse = await auth.handler(
    new Request('https://bap.invalid/api/auth/sign-up/email', {
      body: JSON.stringify({
        email: 'admin@bap.invalid',
        name: 'Controlled Admin',
        password: 'test-only-admin-password',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );
  const seededAdmin = database.user[0];
  if (!seededAdmin) {
    throw new Error('Better Auth did not seed the controlled admin.');
  }
  seededAdmin.role = 'admin';
  database.user.push(targetUser);
  const sessionCookie = signUpResponse.headers
    .get('set-cookie')
    ?.split(';', 1)[0];

  expect(signUpResponse.status).toBe(200);
  expect(sessionCookie).toBeTruthy();

  return {
    auth,
    database,
    erasureRequests,
    seededAdmin,
    sessionCookie: sessionCookie ?? '',
    targetUser,
  };
}

async function expectControlledAdminIsAuthorized({
  auth,
  sessionCookie,
  targetUserId,
}: {
  auth: Awaited<ReturnType<typeof createControlledAdminFixture>>['auth'];
  sessionCookie: string;
  targetUserId: string;
}) {
  const response = await auth.handler(
    new Request(
      `https://bap.invalid/api/auth/admin/get-user?id=${targetUserId}`,
      {
        headers: {
          cookie: sessionCookie,
          origin: 'https://bap.invalid',
        },
      },
    ),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ id: targetUserId });
}

async function createControlledOrganizationFixture(limitReached = false) {
  const database = {
    account: [],
    invitation: [],
    member: [] as Array<Record<string, unknown>>,
    organization: [] as Array<Record<string, unknown>>,
    session: [] as Array<Record<string, unknown>>,
    user: [] as Array<Record<string, unknown>>,
    verification: [],
  } satisfies MemoryDB;
  const query = vi.fn(async (statement: string) => {
    if (statement.includes('from auth.invitation')) {
      return { rows: [{ invited: true }] };
    }
    if (statement.includes('from auth.organization_quota')) {
      return { rows: [{ limit_reached: limitReached }] };
    }
    throw new Error('Unexpected organization fixture query.');
  });
  const pool = { query } as unknown as DatabasePool;
  const auth = betterAuth({
    baseURL: 'https://bap.invalid',
    database: memoryAdapter(database),
    disabledPaths: [...disabledAuthPaths],
    emailAndPassword: { enabled: true },
    hooks: { before: createAuthBeforeHook(pool) },
    plugins: [
      organization({
        ...organizationCreationConfiguration,
        organizationHooks: { beforeCreateOrganization },
        organizationLimit: (user) => organizationLimitReached(pool, user),
        schema: organizationAuthSchema,
      }),
    ],
    secret: 'test-only-secret-that-is-long-enough',
  });
  const signUpResponse = await auth.handler(
    new Request('https://bap.invalid/api/auth/sign-up/email', {
      body: JSON.stringify({
        email: 'creator@example.test',
        name: 'Controlled Creator',
        password: 'test-only-creator-password',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );
  const sessionCookie = signUpResponse.headers
    .get('set-cookie')
    ?.split(';', 1)[0];
  const user = database.user[0];
  expect(signUpResponse.status).toBe(200);
  expect(sessionCookie).toBeTruthy();
  expect(user).toBeTruthy();
  query.mockClear();

  return {
    auth,
    database,
    query,
    sessionCookie: sessionCookie ?? '',
    user: user ?? {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Better Auth resource contract', () => {
  it('keeps unsafe or BAP-owned identity paths disabled', () => {
    expect([...disabledAuthPaths].sort()).toEqual(
      [
        '/admin/impersonate-user',
        '/admin/remove-user',
        '/admin/stop-impersonating',
        '/change-email',
        '/delete-user/callback',
        '/organization/delete',
        '/organization/get-active-member',
        '/organization/set-active',
        '/token',
      ].sort(),
    );
  });

  it('does not configure an id-based administrator bypass', () => {
    expect(Object.keys(adminPluginOptions)).toEqual(['schema']);
    expect('adminUserIds' in adminPluginOptions).toBe(false);
  });

  it('refuses admin removal in the configured HTTP dispatcher without deleting or requesting erasure', async () => {
    const {
      auth,
      database,
      erasureRequests,
      seededAdmin,
      sessionCookie,
      targetUser,
    } = await createControlledAdminFixture();

    await expectControlledAdminIsAuthorized({
      auth,
      sessionCookie,
      targetUserId: targetUser.id,
    });

    const response = await auth.handler(
      new Request('https://bap.invalid/api/auth/admin/remove-user', {
        body: JSON.stringify({ userId: targetUser.id }),
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://bap.invalid',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    expect(database.user).toEqual([seededAdmin, targetUser]);
    expect(erasureRequests).toEqual([]);
  });

  it('refuses both impersonation routes and their normalized variants without minting a session', async () => {
    const {
      auth,
      database,
      erasureRequests,
      seededAdmin,
      sessionCookie,
      targetUser,
    } = await createControlledAdminFixture();
    const initialSessionCount = database.session.length;

    await expectControlledAdminIsAuthorized({
      auth,
      sessionCookie,
      targetUserId: targetUser.id,
    });

    for (const path of [
      '/admin/impersonate-user',
      '/admin/impersonate-user///',
      '/admin/stop-impersonating',
      '/admin/stop-impersonating///',
    ]) {
      const response = await auth.handler(
        new Request(`https://bap.invalid/api/auth${path}`, {
          body: JSON.stringify({ userId: targetUser.id }),
          headers: {
            'content-type': 'application/json',
            cookie: sessionCookie,
            origin: 'https://bap.invalid',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(database.session).toHaveLength(initialSessionCount);
      expect(database.user).toEqual([seededAdmin, targetUser]);
      expect(erasureRequests).toEqual([]);
    }
  });

  it('keeps create-user server-only bypass available without exposing it over HTTP', async () => {
    const database = {
      account: [],
      session: [],
      user: [] as Array<Record<string, unknown>>,
      verification: [],
    } satisfies MemoryDB;
    const auth = betterAuth({
      baseURL: 'https://bap.invalid',
      database: memoryAdapter(database),
      disabledPaths: [...disabledAuthPaths],
      emailAndPassword: { enabled: true },
      plugins: [admin()],
      secret: 'test-only-secret-that-is-long-enough',
    });
    const body = {
      email: 'server-created@bap.invalid',
      name: 'Server Created',
      password: 'test-only-server-password',
    };

    const httpResponse = await auth.handler(
      new Request('https://bap.invalid/api/auth/admin/create-user', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(httpResponse.status).toBe(401);
    expect(database.user).toEqual([]);

    const created = await auth.api.createUser({ body });

    expect(created.user.email).toBe(body.email);
    expect(database.user).toHaveLength(1);
  });

  it('uses a five-minute fresh-session window for sensitive account actions', () => {
    expect(accountSessionFreshAgeSeconds).toBe(300);
  });

  it('uses the fixed internal audience and five-minute expiry', () => {
    expect(resourceJwtConfiguration).toEqual({
      audience: 'bap-internal-services',
      lifetime: '5m',
    });
  });

  it('requires HTTPS for the production auth origin', () => {
    expect(() =>
      loadAuthEnvironment({
        BAP_PUBLIC_ORIGIN: 'http://bap.invalid',
        BETTER_AUTH_SECRET_FILE: '/run/credentials/better-auth-secret',
        NODE_ENV: 'production',
      }),
    ).toThrow('must use HTTPS');
    expect(
      loadAuthEnvironment({
        BAP_PUBLIC_ORIGIN: 'https://bap.invalid',
        BETTER_AUTH_SECRET_FILE: '/run/credentials/better-auth-secret',
        NODE_ENV: 'production',
      }).BAP_PUBLIC_ORIGIN,
    ).toBe('https://bap.invalid');
    expect(
      loadAuthEnvironment({
        BAP_PUBLIC_ORIGIN: 'http://localhost:3000',
        BETTER_AUTH_SECRET_FILE: '/run/credentials/better-auth-secret',
        NODE_ENV: 'production',
      }).BAP_PUBLIC_ORIGIN,
    ).toBe('http://localhost:3000');
  });

  it('rejects a non-HTTP auth origin', () => {
    expect(() =>
      loadAuthEnvironment({
        BAP_PUBLIC_ORIGIN: 'ftp://bap.invalid',
        BETTER_AUTH_SECRET_FILE: '/run/credentials/better-auth-secret',
        NODE_ENV: 'test',
      }),
    ).toThrow();
  });

  it('reads only a protected, sufficiently long auth secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-auth-'));
    const file = join(directory, 'secret');
    await writeFile(file, `${'x'.repeat(32)}\n`, { mode: 0o600 });

    await expect(readAuthSecret(file)).resolves.toBe('x'.repeat(32));
    await chmod(file, 0o644);
    await expect(readAuthSecret(file)).rejects.toThrow(
      'protected regular file',
    );
  });
});

describe('account deletion policy', () => {
  function poolWithQuery(query: ReturnType<typeof vi.fn>): DatabasePool {
    return { query } as unknown as DatabasePool;
  }

  it('allows a composed-role co-owner and records the explicit id', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [{ request_user_erasure: null }] });

    await expect(
      createAccountDeletionBeforeHook(poolWithQuery(query))({ id: 'user-1' }),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain(
      "'owner' = any(string_to_array(subject_membership.role, ','))",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "'owner' = any(string_to_array(other_owner.role, ','))",
    );
    expect(query.mock.calls[0]?.[1]).toEqual(['user-1']);
    expect(query.mock.calls[1]).toEqual([
      'select auth.request_user_erasure($1)',
      ['user-1'],
    ]);
  });

  it('refuses a composed-role sole owner without recording an erasure request', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ total: 1 }] });

    await expect(
      createAccountDeletionBeforeHook(poolWithQuery(query))({ id: 'user-1' }),
    ).rejects.toMatchObject({
      body: { code: accountDeletionSoleOwnerErrorCode },
    });

    expect(query).toHaveBeenCalledOnce();
  });

  it('fails closed with one generic error when the database is unavailable', async () => {
    const sensitiveDetail = 'private-database-detail';
    const query = vi.fn().mockRejectedValue(new Error(sensitiveDetail));

    await expect(
      createAccountDeletionBeforeHook(poolWithQuery(query))({ id: 'user-1' }),
    ).rejects.toMatchObject({
      body: {
        code: accountDeletionUnavailableErrorCode,
        message: 'Account deletion is unavailable.',
      },
    });
  });
});

describe('public sign-up policy', () => {
  function poolWithQuery(query: ReturnType<typeof vi.fn>): DatabasePool {
    return { query } as unknown as DatabasePool;
  }

  it('denies sign-up when the switch is off and allows it when on', async () => {
    const disabledQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ invited: false }] })
      .mockResolvedValueOnce({ rows: [{ enabled: false }] });
    const enabledQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ invited: false }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] });

    await expect(
      publicSignUpAllowed(poolWithQuery(disabledQuery), {
        email: 'member@bap.invalid',
      }),
    ).resolves.toBe(false);
    await expect(
      publicSignUpAllowed(poolWithQuery(enabledQuery), {
        email: 'member@bap.invalid',
      }),
    ).resolves.toBe(true);
  });

  it('allows a pending unexpired invitation before reading the switch', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ invited: true }] });

    await expect(
      publicSignUpAllowed(poolWithQuery(query), {
        email: 'Invited@bap.invalid',
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('lower(email) = lower($1)');
    expect(query.mock.calls[0]?.[0]).not.toContain('Invited@bap.invalid');
    expect(query.mock.calls[0]?.[1]).toEqual(['Invited@bap.invalid']);
  });

  it('fails closed on invalid input or any database read error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('Database unavailable'));

    await expect(
      publicSignUpAllowed(poolWithQuery(query), {
        email: 'member@bap.invalid',
      }),
    ).resolves.toBe(false);
    await expect(
      publicSignUpAllowed(poolWithQuery(query), { email: 'invalid' }),
    ).resolves.toBe(false);
  });

  it('enforces the policy only on the exact Better Auth sign-up path', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ invited: false }] })
      .mockResolvedValueOnce({ rows: [{ enabled: false }] });
    const hook = createPublicSignUpBeforeHook(poolWithQuery(query));

    await expect(
      hook({ path: '/sign-in/email', body: { email: 'member@bap.invalid' } }),
    ).resolves.toBeUndefined();
    await expect(
      hook({ path: '/sign-up/email', body: { email: 'member@bap.invalid' } }),
    ).rejects.toMatchObject({ body: { code: publicSignUpErrorCode } });
  });

  it('denies a direct Better Auth API dispatch when the edge route is bypassed', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ invited: false }] })
      .mockResolvedValueOnce({ rows: [{ enabled: false }] });
    const auth = betterAuth({
      baseURL: 'https://bap.invalid',
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 14,
      },
      hooks: {
        before: createPublicSignUpBeforeHook(poolWithQuery(query)),
      },
      secret: 'test-only-secret-that-is-long-enough',
    });

    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'member@bap.invalid',
          name: 'Member',
          password: 'test-only-password',
        },
      }),
    ).rejects.toMatchObject({ body: { code: publicSignUpErrorCode } });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('builds a complete synthetic user for duplicate sign-up responses', () => {
    const createdAt = new Date('2026-08-31T10:00:00.000Z');
    const updatedAt = new Date('2026-08-31T10:01:00.000Z');

    expect(
      customSyntheticUser({
        additionalFields: { locale: 'en' },
        coreFields: {
          createdAt,
          email: 'member@bap.invalid',
          emailVerified: false,
          image: null,
          name: 'Member',
          updatedAt,
        },
        id: 'synthetic-user',
      }),
    ).toEqual({
      banExpires: null,
      banned: false,
      banReason: null,
      createdAt,
      email: 'member@bap.invalid',
      emailVerified: false,
      id: 'synthetic-user',
      image: null,
      locale: 'en',
      name: 'Member',
      role: 'user',
      twoFactorEnabled: false,
      updatedAt,
    });
  });

  it('suppresses Better Auth duplicate-address info logs', () => {
    expect(authLoggerConfiguration).toEqual({ level: 'warn' });
  });
});

describe('organization creation policy', () => {
  function poolWithQuery(query: ReturnType<typeof vi.fn>): DatabasePool {
    return { query } as unknown as DatabasePool;
  }

  it('pins creation, ownership, membership, and deletion semantics', () => {
    expect(organizationCreationConfiguration).toEqual({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
      disableOrganizationDeletion: true,
      membershipLimit: 100,
    });
  });

  it('normalizes a create slug before Better Auth side effects', async () => {
    const query = vi.fn();
    const hook = createAuthBeforeHook(poolWithQuery(query));
    const body = {
      createdBy: 'forged-user',
      name: 'Example',
      slug: ' Example  Org ',
    };

    await expect(
      hook({ body, path: '/organization/create' }),
    ).resolves.toBeUndefined();
    expect(body).toEqual({
      createdBy: 'forged-user',
      name: 'Example',
      slug: 'example-org',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['API', '12345', '--'])(
    'rejects invalid create slug %s before any database query',
    async (slug) => {
      const query = vi.fn();
      const hook = createAuthBeforeHook(poolWithQuery(query));

      await expect(
        hook({ body: { name: 'Example', slug }, path: '/organization/create' }),
      ).rejects.toMatchObject({
        body: { code: invalidOrganizationSlugErrorCode },
      });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('injects the authenticated creator and overwrites forged hook data', async () => {
    await expect(
      beforeCreateOrganization({
        organization: {
          createdBy: 'forged-user',
          name: 'Example',
          slug: 'example-org',
        },
        user: { id: 'authenticated-user' },
      }),
    ).resolves.toEqual({
      data: {
        createdBy: 'authenticated-user',
        name: 'Example',
        slug: 'example-org',
      },
    });

    await expect(
      beforeCreateOrganization({
        organization: { name: 'Example', slug: 'API' },
        user: { id: 'authenticated-user' },
      }),
    ).rejects.toMatchObject({
      body: { code: invalidOrganizationSlugErrorCode },
    });
  });

  it.each([
    { queryResult: { rows: [{ limit_reached: false }] }, expected: false },
    { queryResult: { rows: [{ limit_reached: true }] }, expected: true },
    { queryResult: { rows: [] }, expected: true },
  ])(
    'maps the database decision to Better Auth limit polarity',
    async ({ expected, queryResult }) => {
      const query = vi.fn(async () => queryResult);

      await expect(
        organizationLimitReached(poolWithQuery(query), { id: 'user-1' }),
      ).resolves.toBe(expected);
    },
  );

  it('fails the organization limit closed on a database error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private detail'));

    await expect(
      organizationLimitReached(poolWithQuery(query), { id: 'user-1' }),
    ).resolves.toBe(true);
  });

  it('guards the exact installed bindable active-organization fallback inventory', async () => {
    expect(organizationIdRequiredPaths).toEqual({
      '/organization/get-active-member-role': 'query',
      '/organization/get-full-organization': 'query',
      '/organization/get-organization': 'query',
      '/organization/has-permission': 'body',
      '/organization/invite-member': 'body',
      '/organization/list-invitations': 'query',
      '/organization/list-members': 'query',
      '/organization/remove-member': 'body',
      '/organization/update': 'body',
      '/organization/update-member-role': 'body',
    });
    const hook = createAuthBeforeHook(poolWithQuery(vi.fn()));

    for (const [path, location] of Object.entries(
      organizationIdRequiredPaths,
    )) {
      await expect(hook({ path })).rejects.toMatchObject({
        body: { code: organizationIdRequiredErrorCode },
      });
      await expect(
        hook({ [location]: { organizationId: 'organization-1' }, path }),
      ).resolves.toBeUndefined();
    }

    for (const path of [
      '/organization/create',
      '/organization/check-slug',
      '/organization/list',
      '/organization/list-user-invitations',
      '/organization/get-invitation',
      '/organization/accept-invitation',
      '/organization/reject-invitation',
      '/organization/cancel-invitation',
    ]) {
      if (path !== '/organization/create') {
        await expect(hook({ path })).resolves.toBeUndefined();
      }
    }

    for (const input of [
      { path: unsupportedActiveOrganizationPath },
      {
        path: unsupportedActiveOrganizationPath,
        query: { organizationId: 'organization-1' },
      },
      {
        body: { organizationId: 'organization-1' },
        path: unsupportedActiveOrganizationPath,
      },
    ]) {
      await expect(hook(input)).rejects.toMatchObject({
        body: { code: unsupportedActiveOrganizationEndpointErrorCode },
      });
    }
  });

  it('creates with one normalized slug and one authoritative owner', async () => {
    const { auth, database, sessionCookie, user } =
      await createControlledOrganizationFixture();
    const response = await auth.handler(
      new Request('https://bap.invalid/api/auth/organization/create', {
        body: JSON.stringify({
          createdBy: 'forged-user',
          created_by: 'forged-snake-user',
          name: 'Example Organization',
          slug: ' Example Organization ',
        }),
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://bap.invalid',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({
      createdBy: user.id,
      slug: 'example-organization',
    });
    const created = database.organization[0];
    expect(created).toMatchObject({
      created_by: user.id,
      name: 'Example Organization',
      slug: 'example-organization',
    });
    expect(created?.created_by).not.toBe('forged-user');
    expect(database.member).toHaveLength(1);
    expect(database.member[0]).toMatchObject({
      organization_id: created?.id,
      role: 'owner',
      user_id: user.id,
    });
  });

  it('normalizes the trusted server-side create path before writing', async () => {
    const { auth, database, user } =
      await createControlledOrganizationFixture();

    await expect(
      auth.api.createOrganization({
        body: {
          name: 'System Organization',
          slug: ' System Organization ',
          userId: String(user.id),
        },
      }),
    ).resolves.toMatchObject({
      createdBy: user.id,
      slug: 'system-organization',
    });
    expect(database.organization[0]).toMatchObject({
      created_by: user.id,
      slug: 'system-organization',
    });
  });

  it('returns 403 before writes when quota is exhausted', async () => {
    const { auth, database, sessionCookie } =
      await createControlledOrganizationFixture(true);
    const response = await auth.handler(
      new Request('https://bap.invalid/api/auth/organization/create', {
        body: JSON.stringify({ name: 'Example', slug: 'example-org' }),
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: 'https://bap.invalid',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(database.organization).toEqual([]);
    expect(database.member).toEqual([]);
  });

  it.each(['API', '12345', '--'])(
    'rejects configured create slug %s without quota or identity writes',
    async (slug) => {
      const { auth, database, query, sessionCookie } =
        await createControlledOrganizationFixture();
      const response = await auth.handler(
        new Request('https://bap.invalid/api/auth/organization/create', {
          body: JSON.stringify({ name: 'Example', slug }),
          headers: {
            'content-type': 'application/json',
            cookie: sessionCookie,
            origin: 'https://bap.invalid',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(400);
      expect(database.organization).toEqual([]);
      expect(database.member).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('rejects configured active-organization fallback without an explicit id', async () => {
    const { auth, sessionCookie } = await createControlledOrganizationFixture();
    const response = await auth.handler(
      new Request('https://bap.invalid/api/auth/organization/list-members', {
        headers: {
          cookie: sessionCookie,
          origin: 'https://bap.invalid',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: organizationIdRequiredErrorCode,
    });
  });

  it('disables the configured HTTP active-member endpoint without mutating session or membership state', async () => {
    const { auth, database, sessionCookie, user } =
      await createControlledOrganizationFixture();
    const organization = await auth.api.createOrganization({
      body: {
        name: 'Retained Organization',
        slug: 'retained-organization',
        userId: String(user.id),
      },
    });
    const originalSessions = structuredClone(database.session);
    const originalMembers = structuredClone(database.member);

    const response = await auth.handler(
      new Request(
        `https://bap.invalid/api/auth/organization/get-active-member?organizationId=${organization.id}`,
        {
          headers: {
            cookie: sessionCookie,
            origin: 'https://bap.invalid',
          },
        },
      ),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(database.session).toEqual(originalSessions);
    expect(database.member).toEqual(originalMembers);
  });

  it('rejects direct active-member API calls regardless of dummy input', async () => {
    const { auth, database, sessionCookie } =
      await createControlledOrganizationFixture();
    const headers = new Headers({ cookie: sessionCookie });
    const originalSessions = structuredClone(database.session);
    const originalMembers = structuredClone(database.member);

    for (const input of [
      { headers },
      { headers, query: { organizationId: 'organization-1' } },
      { body: { organizationId: 'organization-1' }, headers },
      {
        body: { organizationId: 'organization-1' },
        headers,
        query: { organizationId: 'organization-1' },
      },
    ]) {
      await expect(
        auth.api.getActiveMember(input as never),
      ).rejects.toMatchObject({
        body: { code: unsupportedActiveOrganizationEndpointErrorCode },
      });
    }

    expect(database.session).toEqual(originalSessions);
    expect(database.member).toEqual(originalMembers);
  });

  it('uses an explicit organization for the supported active-member-role endpoint', async () => {
    const { auth, database, sessionCookie, user } =
      await createControlledOrganizationFixture();
    const explicitOrganization = await auth.api.createOrganization({
      body: {
        name: 'Explicit Organization',
        slug: 'explicit-organization',
        userId: String(user.id),
      },
    });
    const ambientOrganization = await auth.api.createOrganization({
      body: {
        name: 'Ambient Organization',
        slug: 'ambient-organization',
        userId: String(user.id),
      },
    });
    const explicitMember = database.member.find(
      (member) => member.organization_id === explicitOrganization.id,
    );
    const session = database.session[0];
    if (!explicitMember || !session) {
      throw new Error('Controlled organization fixture is incomplete.');
    }
    explicitMember.role = 'admin';
    session.active_organization_id = ambientOrganization.id;

    const response = await auth.handler(
      new Request(
        `https://bap.invalid/api/auth/organization/get-active-member-role?organizationId=${explicitOrganization.id}`,
        {
          headers: {
            cookie: sessionCookie,
            origin: 'https://bap.invalid',
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: 'admin' });
    expect(session.active_organization_id).toBe(ambientOrganization.id);
  });

  it('keeps delete and set-active disabled in the configured dispatcher', async () => {
    const { auth, database, sessionCookie, user } =
      await createControlledOrganizationFixture();
    const organization = await auth.api.createOrganization({
      body: {
        name: 'Retained Organization',
        slug: 'retained-organization',
        userId: String(user.id),
      },
    });
    const originalSessionCount = database.session.length;

    for (const [path, body] of [
      ['/organization/delete', { organizationId: organization.id }],
      ['/organization/set-active', { organizationId: organization.id }],
    ] as const) {
      const response = await auth.handler(
        new Request(`https://bap.invalid/api/auth${path}`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
            cookie: sessionCookie,
            origin: 'https://bap.invalid',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(database.session).toHaveLength(originalSessionCount);
      expect(database.organization).toHaveLength(1);
      expect(database.organization[0]?.id).toBe(organization.id);
    }
  });
});

describe('Better Auth mail hooks', () => {
  const senderCases = [
    {
      create: () =>
        createPasswordResetSender(mailConfiguration)({
          url: 'https://bap.invalid/reset-password/reset-1',
          user: { email: 'member@bap.invalid' },
        }),
      expected: {
        subject: 'Reset your BAP password',
        text: expect.stringContaining(
          'https://bap.invalid/reset-password/reset-1',
        ),
        to: 'member@bap.invalid',
      },
      name: 'password reset',
    },
    {
      create: () =>
        createVerificationSender(mailConfiguration)({
          url: 'https://bap.invalid/verify-email/verify-1',
          user: { email: 'member@bap.invalid' },
        }),
      expected: {
        subject: 'Confirm your BAP email address',
        text: expect.stringContaining(
          'https://bap.invalid/verify-email/verify-1',
        ),
        to: 'member@bap.invalid',
      },
      name: 'verification',
    },
    {
      create: () =>
        createInvitationSender(
          mailConfiguration,
          'https://bap.invalid',
        )({
          email: 'invited@bap.invalid',
          id: 'invitation_1',
          organization: { name: 'Organization 1' },
        }),
      expected: {
        subject: 'You are invited to Organization 1 on BAP',
        text: expect.stringContaining(
          'https://bap.invalid/invitation/invitation_1',
        ),
        to: 'invited@bap.invalid',
      },
      name: 'invitation',
    },
  ];

  it.each(senderCases)(
    '$name resolves before mail delivery settles',
    async ({ create, expected }) => {
      const deferred = createDeferred<unknown>();
      sendMailMock.mockReturnValueOnce(deferred.promise);

      await expect(create()).resolves.toBeUndefined();
      expect(sendMailMock).toHaveBeenCalledOnce();
      expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, expected);

      deferred.resolve(undefined);
      await deferred.promise;
    },
  );

  it.each(senderCases)(
    '$name ignores mail delivery rejection',
    async ({ create, expected }) => {
      const deferred = createDeferred<never>();
      sendMailMock.mockReturnValueOnce(deferred.promise);

      await expect(create()).resolves.toBeUndefined();
      expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, expected);
      deferred.reject(new Error('Mail delivery failed.'));
      await expect(deferred.promise).rejects.toThrow('Mail delivery failed.');
    },
  );
});

describe('Better Auth rate limits', () => {
  it('caps every configured mutation, credential, and two-factor path', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual(
      [
        '/admin/ban-user',
        '/admin/create-user',
        '/admin/revoke-user-session',
        '/admin/revoke-user-sessions',
        '/admin/set-role',
        '/admin/set-user-password',
        '/admin/unban-user',
        '/admin/update-user',
        '/organization/invite-member',
        '/organization/check-slug',
        '/request-password-reset',
        '/reset-password',
        '/reset-password/*',
        '/send-verification-email',
        '/sign-in/email',
        '/sign-up/email',
        '/two-factor/disable',
        '/two-factor/enable',
        '/two-factor/generate-backup-codes',
        '/two-factor/get-totp-uri',
        '/two-factor/send-otp',
        '/two-factor/verify-backup-code',
        '/two-factor/verify-otp',
        '/two-factor/verify-totp',
        '/verify-email',
      ].sort(),
    );
    for (const rule of Object.values(authRateLimitRules)) {
      expect(rule.window).toBe(60);
      expect(rule.max).toBeLessThanOrEqual(10);
    }
  });

  it('pins every reachable mutating admin route at three per minute', () => {
    for (const path of [
      '/admin/ban-user',
      '/admin/create-user',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions',
      '/admin/set-role',
      '/admin/set-user-password',
      '/admin/unban-user',
      '/admin/update-user',
    ] as const) {
      expect(authRateLimitRules[path]).toEqual({ max: 3, window: 60 });
    }

    for (const path of [
      '/admin/impersonate-user',
      '/admin/remove-user',
      '/admin/stop-impersonating',
      '/admin/get-user',
      '/admin/list-users',
      '/admin/list-user-sessions',
      '/admin/has-permission',
    ]) {
      expect(path in authRateLimitRules).toBe(false);
    }
  });

  it('keeps credential submission and mail requests at three per minute', () => {
    for (const path of [
      '/request-password-reset',
      '/send-verification-email',
      '/sign-in/email',
      '/sign-up/email',
      '/two-factor/disable',
      '/two-factor/enable',
      '/two-factor/generate-backup-codes',
      '/two-factor/get-totp-uri',
      '/two-factor/send-otp',
      '/two-factor/verify-backup-code',
      '/two-factor/verify-otp',
      '/two-factor/verify-totp',
    ] as const) {
      expect(authRateLimitRules[path]).toEqual({ max: 3, window: 60 });
    }
  });

  it('keeps invitation, verification, and reset completion at five per minute', () => {
    for (const path of [
      '/organization/invite-member',
      '/reset-password',
      '/reset-password/*',
      '/verify-email',
    ] as const) {
      expect(authRateLimitRules[path]).toEqual({ max: 5, window: 60 });
    }
  });

  it('limits authenticated organization slug checks to ten per minute', () => {
    expect(authRateLimitRules['/organization/check-slug']).toEqual({
      max: 10,
      window: 60,
    });
  });

  it('runs slug checks through the installed ten-per-minute limiter', async () => {
    let attempts = 0;
    const consume = vi.fn(
      async (_key: string, rule: { max: number; window: number }) => {
        attempts += 1;
        return attempts <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: rule.window };
      },
    );
    const auth = betterAuth({
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bap-client-ip'] },
      },
      baseURL: 'https://bap.invalid',
      plugins: [organization()],
      rateLimit: {
        customRules: { ...authRateLimitRules },
        customStorage: { consume },
        enabled: true,
        max: 100,
        window: 60,
      },
      secret: 'test-only-secret-that-is-long-enough',
    });
    const statuses: number[] = [];

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const response = await auth.handler(
        new Request('https://bap.invalid/api/auth/organization/check-slug', {
          body: JSON.stringify({ slug: 'example-org' }),
          headers: {
            'content-type': 'application/json',
            'x-bap-client-ip': '198.51.100.217',
          },
          method: 'POST',
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
    expect(consume).toHaveBeenCalledTimes(11);
    for (const [, rule] of consume.mock.calls) {
      expect(rule).toEqual({ max: 10, window: 60 });
    }
  });

  it('runs reset completion through the installed router limiter', async () => {
    let attempts = 0;
    const consume = vi.fn(
      async (_key: string, rule: { max: number; window: number }) => {
        attempts += 1;
        return attempts <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: rule.window };
      },
    );
    const auth = betterAuth({
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bap-client-ip'] },
      },
      baseURL: 'https://bap.invalid',
      emailAndPassword: {
        enabled: true,
        maxPasswordLength: 128,
        minPasswordLength: 14,
      },
      rateLimit: {
        customRules: { ...authRateLimitRules },
        customStorage: { consume },
        enabled: true,
        max: 100,
        window: 60,
      },
      secret: 'test-only-secret-that-is-long-enough',
    });
    const statuses: number[] = [];
    let finalBody = '';

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await auth.handler(
        new Request('https://bap.invalid/api/auth/reset-password', {
          body: JSON.stringify({
            newPassword: 'replacement-password',
            token: 'ResetSentinelTokenAbc123',
          }),
          headers: {
            'content-type': 'application/json',
            'x-bap-client-ip': '198.51.100.215',
          },
          method: 'POST',
        }),
      );
      statuses.push(response.status);
      if (attempt === 6) {
        finalBody = await response.text();
      }
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    expect(finalBody).not.toContain('ResetSentinelTokenAbc123');
    expect(consume).toHaveBeenCalledTimes(6);
    for (const [, rule] of consume.mock.calls) {
      expect(rule).toEqual({ max: 5, window: 60 });
    }
  });

  it('preserves the installed change-password three-per-ten-second rule', async () => {
    let attempts = 0;
    const consume = vi.fn(
      async (_key: string, rule: { max: number; window: number }) => {
        attempts += 1;
        return attempts <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: rule.window };
      },
    );
    const auth = betterAuth({
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-bap-client-ip'] },
      },
      baseURL: 'https://bap.invalid',
      emailAndPassword: {
        enabled: true,
        maxPasswordLength: 128,
        minPasswordLength: 14,
      },
      rateLimit: {
        customRules: { ...authRateLimitRules },
        customStorage: { consume },
        enabled: true,
        max: 100,
        window: 60,
      },
      secret: 'test-only-secret-that-is-long-enough',
    });
    const statuses: number[] = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await auth.handler(
        new Request('https://bap.invalid/api/auth/change-password', {
          body: JSON.stringify({
            currentPassword: 'test-only-current-password',
            newPassword: 'test-only-replacement-password',
            revokeOtherSessions: true,
          }),
          headers: {
            'content-type': 'application/json',
            'x-bap-client-ip': '198.51.100.216',
          },
          method: 'POST',
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
    expect(consume).toHaveBeenCalledTimes(4);
    for (const [, rule] of consume.mock.calls) {
      expect(rule).toEqual({ max: 3, window: 10 });
    }
  });
});
