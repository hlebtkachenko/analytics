import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';
import { betterAuth } from 'better-auth';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('../mail/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mail/index.ts')>()),
  sendMail: sendMailMock,
}));

import type { MailConfiguration } from '../mail/index.js';
import { disabledAuthPaths, resourceJwtConfiguration } from './contract.js';
import {
  authLoggerConfiguration,
  authRateLimitRules,
  createPublicSignUpBeforeHook,
  createInvitationSender,
  createPasswordResetSender,
  createVerificationSender,
  customSyntheticUser,
  loadAuthEnvironment,
  publicSignUpAllowed,
  publicSignUpErrorCode,
  readAuthSecret,
} from './server.js';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Better Auth resource contract', () => {
  it('keeps browser token retrieval and email changes disabled', () => {
    expect([...disabledAuthPaths].sort()).toEqual(
      ['/change-email', '/token'].sort(),
    );
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
  it('caps every configured credential and two-factor path', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual(
      [
        '/organization/invite-member',
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
      expect(rule.max).toBeLessThanOrEqual(5);
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
});
