import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  const contentSecurityPolicy = createContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV !== 'production',
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('content-security-policy', contentSecurityPolicy);
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set(
    'permissions-policy',
    'camera=(), geolocation=(), microphone=()',
  );
  return response;
}

export const config = {
  matcher: [
    {
      missing: [
        { key: 'next-router-prefetch', type: 'header' },
        { key: 'purpose', type: 'header', value: 'prefetch' },
      ],
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
    },
  ],
};
