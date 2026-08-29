import { randomUUID } from 'node:crypto';

import {
  HttpStatus,
  StandardSchemaValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import type { ApplicationLogger } from './logger.js';
import { ServiceMetrics } from './metrics.js';
import { ProblemExceptionFilter } from './problem-exception.filter.js';
import type { AuthenticatedRequest, HttpResponse } from './request-context.js';

const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function configureApplication(
  application: NestExpressApplication,
  logger?: ApplicationLogger,
): void {
  const adapter: {
    set(name: string, value: unknown): void;
  } = application.getHttpAdapter().getInstance();
  adapter.set('trust proxy', false);

  const metrics = application.get(ServiceMetrics);
  application.use(
    (
      request: AuthenticatedRequest,
      response: HttpResponse,
      next: () => void,
    ): void => {
      const incoming = request.headers['x-bap-request-id'];
      const requestId =
        typeof incoming === 'string' && REQUEST_ID.test(incoming)
          ? incoming
          : randomUUID();
      request.requestId = requestId;
      response.setHeader('X-Request-ID', requestId);
      logger?.log({ method: request.method, requestId }, 'HTTP request');
      response.once('finish', () => {
        metrics.recordRequest(
          request.method,
          request.route?.path ?? 'unmatched',
          response.statusCode,
        );
      });
      next();
    },
  );
  application.use(helmet());
  application.useBodyParser('json', { limit: '1mb' });
  application.useBodyParser('urlencoded', { extended: false, limit: '1mb' });
  application.enableVersioning({ type: VersioningType.URI });
  application.useGlobalPipes(
    new StandardSchemaValidationPipe({
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      transform: true,
    }),
  );
  application.useGlobalFilters(new ProblemExceptionFilter());

  const openApi = new DocumentBuilder()
    .setTitle('BAP Application API')
    .setDescription('Private application service access contract')
    .setVersion('1.0.0')
    .addBearerAuth(
      { bearerFormat: 'JWT', scheme: 'bearer', type: 'http' },
      'resource-token',
    )
    .build();
  const document = SwaggerModule.createDocument(application, openApi);
  SwaggerModule.setup('openapi', application, document, {
    jsonDocumentUrl: 'openapi.json',
  });
}
