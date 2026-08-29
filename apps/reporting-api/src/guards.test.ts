import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SubjectRateLimiter } from '@bap/security';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedRequest, HttpResponse } from './request-context.js';
import { ResourceJwtGuard } from './resource-jwt.guard.js';
import { SubjectRateLimitGuard } from './subject-rate-limit.guard.js';

function context(
  request: AuthenticatedRequest,
  response: HttpResponse,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

describe('resource guards', () => {
  it('rejects an invalid token before any limiter state is allocated', async () => {
    const limiter = new SubjectRateLimiter({
      limit: 1,
      maxEntries: 1,
      windowMs: 60_000,
    });
    const jwt = new ResourceJwtGuard({
      verifyAuthorizationHeader: async () => {
        throw new Error('invalid');
      },
      verifyToken: async () => {
        throw new Error('invalid');
      },
    });
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer invalid' },
      method: 'GET',
      url: '/v1/organizations/organization_1/access',
    };
    const response = {
      json: () => undefined,
      once: () => undefined,
      setHeader: () => undefined,
      status: () => response,
      statusCode: 200,
    } as HttpResponse;

    await expect(
      jwt.canActivate(context(request, response)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limiter.size).toBe(0);
  });

  it('limits verified subjects independently with exact response headers', () => {
    const limiter = new SubjectRateLimiter({
      limit: 1,
      maxEntries: 2,
      windowMs: 60_000,
    });
    const headers = new Map<string, number | string>();
    const response = {
      json: () => undefined,
      once: () => undefined,
      setHeader: (name: string, value: number | string) =>
        headers.set(name, value),
      status: () => response,
      statusCode: 200,
    } as HttpResponse;
    const guard = new SubjectRateLimitGuard(limiter);
    const first: AuthenticatedRequest = {
      headers: {},
      method: 'GET',
      resourcePrincipal: { issuedAt: 1, subject: 'first' },
      url: '/',
    };
    const second = {
      ...first,
      resourcePrincipal: { issuedAt: 1, subject: 'second' },
    };

    expect(guard.canActivate(context(first, response))).toBe(true);
    expect(guard.canActivate(context(second, response))).toBe(true);
    expect(headers.get('RateLimit-Remaining')).toBe(0);
  });
});
