import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

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
    expect(createMagicLinkOptions(mailConfiguration).disableSignUp).toBe(true);
  });

  it('sends the link through the mail module', async () => {
    sendMailMock.mockResolvedValueOnce({ ok: true, transport: 'log' });

    await createMagicLinkOptions(mailConfiguration).sendMagicLink({
      email: 'member@bap.invalid',
      token: 'token-1',
      url: 'https://bap.invalid/access?token=token-1',
    });

    expect(sendMailMock).toHaveBeenCalledWith(mailConfiguration, {
      subject: 'Your BAP sign-in link',
      text: expect.stringContaining('https://bap.invalid/access?token=token-1'),
      to: 'member@bap.invalid',
    });
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
      expect(rule).toEqual({ max: 5, window: 60 });
    }
  });
});
