import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-configuration.js';

describe('loadRuntimeConfiguration', () => {
  it('uses the application API defaults', () => {
    expect(loadRuntimeConfiguration({})).toEqual({
      host: '0.0.0.0',
      issuer: 'http://localhost:3000',
      jwksUrl: 'http://web:3000/api/auth/jwks',
      port: 3001,
      rateLimit: {
        limit: 60,
        maxEntries: 10_000,
        windowMs: 60_000,
      },
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadRuntimeConfiguration({ PORT: 'invalid' })).toThrow(
      'Invalid runtime configuration',
    );
  });

  it('rejects an empty host', () => {
    expect(() => loadRuntimeConfiguration({ HOST: ' ' })).toThrow(
      'Invalid runtime configuration',
    );
  });

  it('rejects invalid identity and limiter configuration', () => {
    expect(() =>
      loadRuntimeConfiguration({ BAP_PUBLIC_ORIGIN: 'not-a-url' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({ AUTH_RATE_LIMIT_CAPACITY: '0' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({ BAP_JWKS_URL: 'ftp://bap.invalid/jwks' }),
    ).toThrow('Invalid runtime configuration');
  });
});
