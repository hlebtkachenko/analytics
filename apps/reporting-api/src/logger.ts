import type { LoggerService } from '@nestjs/common';
import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';

const REDACTED_PATHS = [
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

export class ReportingLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(destination?: DestinationStream) {
    const options: LoggerOptions = {
      base: { service: 'reporting-api' },
      redact: { censor: '[Redacted]', paths: REDACTED_PATHS },
    };
    this.logger =
      destination === undefined ? pino(options) : pino(options, destination);
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }

  error(_message: unknown, _trace?: string, context?: string): void {
    this.logger.error({ context }, 'Reporting service error');
  }

  fatal(_message: unknown, _trace?: string, context?: string): void {
    this.logger.fatal({ context }, 'Fatal reporting service error');
  }

  log(message: unknown, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      this.logger.info({ context, data: message }, 'Structured reporting log');
      return;
    }

    this.logger.info({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
}
