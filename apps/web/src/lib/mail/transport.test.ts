import { describe, expect, it, vi } from 'vitest';

const { emailsSendMock } = vi.hoisted(() => ({ emailsSendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: emailsSendMock } };
  }),
}));

import { webLogger } from '../logger.ts';
import {
  createResendTransport,
  logTransport,
  selectTransport,
} from './transport.ts';

const message = {
  subject: 'Subject',
  text: 'Body text',
  to: 'user@bap.invalid',
};

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
