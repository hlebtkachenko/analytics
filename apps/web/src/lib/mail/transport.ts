import { Resend } from 'resend';

import type { MailConfiguration, MailTransportKind } from './config.ts';

export interface MailMessage {
  subject: string;
  text: string;
  to: string;
}

export type { MailTransportKind } from './config.ts';

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

// An explicit development opt-in, so it prints the link a developer has to follow.
// Never select it where real recipients exist: the body reaches container stdout.
export const logTransport: MailTransport = {
  kind: 'log',
  async send(sender, message) {
    console.info('mail: log transport recorded message', {
      body: message.text,
      sender,
      subject: message.subject,
      to: message.to,
    });
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

// The configured transport decides; loadMailConfiguration already rejected an unusable key.
export function selectTransport(
  configuration: MailConfiguration,
): MailTransport {
  if (configuration.transport === 'log') {
    return logTransport;
  }

  if (configuration.apiKey === undefined) {
    throw new Error('The Resend transport requires an API key.');
  }

  return createResendTransport(configuration.apiKey);
}
