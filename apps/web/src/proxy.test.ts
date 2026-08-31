import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetCapabilityCookieName } from './lib/auth/reset-capability.js';
import { config, proxy } from './proxy.js';

const resetCapability = 'ResetSentinelTokenAbc123';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it.each([
    ['purpose', { purpose: 'prefetch' }],
    ['Next router', { 'next-router-prefetch': '1' }],
  ])(
    'matches sensitive callbacks even with the %s prefetch header',
    (_label, headers) => {
      for (const path of ['/activate', '/reset-password']) {
        expect(
          unstable_doesMiddlewareMatch({
            config,
            nextConfig: {},
            headers,
            url: `https://bap.invalid${path}`,
          }),
        ).toBe(true);
      }
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: {},
          headers,
          url: 'https://bap.invalid/sign-in',
        }),
      ).toBe(false);
    },
  );

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

  it('canonicalizes a reset token into a production-only secure capability cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = proxy(
      new NextRequest(
        `https://bap.invalid/reset-password?token=${resetCapability}`,
      ),
    );
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://bap.invalid/reset-password',
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(cookie).toContain(`${resetCapabilityCookieName}=${resetCapability}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=1800/i);
    expect(cookie).toMatch(/Path=\/reset-password/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(await response.text()).not.toContain(resetCapability);
  });

  it.each([
    ['a callback error', '?error=PRIVATE_FRAMEWORK_CODE'],
    ['an invalid token', '?token=short'],
    [
      'multiple tokens',
      '?token=aaaaaaaaaaaaaaaaaaaaaaaa&token=bbbbbbbbbbbbbbbbbbbbbbbb',
    ],
  ])(
    'clears reset capability for %s before rendering',
    async (_label, query) => {
      const response = proxy(
        new NextRequest(`https://bap.invalid/reset-password${query}`),
      );
      const cookie = response.headers.get('set-cookie');

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'https://bap.invalid/reset-password',
      );
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(cookie).toContain(`${resetCapabilityCookieName}=`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Max-Age=0/i);
      expect(cookie).toMatch(/Path=\/reset-password/i);
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(await response.text()).not.toMatch(
        /PRIVATE_FRAMEWORK_CODE|aaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbb/,
      );
    },
  );

  it('clears a malformed capability cookie on the clean reset route', () => {
    const response = proxy(
      new NextRequest('https://bap.invalid/reset-password', {
        headers: { cookie: `${resetCapabilityCookieName}=malformed` },
      }),
    );

    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('canonicalizes an activation error code to one fixed generic state', async () => {
    const response = proxy(
      new NextRequest(
        'https://bap.invalid/activate?error=PRIVATE_ACTIVATION_CODE',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://bap.invalid/activate?state=invalid',
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).not.toContain('PRIVATE_ACTIVATION_CODE');
  });
});
