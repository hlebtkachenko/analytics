import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { webLogger } from '../logger.ts';
import { localSmtpHost, localSmtpPort } from './config.ts';
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

export const localSmtpTimeouts = {
  connectionTimeout: 1_500,
  dnsTimeout: 1_000,
  greetingTimeout: 1_500,
  socketTimeout: 2_000,
} as const;

// An explicit development opt-in, so it prints the link a developer has to follow.
// Never select it where real recipients exist: the body reaches container stdout.
export const logTransport: MailTransport = {
  kind: 'log',
  async send(sender, message) {
    // The body and the recipient are the point of this transport, so they are named outside the redacted paths.
    webLogger.info('mail log transport recorded message', {
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

export function createSmtpTransport(host: string, port: number): MailTransport {
  const client = nodemailer.createTransport({
    ...localSmtpTimeouts,
    disableFileAccess: true,
    disableUrlAccess: true,
    host,
    ignoreTLS: true,
    port,
    secure: false,
  });

  return {
    kind: 'smtp',
    async send(sender, message) {
      try {
        await client.sendMail({
          from: sender,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });
        return { ok: true, transport: 'smtp' };
      } catch {
        // Provider errors can repeat a recipient or verification link, so never reflect them.
        return {
          error: 'SMTP delivery failed.',
          ok: false,
          transport: 'smtp',
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

  if (configuration.transport === 'smtp') {
    if (
      configuration.smtpHost !== localSmtpHost ||
      configuration.smtpPort !== localSmtpPort
    ) {
      throw new Error('The SMTP transport requires the isolated endpoint.');
    }
    return createSmtpTransport(configuration.smtpHost, configuration.smtpPort);
  }

  if (configuration.apiKey === undefined) {
    throw new Error('The Resend transport requires an API key.');
  }

  return createResendTransport(configuration.apiKey);
}
