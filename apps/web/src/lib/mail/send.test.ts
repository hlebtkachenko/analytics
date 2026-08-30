import { describe, expect, it, vi } from 'vitest';

const { emailsSendMock } = vi.hoisted(() => ({ emailsSendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: emailsSendMock } };
  }),
}));

import type { MailConfiguration } from './config.ts';
import { sendMail } from './send.ts';

const logConfiguration: MailConfiguration = {
  apiKey: undefined,
  sender: 'team@bap.invalid',
  transport: 'log',
};

describe('sendMail', () => {
  it('rejects an invalid recipient', async () => {
    await expect(
      sendMail(logConfiguration, {
        subject: 'Subject',
        text: 'Body',
        to: 'not-an-email',
      }),
    ).rejects.toThrow();
  });

  it('rejects an empty subject', async () => {
    await expect(
      sendMail(logConfiguration, {
        subject: '',
        text: 'Body',
        to: 'user@bap.invalid',
      }),
    ).rejects.toThrow();
  });

  it('succeeds through the log transport', async () => {
    await expect(
      sendMail(logConfiguration, {
        subject: 'Subject',
        text: 'Body',
        to: 'user@bap.invalid',
      }),
    ).resolves.toEqual({ ok: true, transport: 'log' });
  });

  it('reports a provider failure as a typed failure result', async () => {
    emailsSendMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Invalid recipient.',
        name: 'validation_error',
        statusCode: 422,
      },
    });

    await expect(
      sendMail(
        {
          apiKey: 're_live_test_key',
          sender: 'team@bap.invalid',
          transport: 'resend',
        },
        { subject: 'Subject', text: 'Body', to: 'user@bap.invalid' },
      ),
    ).resolves.toEqual({
      error: 'Invalid recipient.',
      ok: false,
      transport: 'resend',
    });
  });
});
