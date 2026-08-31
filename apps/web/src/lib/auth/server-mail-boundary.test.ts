// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('../mail/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mail/index.ts')>()),
  sendMail: sendMailMock,
}));

import type { MailConfiguration } from '../mail/index.js';
import type { MailSendResult } from '../mail/transport.js';
import {
  createVerificationSender,
  runWithVerificationDeliveryBoundary,
  VerificationDeliveryUnavailableError,
} from './server.js';

const resendMailConfiguration: MailConfiguration = {
  apiKey: 're_test_only',
  sender: 'team@bap.invalid',
  transport: 'resend',
};

const smtpMailConfiguration: MailConfiguration = {
  apiKey: undefined,
  sender: 'team@bap.invalid',
  smtpHost: 'mailpit',
  smtpPort: 1025,
  transport: 'smtp',
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

function createVerificationAuth() {
  return betterAuth({
    baseURL: 'https://bap.invalid',
    database: memoryAdapter({
      account: [],
      session: [],
      user: [],
      verification: [],
    }),
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: createVerificationSender(smtpMailConfiguration),
    },
    logger: { disabled: true },
    secret: 'test-only-secret-that-is-long-enough',
  });
}

function signUpRequest(email: string): Request {
  return new Request('https://bap.invalid/api/auth/sign-up/email', {
    body: JSON.stringify({
      email,
      name: 'SMTP Boundary',
      password: 'test-only-smtp-password',
    }),
    headers: {
      'content-type': 'application/json',
      origin: 'https://bap.invalid',
    },
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Better Auth verification delivery boundary', () => {
  it('keeps the installed sign-up handler pending until SMTP acceptance completes', async () => {
    const deferred = createDeferred<MailSendResult>();
    sendMailMock.mockReturnValueOnce(deferred.promise);
    const auth = createVerificationAuth();
    let handlerSettled = false;
    const responsePromise = auth
      .handler(signUpRequest('smtp-boundary@bap.invalid'))
      .finally(() => {
        handlerSettled = true;
      });

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledOnce());
    expect(handlerSettled).toBe(false);

    deferred.resolve({ ok: true, transport: 'smtp' });
    expect((await responsePromise).status).toBe(200);
    expect(handlerSettled).toBe(true);
  });

  it('turns a swallowed Better Auth SMTP error into a request-boundary failure', async () => {
    sendMailMock.mockResolvedValueOnce({
      error: 'SMTP delivery failed.',
      ok: false,
      transport: 'smtp',
    });
    const auth = createVerificationAuth();

    await expect(
      runWithVerificationDeliveryBoundary(() =>
        auth.handler(signUpRequest('smtp-failure@bap.invalid')),
      ),
    ).rejects.toBeInstanceOf(VerificationDeliveryUnavailableError);
  });

  it('keeps production Resend non-blocking and handles provider rejection', async () => {
    const rejection = Promise.reject<MailSendResult>(
      new Error('Private provider detail.'),
    );
    sendMailMock.mockReturnValueOnce(rejection);

    await expect(
      createVerificationSender(resendMailConfiguration)({
        url: 'https://bap.invalid/verify-email/verify-2',
        user: { email: 'member@bap.invalid' },
      }),
    ).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
