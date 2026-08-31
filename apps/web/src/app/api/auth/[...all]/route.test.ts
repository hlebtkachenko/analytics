import { NextRequest } from 'next/server';
import type { DatabasePool } from '@bap/db/pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  downstreamGetMock,
  downstreamPostMock,
  getAuthMock,
  getAuthPoolMock,
  toNextJsHandlerMock,
} = vi.hoisted(() => ({
  downstreamGetMock: vi.fn(),
  downstreamPostMock: vi.fn(),
  getAuthMock: vi.fn(),
  getAuthPoolMock: vi.fn(),
  toNextJsHandlerMock: vi.fn(),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: toNextJsHandlerMock,
}));

vi.mock('../../../../lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/auth/server')>()),
  getAuth: getAuthMock,
  getAuthPool: getAuthPoolMock,
}));

import { GET, POST } from './route';
import {
  normalizePublicSignUpClientIdentity,
  publicSignUpFallbackIdentity,
} from '../../../../lib/auth/public-sign-up-edge';
import { VerificationDeliveryUnavailableError } from '../../../../lib/auth/server';

function signUpRequest(email = 'member@bap.invalid'): NextRequest {
  return new NextRequest('https://bap.invalid/api/auth/sign-up/email', {
    body: JSON.stringify({
      email,
      name: 'Member',
      password: 'test-only-password',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

function poolWithState({
  edgeCount = 1,
  enabled = false,
  invited = false,
}: {
  edgeCount?: number;
  enabled?: boolean;
  invited?: boolean;
} = {}) {
  const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
    if (statement.includes('insert into auth.rate_limit')) {
      return {
        rows:
          edgeCount > 3
            ? []
            : [
                {
                  count: edgeCount,
                  last_request: parameters?.[1],
                },
              ],
      };
    }
    if (statement.includes('from auth.invitation')) {
      return { rows: [{ invited }] };
    }
    if (statement.includes('auth.public_signup_enabled()')) {
      return { rows: [{ enabled }] };
    }
    throw new Error('Unexpected database query.');
  });

  return {
    pool: { query } as unknown as DatabasePool,
    query,
  };
}

describe('public sign-up edge client identity', () => {
  it('keeps IPv4 identities at /32 and canonicalizes IPv6 identities to /64', () => {
    expect(normalizePublicSignUpClientIdentity('198.51.100.12')).toBe(
      '198.51.100.12/32',
    );
    expect(normalizePublicSignUpClientIdentity('2001:db8:abcd:12::1')).toBe(
      '2001:0db8:abcd:0012::/64',
    );
    expect(
      normalizePublicSignUpClientIdentity('2001:0DB8:ABCD:0012:ffff::9'),
    ).toBe('2001:0db8:abcd:0012::/64');
    expect(normalizePublicSignUpClientIdentity('2001:db8:abcd:13::1')).toBe(
      '2001:0db8:abcd:0013::/64',
    );
  });

  it('uses the shared fallback for absent, malformed, and scoped IPv6 values', () => {
    for (const value of [null, '', 'not-an-ip', 'fe80::1%lo0']) {
      expect(normalizePublicSignUpClientIdentity(value)).toBe(
        publicSignUpFallbackIdentity,
      );
    }
  });
});

describe('Better Auth route exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downstreamGetMock.mockResolvedValue(new Response(null, { status: 200 }));
    downstreamPostMock.mockResolvedValue(new Response(null, { status: 200 }));
    getAuthMock.mockResolvedValue({});
    toNextJsHandlerMock.mockReturnValue({
      GET: downstreamGetMock,
      POST: downstreamPostMock,
    });
  });

  it('does not expose browser resource-token retrieval', async () => {
    const token = await GET(
      new NextRequest('https://bap.invalid/api/auth/token'),
    );

    expect(token.status).toBe(404);
  });

  it('does not dispatch the public admin user-removal route', async () => {
    const response = await POST(
      new NextRequest('https://bap.invalid/api/auth/admin/remove-user', {
        body: JSON.stringify({ userId: 'controlled-target' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    expect(getAuthMock).not.toHaveBeenCalled();
    expect(downstreamPostMock).not.toHaveBeenCalled();
  });

  it.each([
    '/admin/impersonate-user',
    '/admin/impersonate-user///',
    '/admin/stop-impersonating',
    '/admin/stop-impersonating///',
  ])('does not dispatch the public %s route', async (path) => {
    const response = await POST(
      new NextRequest(`https://bap.invalid/api/auth${path}`, {
        body: JSON.stringify({ userId: 'controlled-target' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(getAuthMock).not.toHaveBeenCalled();
    expect(downstreamPostMock).not.toHaveBeenCalled();
  });

  it('denies through the actual POST route when public sign-up is off', async () => {
    const request = signUpRequest();
    const { pool, query } = poolWithState();
    getAuthPoolMock.mockResolvedValue(pool);

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: 'PUBLIC_SIGN_UP_DISABLED',
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it('rate limits before parsing or policy reads', async () => {
    const { pool, query } = poolWithState({ edgeCount: 4 });
    getAuthPoolMock.mockResolvedValue(pool);

    const response = await POST(
      new NextRequest('https://bap.invalid/api/auth/sign-up/email', {
        body: '{malformed',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-ratelimit-limit')).toBe('3');
    await expect(response.json()).resolves.toEqual({
      code: 'PUBLIC_SIGN_UP_RATE_LIMITED',
      retryAfterSeconds: 60,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      contentType: 'application/json',
      label: 'malformed JSON',
    },
    {
      contentType: 'text/plain',
      label: 'an unsupported content type',
    },
  ])(
    'fails closed for $label after consuming the edge limit',
    async ({ contentType }) => {
      const { pool, query } = poolWithState({ enabled: true });
      getAuthPoolMock.mockResolvedValue(pool);
      const response = await POST(
        new NextRequest('https://bap.invalid/api/auth/sign-up/email', {
          body: '{malformed',
          headers: { 'content-type': contentType },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        code: 'PUBLIC_SIGN_UP_DISABLED',
      });
      expect(query).toHaveBeenCalledOnce();
      expect(getAuthMock).not.toHaveBeenCalled();
    },
  );

  it('passes the untouched JSON request to Better Auth after both edge checks', async () => {
    const request = signUpRequest();
    const { pool, query } = poolWithState({ enabled: true });
    getAuthPoolMock.mockResolvedValue(pool);
    downstreamPostMock.mockImplementation(
      async (downstreamRequest: NextRequest) =>
        Response.json(await downstreamRequest.json()),
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: 'member@bap.invalid',
      name: 'Member',
      password: 'test-only-password',
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(downstreamPostMock).toHaveBeenCalledWith(request);
  });

  it('returns a generic failure when awaited verification delivery is unavailable', async () => {
    const request = signUpRequest();
    const { pool } = poolWithState({ enabled: true });
    getAuthPoolMock.mockResolvedValue(pool);
    downstreamPostMock.mockRejectedValueOnce(
      new VerificationDeliveryUnavailableError(),
    );

    const response = await POST(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTHENTICATION_UNAVAILABLE',
    });
  });

  it('uses one fallback bucket for absent or malformed client IP values', async () => {
    const missing = poolWithState({ edgeCount: 4 });
    const malformed = poolWithState({ edgeCount: 4 });
    getAuthPoolMock
      .mockResolvedValueOnce(missing.pool)
      .mockResolvedValueOnce(malformed.pool);

    const missingResponse = await POST(signUpRequest());
    const malformedResponse = await POST(
      new NextRequest('https://bap.invalid/api/auth/sign-up/email', {
        body: JSON.stringify({
          email: 'member@bap.invalid',
          name: 'Member',
          password: 'test-only-password',
        }),
        headers: {
          'content-type': 'application/json',
          'x-bap-client-ip': 'not-an-ip',
          'x-forwarded-for': '198.51.100.12',
        },
        method: 'POST',
      }),
    );

    expect(missingResponse.status).toBe(429);
    expect(malformedResponse.status).toBe(429);
    expect(missing.query.mock.calls[0]?.[1]?.[0]).toBe(
      malformed.query.mock.calls[0]?.[1]?.[0],
    );
  });

  it('fails closed without exposing a database rate-limit error', async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error('private database detail'));
    getAuthPoolMock.mockResolvedValue({ query } as unknown as DatabasePool);

    const response = await POST(signUpRequest());

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toBe('{"code":"PUBLIC_SIGN_UP_DISABLED"}');
    expect(body).not.toContain('private database detail');
    expect(query).toHaveBeenCalledOnce();
  });
});
