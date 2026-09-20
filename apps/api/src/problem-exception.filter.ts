import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

import type { ApplicationLogger } from './logger.js';
import type { AuthenticatedRequest, HttpResponse } from './request-context.js';

const problemDetails: Record<
  number,
  { detail: string; slug: string; title: string }
> = {
  [HttpStatus.BAD_REQUEST]: {
    detail: 'Request validation failed',
    slug: 'invalid-request',
    title: 'Invalid request',
  },
  [HttpStatus.CONFLICT]: {
    detail: 'The request conflicts with existing data',
    slug: 'conflict',
    title: 'Conflict',
  },
  [HttpStatus.FORBIDDEN]: {
    detail: 'Organization access is denied',
    slug: 'access-denied',
    title: 'Access denied',
  },
  [HttpStatus.NOT_FOUND]: {
    detail: 'The requested resource was not found',
    slug: 'not-found',
    title: 'Not found',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    detail: 'The request body exceeds the accepted size',
    slug: 'payload-too-large',
    title: 'Payload too large',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    detail: 'Request rate limit exceeded',
    slug: 'rate-limited',
    title: 'Too many requests',
  },
  [HttpStatus.UNAUTHORIZED]: {
    detail: 'A valid resource token is required',
    slug: 'authentication-required',
    title: 'Authentication required',
  },
};

// A route may name a machine-readable reason (a lowercase token) beside the generic problem of its status,
// either as the exception message or as a `code` field of an object body whose other fields ride along.
const PROBLEM_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function problemExtension(exception: unknown): Record<string, unknown> {
  if (!(exception instanceof HttpException)) {
    return {};
  }

  const body = exception.getResponse();

  if (typeof body === 'object' && body !== null && 'code' in body) {
    const { code } = body as { code?: unknown };
    return typeof code === 'string' && PROBLEM_CODE_PATTERN.test(code)
      ? { ...body }
      : {};
  }

  const message =
    typeof body === 'object' && body !== null
      ? (body as { message?: unknown }).message
      : body;

  return typeof message === 'string' && PROBLEM_CODE_PATTERN.test(message)
    ? { code: message }
    : {};
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: ApplicationLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host.switchToHttp().getRequest<AuthenticatedRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger?.error({
        errorMessage:
          exception instanceof Error ? exception.message : String(exception),
        errorName: exception instanceof Error ? exception.name : 'UnknownError',
        requestId: request.requestId,
        route: request.route?.path,
      });
    }

    const problem = problemDetails[status] ?? {
      detail: 'The service could not complete the request',
      slug:
        status === HttpStatus.SERVICE_UNAVAILABLE
          ? 'not-ready'
          : 'service-error',
      title:
        status === HttpStatus.SERVICE_UNAVAILABLE
          ? 'Service not ready'
          : 'Service error',
    };

    response.setHeader('Content-Type', 'application/problem+json');
    response.status(status).json({
      ...problemExtension(exception),
      detail: problem.detail,
      instance: request.url.split('?', 1)[0] || '/',
      status,
      title: problem.title,
      type: `https://bap.invalid/problems/${problem.slug}`,
    });
  }
}
