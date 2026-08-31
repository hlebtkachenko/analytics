import { toNextJsHandler } from 'better-auth/next-js';
import {
  consumePublicSignupEdgeRateLimit,
  PUBLIC_SIGNUP_EDGE_RATE_LIMIT,
} from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';
import type { NextRequest } from 'next/server';

import {
  disabledAuthPaths,
  getAuth,
  getAuthPool,
  publicSignUpAllowed,
  publicSignUpErrorCode,
} from '../../../../lib/auth/server';
import { normalizePublicSignUpClientIdentity } from '../../../../lib/auth/public-sign-up-edge';

function isDisabledPath(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname.replace('/api/auth', '');
  return disabledAuthPaths.has(pathname);
}

function isEmailSignUp(request: NextRequest): boolean {
  return (
    request.method === 'POST' &&
    request.nextUrl.pathname === '/api/auth/sign-up/email'
  );
}

function publicSignUpForbidden(): Response {
  return Response.json({ code: publicSignUpErrorCode }, { status: 403 });
}

function publicSignUpRateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    {
      code: 'PUBLIC_SIGN_UP_RATE_LIMITED',
      retryAfterSeconds,
    },
    {
      headers: {
        'retry-after': String(retryAfterSeconds),
        'x-ratelimit-limit': String(PUBLIC_SIGNUP_EDGE_RATE_LIMIT.max),
        'x-ratelimit-remaining': '0',
      },
      status: 429,
    },
  );
}

function publicSignUpClientIdentity(request: NextRequest): string {
  return normalizePublicSignUpClientIdentity(
    request.headers.get('x-bap-client-ip'),
  );
}

function hasJsonContentType(request: NextRequest): boolean {
  return (
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() === 'application/json'
  );
}

export async function gatePublicSignUpRequest(
  request: NextRequest,
  loadPool: () => Promise<DatabasePool> = getAuthPool,
): Promise<Response | null> {
  if (!isEmailSignUp(request)) {
    return null;
  }

  let pool: DatabasePool;
  try {
    pool = await loadPool();
    const rateLimit = await consumePublicSignupEdgeRateLimit(
      pool,
      publicSignUpClientIdentity(request),
    );
    if (!rateLimit.allowed) {
      return publicSignUpRateLimited(rateLimit.retryAfterSeconds);
    }
  } catch {
    return publicSignUpForbidden();
  }

  if (!hasJsonContentType(request)) {
    return publicSignUpForbidden();
  }

  try {
    const body: unknown = await request.clone().json();
    if (await publicSignUpAllowed(pool, body)) {
      return null;
    }
  } catch {
    return publicSignUpForbidden();
  }

  return publicSignUpForbidden();
}

async function handle(request: NextRequest): Promise<Response> {
  if (isDisabledPath(request)) {
    return new Response(null, { status: 404 });
  }
  const publicSignUpGate = await gatePublicSignUpRequest(request);
  if (publicSignUpGate) {
    return publicSignUpGate;
  }
  const handler = toNextJsHandler(await getAuth());
  return request.method === 'GET'
    ? handler.GET(request)
    : handler.POST(request);
}

export const GET = handle;
export const POST = handle;
