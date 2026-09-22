import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-configuration.js';

describe('loadRuntimeConfiguration', () => {
  it('uses the application API defaults', () => {
    expect(loadRuntimeConfiguration({})).toEqual({
      blob: {
        quotaBytesPerOrganization: 1_073_741_824,
        storageDirectory: '/var/lib/bap/blobs',
      },
      clamav: { host: 'clamd', port: 3310 },
      host: '0.0.0.0',
      inbound: { maxEmailBytes: 30_000_000 },
      intake: { domain: 'intake.invalid' },
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

  it('validates the blob storage directory and quota', () => {
    expect(
      loadRuntimeConfiguration({
        BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION: '2048',
        BAP_BLOB_STORAGE_DIR: '/blobs',
      }).blob,
    ).toEqual({ quotaBytesPerOrganization: 2048, storageDirectory: '/blobs' });
    expect(() =>
      loadRuntimeConfiguration({ BAP_BLOB_STORAGE_DIR: ' ' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({ BAP_BLOB_STORAGE_DIR: 'relative' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({ BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION: '0' }),
    ).toThrow('Invalid runtime configuration');
    expect(() =>
      loadRuntimeConfiguration({
        BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION: '1.5',
      }),
    ).toThrow('Invalid runtime configuration');
  });

  it('validates the scanner address and the intake domain', () => {
    const configuration = loadRuntimeConfiguration({
      BAP_CLAMAV_HOST: 'scanner',
      BAP_CLAMAV_PORT: '3311',
      BAP_INTAKE_DOMAIN: 'In.Example.Org',
    });
    expect(configuration.clamav).toEqual({ host: 'scanner', port: 3311 });
    expect(configuration.intake).toEqual({ domain: 'in.example.org' });

    for (const domain of [
      ' ',
      'in example.org',
      'https://in.example.org',
      'in.example.org:25',
      '-bad.example.org',
    ]) {
      expect(() =>
        loadRuntimeConfiguration({ BAP_INTAKE_DOMAIN: domain }),
      ).toThrow('Invalid runtime configuration');
    }
    expect(() => loadRuntimeConfiguration({ BAP_CLAMAV_PORT: '0' })).toThrow(
      'Invalid runtime configuration',
    );
    expect(() => loadRuntimeConfiguration({ BAP_CLAMAV_HOST: ' ' })).toThrow(
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
