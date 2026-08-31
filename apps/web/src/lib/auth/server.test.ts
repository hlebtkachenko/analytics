import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('../mail/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mail/index.ts')>()),
  sendMail: sendMailMock,
}));

import type { MailConfiguration } from '../mail/index.js';
import { disabledAuthPaths, resourceJwtConfiguration } from './contract.js';
import {
  authRateLimitRules,
  createInvitationSender,
  createPasswordResetSender,
  createVerificationSender,
  loadAuthEnvironment,
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
  it('keeps browser token retrieval, public signup, and email changes disabled', () => {
    expect([...disabledAuthPaths].sort()).toEqual(
      ['/change-email', '/sign-up/email', '/token'].sort(),
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
        '/sign-in/email',
        '/two-factor/disable',
        '/two-factor/enable',
        '/two-factor/generate-backup-codes',
        '/two-factor/get-totp-uri',
        '/two-factor/send-otp',
        '/two-factor/verify-backup-code',
        '/two-factor/verify-otp',
        '/two-factor/verify-totp',
      ].sort(),
    );
    for (const rule of Object.values(authRateLimitRules)) {
      expect(rule.window).toBe(60);
      expect(rule.max).toBeLessThanOrEqual(5);
    }
  });

  it('keeps configured paths at three per minute except invitations', () => {
    for (const path of [
      '/request-password-reset',
      '/sign-in/email',
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
    expect(authRateLimitRules['/organization/invite-member']).toEqual({
      max: 5,
      window: 60,
    });
  });
});
