import { describe, expect, it } from 'vitest';

import { providerReadFile, sectionStatus } from './section-status.ts';

describe('providerReadFile', () => {
  it('treats the machine providers as not having read the file', () => {
    for (const provider of ['sniff', 'rule', 'auto_route']) {
      expect(providerReadFile(provider)).toBe(false);
    }
    expect(providerReadFile(null)).toBe(false);
    expect(providerReadFile(undefined)).toBe(false);
  });

  it('treats any other provider as a real read', () => {
    expect(providerReadFile('isdoc')).toBe(true);
    expect(providerReadFile('ai')).toBe(true);
  });
});

describe('sectionStatus', () => {
  it('is Missing when a required field is empty, whatever else holds', () => {
    expect(
      sectionStatus({
        humanConfirmed: true,
        providerRead: true,
        requiredFilled: false,
      }),
    ).toBe('missing');
  });

  it('is Defaults when everything came from sniff or a rule with no person touch', () => {
    expect(
      sectionStatus({
        humanConfirmed: false,
        providerRead: false,
        requiredFilled: true,
      }),
    ).toBe('defaults');
  });

  it('is Complete when a person confirmed the values', () => {
    expect(
      sectionStatus({
        humanConfirmed: true,
        providerRead: false,
        requiredFilled: true,
      }),
    ).toBe('complete');
  });

  it('is Complete when a real provider read the file', () => {
    expect(
      sectionStatus({
        humanConfirmed: false,
        providerRead: true,
        requiredFilled: true,
      }),
    ).toBe('complete');
  });
});
