import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-configuration.js';

describe('loadRuntimeConfiguration', () => {
  it('uses the reporting API defaults', () => {
    expect(loadRuntimeConfiguration({})).toEqual({
      host: '0.0.0.0',
      port: 3002,
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
});
