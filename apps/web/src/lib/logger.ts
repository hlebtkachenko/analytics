import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';

// The application API list, copied verbatim because apps must not import each other.
const APPLICATION_REDACTED_PATHS = [
  '*.authorization',
  '*.cookie',
  '*.database',
  '*.email',
  '*.password',
  'authorization',
  'configuration',
  'cookie',
  'database',
  'data.authorization',
  'data.configuration',
  'data.cookie',
  'data.database',
  'data.email',
  'data.password',
  'email',
  'password',
  'req.headers.authorization',
  'req.headers.cookie',
];

// The web tier also holds browser sessions, resource JWTs, provider keys, and model text.
const WEB_REDACTED_PATHS = [
  '*.apiKey',
  '*.completion',
  '*.credential',
  '*.messages',
  '*.prompt',
  '*.secret',
  '*.sessionToken',
  '*.token',
  'apiKey',
  'completion',
  'credential',
  'data.apiKey',
  'data.completion',
  'data.credential',
  'data.messages',
  'data.prompt',
  'data.secret',
  'data.sessionToken',
  'data.token',
  'messages',
  'prompt',
  'secret',
  'sessionToken',
  'token',
];

const REDACTED_PATHS = [...APPLICATION_REDACTED_PATHS, ...WEB_REDACTED_PATHS];

// Scalars only, so a thrown error, a request body, or a model message list cannot be passed in whole.
export type LogFields = Readonly<
  Record<string, string | number | boolean | null>
>;

export class WebLogger {
  private readonly logger: Logger;

  // The destination and the level are injectable so a test can assert on what reached the stream.
  constructor(
    destination?: DestinationStream,
    service = 'web',
    level: LevelWithSilent = 'info',
  ) {
    const options: LoggerOptions = {
      base: { service },
      level,
      redact: { censor: '[Redacted]', paths: REDACTED_PATHS },
    };
    this.logger =
      destination === undefined ? pino(options) : pino(options, destination);
  }

  // The event is a fixed literal chosen at the call site, so no thrown error is ever serialized.
  error(event: string, fields: LogFields = {}): void {
    this.logger.error({ data: fields }, event);
  }

  info(event: string, fields: LogFields = {}): void {
    this.logger.info({ data: fields }, event);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.logger.warn({ data: fields }, event);
  }
}

// Vitest asserts against injected destinations, so the shared instance stays quiet under the runner.
export const webLogger = new WebLogger(
  undefined,
  'web',
  process.env.NODE_ENV === 'test' ? 'silent' : 'info',
);
