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
  createMagicLinkOptions,
  loadAuthEnvironment,
  readAuthSecret,
} from './server.js';

const mailConfiguration: MailConfiguration = {
  apiKey: undefined,
  sender: 'team@bap.invalid',
  transport: 'log',
};

describe('Better Auth resource contract', () => {
  it('keeps token, signup, mail, and invitation paths disabled', () => {
    expect([...disabledAuthPaths].sort()).toEqual(
      [
        '/organization/accept-invitation',
        '/organization/cancel-invitation',
        '/organization/get-invitation',
        '/organization/invite-member',
        '/organization/list-invitations',
        '/organization/list-user-invitations',
        '/organization/reject-invitation',
        '/request-password-reset',
        '/reset-password',
        '/send-verification-email',
        '/sign-up/email',
        '/token',
        '/verify-email',
      ].sort(),
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

describe('Better Auth rate limits', () => {
  it('caps every credential, magic link, and two-factor path', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual(
      [
        '/magic-link/verify',
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
