import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ApplicationLogger } from './logger.js';
import { ProblemExceptionFilter } from './problem-exception.filter.js';
import type { AuthenticatedRequest, HttpResponse } from './request-context.js';

function createHost(request: Partial<AuthenticatedRequest>): {
  host: ArgumentsHost;
  response: HttpResponse;
} {
  const response: HttpResponse = {
    json: vi.fn(),
    once: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn(function status(this: HttpResponse) {
      return this;
    }),
    statusCode: 200,
  };
  const fullRequest: AuthenticatedRequest = {
    headers: {},
    method: 'GET',
    url: '/inbox/items',
    ...request,
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => fullRequest,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ProblemExceptionFilter', () => {
  it('logs one error with the request id and route for a thrown error, never the body', () => {
    const logger: ApplicationLogger = {
      error: vi.fn(),
    } as unknown as ApplicationLogger;
    const filter = new ProblemExceptionFilter(logger);
    const { host } = createHost({
      body: { secret: 'do-not-log' },
      requestId: 'a1b2c3',
      route: { path: '/inbox/items' },
    });

    filter.catch(new Error('boom'), host);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(logger.error).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload).toEqual({
      errorMessage: 'boom',
      errorName: 'Error',
      requestId: 'a1b2c3',
      route: '/inbox/items',
    });
    expect(JSON.stringify(payload)).not.toContain('do-not-log');
  });

  it('logs nothing for a 404', () => {
    const logger: ApplicationLogger = {
      error: vi.fn(),
    } as unknown as ApplicationLogger;
    const filter = new ProblemExceptionFilter(logger);
    const { host } = createHost({ requestId: 'd4e5f6' });

    filter.catch(new NotFoundException(), host);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
