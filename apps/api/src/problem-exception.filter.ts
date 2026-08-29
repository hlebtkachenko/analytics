import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

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

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host.switchToHttp().getRequest<AuthenticatedRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
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
      detail: problem.detail,
      instance: request.url.split('?', 1)[0] || '/',
      status,
      title: problem.title,
      type: `https://bap.invalid/problems/${problem.slug}`,
    });
  }
}
