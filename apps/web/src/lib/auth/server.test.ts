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
import type { AuthUserLookup } from './server.js';
import {
  authRateLimitRules,
  createInvitationSender,
  createMagicLinkOptions,
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

function lookupReturning(rows: { two_factor_enabled: boolean }[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query } satisfies AuthUserLookup;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Better Auth resource contract', () => {
  it('keeps only browser token retrieval and public signup disabled', () => {
    expect([...disabledAuthPaths].sort()).toEqual(
      ['/sign-up/email', '/token'].sort(),
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

describe('Better Auth magic link', () => {
  it('never signs a new user up', () => {
    expect(
      createMagicLinkOptions(mailConfiguration, lookupReturning([]))
        .disableSignUp,
    ).toBe(true);
  });

  it('sends the link through the mail module', async () => {
    sendMailMock.mockResolvedValueOnce({ ok: true, transport: 'log' });
    const pool = lookupReturning([{ two_factor_enabled: false }]);

    await createMagicLinkOptions(mailConfiguration, pool).sendMagicLink({
      email: 'Member@BAP.invalid',
      token: 'token-1',
      url: 'https://bap.invalid/access?token=token-1',
    });

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      'member@bap.invalid',
    ]);
    expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, {
      subject: 'Your BAP sign-in link',
      text: expect.stringContaining('https://bap.invalid/access?token=token-1'),
      to: 'Member@BAP.invalid',
    });
  });

  it('sends nothing for an unknown address and stays non-enumerable', async () => {
    const pool = lookupReturning([]);

    await expect(
      createMagicLinkOptions(mailConfiguration, pool).sendMagicLink({
        email: 'stranger@bap.invalid',
        token: 'token-2',
        url: 'https://bap.invalid/access?token=token-2',
      }),
    ).resolves.toBeUndefined();

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends nothing to a user who enabled a second factor', async () => {
    const pool = lookupReturning([{ two_factor_enabled: true }]);

    await expect(
      createMagicLinkOptions(mailConfiguration, pool).sendMagicLink({
        email: 'protected@bap.invalid',
        token: 'token-3',
        url: 'https://bap.invalid/access?token=token-3',
      }),
    ).resolves.toBeUndefined();

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('takes the same floor whether or not it sends', async () => {
    sendMailMock.mockImplementation(
      async () =>
        await new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, transport: 'log' }), 2_000),
        ),
    );
    const known = createMagicLinkOptions(
      mailConfiguration,
      lookupReturning([{ two_factor_enabled: false }]),
    );
    const unknown = createMagicLinkOptions(
      mailConfiguration,
      lookupReturning([]),
    );

    const startedKnown = Date.now();
    await known.sendMagicLink({
      email: 'member@bap.invalid',
      token: 'token-5',
      url: 'https://bap.invalid/access?token=token-5',
    });
    const knownElapsed = Date.now() - startedKnown;
    const startedUnknown = Date.now();
    await unknown.sendMagicLink({
      email: 'stranger@bap.invalid',
      token: 'token-6',
      url: 'https://bap.invalid/access?token=token-6',
    });
    const unknownElapsed = Date.now() - startedUnknown;

    // Both branches wait the floor, and the known branch never waits for the slow provider.
    expect(knownElapsed).toBeGreaterThanOrEqual(400);
    expect(unknownElapsed).toBeGreaterThanOrEqual(400);
    expect(knownElapsed).toBeLessThan(1_500);
    sendMailMock.mockReset();
  }, 20_000);

  it('parameterizes the address instead of interpolating it', async () => {
    const pool = lookupReturning([]);

    await createMagicLinkOptions(mailConfiguration, pool).sendMagicLink({
      email: "injected@bap.invalid' OR '1'='1",
      token: 'token-4',
      url: 'https://bap.invalid/access?token=token-4',
    });

    const [text, values] = pool.query.mock.calls[0] as [string, string[]];
    expect(text).toContain('$1');
    expect(text).not.toContain('injected');
    expect(values).toEqual(["injected@bap.invalid' or '1'='1"]);
  });
});

describe('Better Auth mail hooks', () => {
  it('sends the password reset through the mail module', async () => {
    sendMailMock.mockResolvedValueOnce({ ok: true, transport: 'log' });

    await createPasswordResetSender(mailConfiguration)({
      url: 'https://bap.invalid/reset-password/reset-1',
      user: { email: 'member@bap.invalid' },
    });

    expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, {
      subject: 'Reset your BAP password',
      text: expect.stringContaining(
        'https://bap.invalid/reset-password/reset-1',
      ),
      to: 'member@bap.invalid',
    });
  });

  it('sends the verification mail through the mail module', async () => {
    sendMailMock.mockResolvedValueOnce({ ok: true, transport: 'log' });

    await createVerificationSender(mailConfiguration)({
      url: 'https://bap.invalid/verify-email/verify-1',
      user: { email: 'member@bap.invalid' },
    });

    expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, {
      subject: 'Confirm your BAP email address',
      text: expect.stringContaining(
        'https://bap.invalid/verify-email/verify-1',
      ),
      to: 'member@bap.invalid',
    });
  });

  it('sends the invitation to the public acceptance route', async () => {
    sendMailMock.mockResolvedValueOnce({ ok: true, transport: 'log' });

    await createInvitationSender(
      mailConfiguration,
      'https://bap.invalid',
    )({
      email: 'invited@bap.invalid',
      id: 'invitation_1',
      organization: { name: 'Organization 1' },
    });

    expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, {
      subject: 'You are invited to Organization 1 on BAP',
      text: expect.stringContaining(
        'https://bap.invalid/invitation/invitation_1',
      ),
      to: 'invited@bap.invalid',
    });
  });
});

describe('Better Auth rate limits', () => {
  it('caps every credential, magic link, and two-factor path', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual(
      [
        '/magic-link/verify',
        '/organization/invite-member',
        '/request-password-reset',
        '/sign-in/email',
        '/sign-in/magic-link',
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

  it('is never more permissive than the built-in rule it replaces', () => {
    // Built-in: /sign-in* is 3 per 10s, /request-password-reset is 3 per 60s, /two-factor/* is 3 per 10s.
    for (const path of [
      '/request-password-reset',
      '/sign-in/email',
      '/sign-in/magic-link',
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
    // Built-in: the magic link plugin caps both of its paths at 5 per 60s.
    expect(authRateLimitRules['/magic-link/verify']).toEqual({
      max: 5,
      window: 60,
    });
    // No built-in rule matches invitations, so this only tightens the global 100 per 60s.
    expect(authRateLimitRules['/organization/invite-member']).toEqual({
      max: 5,
      window: 60,
    });
  });
});
