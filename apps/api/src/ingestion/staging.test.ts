import { describe, expect, it } from 'vitest';

import { loadStagingDirectory, resolveStagedFilePath } from './staging.js';

const directory = '/var/lib/bap/uploads';

describe('loadStagingDirectory', () => {
  it('defaults to the mounted volume and demands an absolute override', () => {
    expect(loadStagingDirectory({})).toBe(directory);
    expect(loadStagingDirectory({ BAP_UPLOAD_STAGING_DIR: '/staging' })).toBe(
      '/staging',
    );
    expect(() =>
      loadStagingDirectory({ BAP_UPLOAD_STAGING_DIR: 'relative' }),
    ).toThrow();
  });
});

describe('resolveStagedFilePath', () => {
  it('derives the path from the upload id alone', () => {
    expect(
      resolveStagedFilePath(directory, '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77'),
    ).toBe(`${directory}/2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77`);
  });

  it.each([
    ['a traversal segment', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a separator', 'a/b'],
    ['a null byte', '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77\u0000.csv'],
    ['a filename', 'report.csv'],
    ['an empty value', ''],
  ])('refuses %s instead of an upload id', (_name, candidate) => {
    expect(() => resolveStagedFilePath(directory, candidate)).toThrow();
  });
});
