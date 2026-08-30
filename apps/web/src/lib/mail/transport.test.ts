import { describe, expect, it, vi } from 'vitest';

const { emailsSendMock } = vi.hoisted(() => ({ emailsSendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: emailsSendMock } };
  }),
}));

import { developmentPlaceholderApiKey } from './config.ts';
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
  it('selects the log transport when the api key is absent', () => {
    expect(
      selectTransport({ apiKey: undefined, sender: 'team@bap.invalid' }).kind,
    ).toBe('log');
  });

  it('selects the log transport for the development placeholder', () => {
    expect(
      selectTransport({
        apiKey: developmentPlaceholderApiKey,
        sender: 'team@bap.invalid',
      }).kind,
    ).toBe('log');
  });

  it('selects the resend transport for a real-looking key', () => {
    expect(
      selectTransport({
        apiKey: 're_live_test_key',
        sender: 'team@bap.invalid',
      }).kind,
    ).toBe('resend');
  });
});

describe('logTransport', () => {
  it('records the message without logging the body at info level', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);

    await expect(
      logTransport.send('team@bap.invalid', message),
    ).resolves.toEqual({ ok: true, transport: 'log' });

    expect(JSON.stringify(info.mock.calls)).not.toContain(message.text);
    expect(JSON.stringify(debug.mock.calls)).toContain(message.text);

    info.mockRestore();
    debug.mockRestore();
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
