import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-configuration.js';

describe('loadRuntimeConfiguration', () => {
  it('uses the reporting API defaults', () => {
    expect(loadRuntimeConfiguration({})).toEqual({
      host: '0.0.0.0',
      issuer: 'http://localhost:3000',
      jwksUrl: 'http://web:3000/api/auth/jwks',
      port: 3002,
      rateLimit: { limit: 60, maxEntries: 10_000, windowMs: 60_000 },
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

  it('rejects non-HTTP identity endpoints', () => {
    expect(() =>
      loadRuntimeConfiguration({ BAP_PUBLIC_ORIGIN: 'ftp://bap.invalid' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({ BAP_JWKS_URL: 'file:///tmp/jwks.json' }),
    ).toThrow('Invalid runtime configuration');
  });
});
