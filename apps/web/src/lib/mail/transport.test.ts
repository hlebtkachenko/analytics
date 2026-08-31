import { afterEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, emailsSendMock, smtpSendMock } = vi.hoisted(
  () => ({
    createTransportMock: vi.fn(),
    emailsSendMock: vi.fn(),
    smtpSendMock: vi.fn(),
  }),
);

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock.mockReturnValue({
      sendMail: smtpSendMock,
    }),
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: emailsSendMock } };
  }),
}));

import { webLogger } from '../logger.ts';
import {
  createResendTransport,
  createSmtpTransport,
  localSmtpTimeouts,
  logTransport,
  selectTransport,
} from './transport.ts';

const message = {
  subject: 'Subject',
  text: 'Body text',
  to: 'user@bap.invalid',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('selectTransport', () => {
  it('selects the log transport when it is configured', () => {
    expect(
      selectTransport({
        apiKey: undefined,
        sender: 'team@bap.invalid',
        transport: 'log',
      }).kind,
    ).toBe('log');
  });

  it('selects the resend transport when it is configured', () => {
    expect(
      selectTransport({
        apiKey: 're_live_test_key',
        sender: 'team@bap.invalid',
        transport: 'resend',
      }).kind,
    ).toBe('resend');
  });

  it('refuses the resend transport without a key', () => {
    expect(() =>
      selectTransport({
        apiKey: undefined,
        sender: 'team@bap.invalid',
        transport: 'resend',
      }),
    ).toThrow('requires an API key');
  });

  it('selects the configured SMTP endpoint', () => {
    expect(
      selectTransport({
        apiKey: undefined,
        sender: 'team@bap.invalid',
        smtpHost: 'mailpit',
        smtpPort: 1025,
        transport: 'smtp',
      }).kind,
    ).toBe('smtp');
    expect(createTransportMock).toHaveBeenCalledWith({
      connectionTimeout: 1_500,
      disableFileAccess: true,
      disableUrlAccess: true,
      dnsTimeout: 1_000,
      greetingTimeout: 1_500,
      host: 'mailpit',
      ignoreTLS: true,
      port: 1025,
      secure: false,
      socketTimeout: 2_000,
    });
    expect(localSmtpTimeouts).toEqual({
      connectionTimeout: 1_500,
      dnsTimeout: 1_000,
      greetingTimeout: 1_500,
      socketTimeout: 2_000,
    });
  });

  it.each([
    {},
    { smtpHost: 'external.example.test', smtpPort: 1025 },
    { smtpHost: 'mailpit', smtpPort: 2525 },
  ])('refuses an incomplete or different SMTP endpoint', (smtpEndpoint) => {
    expect(() =>
      selectTransport({
        apiKey: undefined,
        sender: 'team@bap.invalid',
        transport: 'smtp',
        ...smtpEndpoint,
      }),
    ).toThrow('requires the isolated endpoint');
  });
});

describe('logTransport', () => {
  it('records the message so a developer can follow the link', async () => {
    const info = vi
      .spyOn(webLogger, 'info')
      .mockImplementation(() => undefined);

    await expect(
      logTransport.send('team@bap.invalid', message),
    ).resolves.toEqual({ ok: true, transport: 'log' });

    expect(JSON.stringify(info.mock.calls)).toContain(message.text);
    expect(JSON.stringify(info.mock.calls)).toContain(message.to);

    info.mockRestore();
  });
});

describe('createResendTransport', () => {
  it('reports a successful send', async () => {
    emailsSendMock.mockResolvedValueOnce({
      data: { id: 'email_123' },
      error: null,
    });

    const transport = createResendTransport('re_live_test_key');

    await expect(transport.send('team@bap.invalid', message)).resolves.toEqual({
      id: 'email_123',
      ok: true,
      transport: 'resend',
    });
    expect(emailsSendMock).toHaveBeenCalledWith({
      from: 'team@bap.invalid',
      subject: message.subject,
      text: message.text,
      to: message.to,
    });
  });

  it('reports a typed failure when Resend returns an error', async () => {
    emailsSendMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Invalid recipient.',
        name: 'validation_error',
        statusCode: 422,
      },
    });

    const transport = createResendTransport('re_live_test_key');

    await expect(transport.send('team@bap.invalid', message)).resolves.toEqual({
      error: 'Invalid recipient.',
      ok: false,
      transport: 'resend',
    });
  });

  it('reports a typed failure when Resend throws', async () => {
    emailsSendMock.mockRejectedValueOnce(new Error('Network unavailable.'));

    const transport = createResendTransport('re_live_test_key');

    await expect(transport.send('team@bap.invalid', message)).resolves.toEqual({
      error: 'Network unavailable.',
      ok: false,
      transport: 'resend',
    });
  });
});

describe('createSmtpTransport', () => {
  it('sends through cleartext, unauthenticated Mailpit without logging content', async () => {
    smtpSendMock.mockResolvedValueOnce({ messageId: 'smtp-test-id' });
    const info = vi
      .spyOn(webLogger, 'info')
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(webLogger, 'error')
      .mockImplementation(() => undefined);

    const transport = createSmtpTransport('mailpit', 1025);

    await expect(transport.send('team@bap.invalid', message)).resolves.toEqual({
      ok: true,
      transport: 'smtp',
    });
    expect(smtpSendMock).toHaveBeenCalledWith({
      from: 'team@bap.invalid',
      subject: message.subject,
      text: message.text,
      to: message.to,
    });
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    info.mockRestore();
    error.mockRestore();
  });

  it('redacts SMTP provider failures and does not log mail content', async () => {
    smtpSendMock.mockRejectedValueOnce(
      new Error('Delivery failed for user@bap.invalid with PRIVATE_LINK'),
    );
    const info = vi
      .spyOn(webLogger, 'info')
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(webLogger, 'error')
      .mockImplementation(() => undefined);

    const transport = createSmtpTransport('mailpit', 1025);

    await expect(transport.send('team@bap.invalid', message)).resolves.toEqual({
      error: 'SMTP delivery failed.',
      ok: false,
      transport: 'smtp',
    });
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    info.mockRestore();
    error.mockRestore();
  });
});
