import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy.js';

describe('proxy', () => {
  it('sets a per-request nonce CSP and restrictive browser policies', () => {
    const response = proxy(new NextRequest('https://bap.invalid/sign-in'));
    const policy = response.headers.get('content-security-policy');

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('nonce-');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(
      response.headers.get('x-middleware-request-content-security-policy'),
    ).toBe(policy);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeTruthy();
  });
});
