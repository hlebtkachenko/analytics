import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

// scripts/create-local-secrets.sh seeds this exact value, which is never a usable key.
export const developmentPlaceholderApiKey = 'local-development-placeholder';

// Suitable only for local development; every other environment must set BAP_MAIL_SENDER.
export const defaultMailSender = 'no-reply@bap.localhost';

export type MailTransportKind = 'log' | 'resend' | 'smtp';

export const localSmtpHost = 'mailpit';
export const localSmtpPort = 1025;

const mailEnvironmentSchema = z.object({
  BAP_MAIL_SENDER: z.email().default(defaultMailSender),
  BAP_MAIL_SMTP_HOST: z.string().min(1).optional(),
  BAP_MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  BAP_MAIL_TRANSPORT: z.enum(['log', 'resend', 'smtp']).default('resend'),
  BAP_RESEND_API_KEY_FILE: z.string().min(1).optional(),
});

export interface MailConfiguration {
  // undefined when the key file is absent; only Resend requires it.
  apiKey: string | undefined;
  sender: string;
  smtpHost?: string;
  smtpPort?: number;
  transport: MailTransportKind;
}

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function readResendApiKeyFile(path: string): Promise<string | undefined> {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (isEnoentError(error)) {
      return undefined;
    }
    throw error;
  }

  const permissions = details.mode & 0o777;
  if (!details.isFile() || ![0o400, 0o444, 0o600].includes(permissions)) {
    throw new Error('Resend API key file must be a protected regular file.');
  }

  const content = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  if (content.length === 0) {
    throw new Error('Resend API key file is empty.');
  }

  return content;
}

export async function loadMailConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<MailConfiguration> {
  const parsed = mailEnvironmentSchema.parse(environment);
  // Non-provider transports need no credential, so they may configure nothing.
  const apiKey =
    parsed.BAP_RESEND_API_KEY_FILE === undefined
      ? undefined
      : await readResendApiKeyFile(parsed.BAP_RESEND_API_KEY_FILE);

  // The log transport is an explicit opt-in so a missing key can never silently drop mail.
  if (
    parsed.BAP_MAIL_TRANSPORT === 'resend' &&
    (apiKey === undefined || apiKey === developmentPlaceholderApiKey)
  ) {
    throw new Error(
      'The Resend transport requires a real API key. Use log only for a non-sending runtime or the isolated development SMTP sink.',
    );
  }

  // SMTP is deliberately limited to the isolated development/CI Mailpit service.
  if (
    parsed.BAP_MAIL_TRANSPORT === 'smtp' &&
    (parsed.BAP_MAIL_SMTP_HOST !== localSmtpHost ||
      parsed.BAP_MAIL_SMTP_PORT !== localSmtpPort)
  ) {
    throw new Error(
      `The SMTP transport requires the isolated ${localSmtpHost}:${localSmtpPort} development sink.`,
    );
  }

  if (parsed.BAP_MAIL_TRANSPORT === 'smtp') {
    return {
      apiKey,
      sender: parsed.BAP_MAIL_SENDER,
      smtpHost: localSmtpHost,
      smtpPort: localSmtpPort,
      transport: parsed.BAP_MAIL_TRANSPORT,
    };
  }

  return {
    apiKey,
    sender: parsed.BAP_MAIL_SENDER,
    transport: parsed.BAP_MAIL_TRANSPORT,
  };
}
