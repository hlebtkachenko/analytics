import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  isValidResetCapability,
  resetCapabilityCookieName,
  resetCapabilityCookieOptions,
} from './lib/auth/reset-capability';

function createContentSecurityPolicy(
  nonce: string,
  development: boolean,
): string {
  const scriptSource = development
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  const production = process.env.NODE_ENV === 'production';
  const contentSecurityPolicy = createContentSecurityPolicy(nonce, !production);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);

  const callbackPath =
    request.nextUrl.pathname === '/activate' ||
    request.nextUrl.pathname === '/reset-password';

  if (
    request.nextUrl.pathname === '/activate' &&
    request.nextUrl.searchParams.has('error')
  ) {
    const response = NextResponse.redirect(
      new URL('/activate?state=invalid', request.url),
    );
    setBrowserPolicies(response, contentSecurityPolicy, true);
    return response;
  }

  if (
    request.nextUrl.pathname === '/reset-password' &&
    (request.nextUrl.searchParams.has('error') ||
      request.nextUrl.searchParams.has('token'))
  ) {
    const response = NextResponse.redirect(
      new URL('/reset-password', request.url),
    );
    const tokens = request.nextUrl.searchParams.getAll('token');
    const token = tokens.length === 1 ? tokens[0] : undefined;
    const validCapability =
      !request.nextUrl.searchParams.has('error') &&
      isValidResetCapability(token);
    if (validCapability) {
      response.cookies.set(
        resetCapabilityCookieName,
        token,
        resetCapabilityCookieOptions(production),
      );
    } else {
      response.cookies.set(resetCapabilityCookieName, '', {
        ...resetCapabilityCookieOptions(production),
        maxAge: 0,
      });
    }
    setBrowserPolicies(response, contentSecurityPolicy, true);
    return response;
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (request.nextUrl.pathname === '/reset-password') {
    const capability = request.cookies.get(resetCapabilityCookieName)?.value;
    if (capability !== undefined && !isValidResetCapability(capability)) {
      response.cookies.set(resetCapabilityCookieName, '', {
        ...resetCapabilityCookieOptions(production),
        maxAge: 0,
      });
    }
  }

  setBrowserPolicies(response, contentSecurityPolicy, callbackPath);
  return response;
}

function setBrowserPolicies(
  response: NextResponse,
  contentSecurityPolicy: string,
  noReferrer: boolean,
): void {
  response.headers.set('content-security-policy', contentSecurityPolicy);
  response.headers.set(
    'referrer-policy',
    noReferrer ? 'no-referrer' : 'strict-origin-when-cross-origin',
  );
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set(
    'permissions-policy',
    'camera=(), geolocation=(), microphone=()',
  );
}

export const config = {
  matcher: [
    '/activate',
    '/reset-password',
    {
      missing: [
        { key: 'next-router-prefetch', type: 'header' },
        { key: 'purpose', type: 'header', value: 'prefetch' },
      ],
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
    },
  ],
};
