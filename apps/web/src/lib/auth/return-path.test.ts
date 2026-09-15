import { describe, expect, it } from 'vitest';

import { safeReturnPath, signInPath, twoFactorPath } from './return-path';

describe('safeReturnPath', () => {
  it('keeps a same-origin path with its query string', () => {
    expect(safeReturnPath('/documents/analytics?organization=x')).toBe(
      '/documents/analytics?organization=x',
    );
  });

  it('refuses a protocol-relative path', () => {
    expect(safeReturnPath('//evil.example')).toBe('/access');
  });

  it('refuses an absolute URL', () => {
    expect(safeReturnPath('https://evil.example')).toBe('/access');
  });

  it('refuses a backslash path a browser may normalize', () => {
    expect(safeReturnPath('/\\evil')).toBe('/access');
  });

  it('refuses a control character the URL parser would strip', () => {
    expect(safeReturnPath('/\t/evil.com')).toBe('/access');
    expect(safeReturnPath('/\n/evil.com')).toBe('/access');
    expect(safeReturnPath('/\r/evil.com')).toBe('/access');
  });

  it('refuses a decoded double slash that leaves this origin', () => {
    expect(safeReturnPath('///evil.com')).toBe('/access');
  });

  it('refuses dot segments that collapse into a protocol-relative path', () => {
    expect(safeReturnPath('/..//evil.com')).toBe('/access');
  });

  it('falls back when the value is absent or empty', () => {
    expect(safeReturnPath(null)).toBe('/access');
    expect(safeReturnPath('')).toBe('/access');
  });

  it('refuses an over long value', () => {
    expect(safeReturnPath(`/${'a'.repeat(2048)}`)).toBe('/access');
  });

  it('refuses a route that cannot be the destination of a signed in session', () => {
    for (const path of [
      '/api',
      '/api/auth/session',
      '/sign-in',
      '/sign-in/two-factor',
      '/sign-up',
      '/activate',
      '/reset-password',
      '/forgot-password',
      '/welcome',
    ]) {
      expect(safeReturnPath(path)).toBe('/access');
    }
  });

  it('normalizes the path a browser would navigate to and drops the fragment', () => {
    expect(safeReturnPath('/documents/../datasets?a=b#c')).toBe(
      '/datasets?a=b',
    );
  });
});

describe('signInPath', () => {
  it('carries a safe return path and omits the default one', () => {
    expect(signInPath('/documents?organization=x')).toBe(
      '/sign-in?next=%2Fdocuments%3Forganization%3Dx',
    );
    expect(signInPath('/access')).toBe('/sign-in');
    expect(signInPath(null)).toBe('/sign-in');
    expect(signInPath('//evil.example')).toBe('/sign-in');
  });
});

describe('twoFactorPath', () => {
  it('carries a safe return path and omits the default one', () => {
    expect(twoFactorPath('/documents')).toBe(
      '/sign-in/two-factor?next=%2Fdocuments',
    );
    expect(twoFactorPath('/access')).toBe('/sign-in/two-factor');
    expect(twoFactorPath('/\t/evil.com')).toBe('/sign-in/two-factor');
  });
});
