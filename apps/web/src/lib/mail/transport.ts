import { Resend } from 'resend';

import { developmentPlaceholderApiKey } from './config.ts';
import type { MailConfiguration } from './config.ts';

export interface MailMessage {
  subject: string;
  text: string;
  to: string;
}

export type MailTransportKind = 'log' | 'resend';

export interface MailSendResult {
  error?: string;
  id?: string;
  ok: boolean;
  transport: MailTransportKind;
}

export interface MailTransport {
  kind: MailTransportKind;
  send(sender: string, message: MailMessage): Promise<MailSendResult>;
}

// Records the message for local visibility instead of calling Resend; never throws, never reaches the network.
export const logTransport: MailTransport = {
  kind: 'log',
  async send(sender, message) {
    console.info('mail: log transport recorded message', {
      sender,
      subject: message.subject,
      to: message.to,
    });
    // Body content stays out of info-level logs; debug is the redaction boundary here.
    console.debug('mail: log transport body', { text: message.text });
    return { ok: true, transport: 'log' };
  },
};

export function createResendTransport(apiKey: string): MailTransport {
  const client = new Resend(apiKey);
  return {
    kind: 'resend',
    async send(sender, message) {
      try {
        const response = await client.emails.send({
          from: sender,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });
        if (response.error) {
          return {
            error: response.error.message,
            ok: false,
            transport: 'resend',
          };
        }
        return { id: response.data.id, ok: true, transport: 'resend' };
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : 'Unknown Resend error.',
          ok: false,
          transport: 'resend',
        };
      }
    },
  };
}

// Placeholder or absent key selects the log transport; any other value selects Resend.
export function selectTransport(
  configuration: MailConfiguration,
): MailTransport {
  if (
    configuration.apiKey === undefined ||
    configuration.apiKey === developmentPlaceholderApiKey
  ) {
    return logTransport;
  }
  return createResendTransport(configuration.apiKey);
}
