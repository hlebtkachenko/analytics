import { randomUUID } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deleteStagedFile,
  deleteTemporaryUpload,
  loadStagingDirectory,
  resolveStagedFilePath,
} from './staging.js';

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

describe('deleteStagedFile', () => {
  it('removes only the file its own derivation names', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bap-staging-'));
    const uploadId = randomUUID();
    const staged = join(base, uploadId);
    const neighbour = join(base, 'keep.txt');
    await writeFile(staged, 'staged');
    await writeFile(neighbour, 'keep');

    await deleteStagedFile(base, uploadId);

    await expect(stat(staged)).rejects.toThrow();
    await expect(stat(neighbour)).resolves.toBeDefined();
  });

  it('refuses an id that is not an upload id', async () => {
    await expect(
      deleteStagedFile('/var/lib/bap/uploads', '../etc'),
    ).rejects.toThrow();
  });
});

describe('deleteTemporaryUpload', () => {
  it('removes a temporary file inside the staging directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bap-staging-'));
    const temporary = join(base, 'a1b2c3d4');
    await writeFile(temporary, 'temporary');

    await deleteTemporaryUpload(base, temporary);

    await expect(stat(temporary)).rejects.toThrow();
  });

  it('ignores a path outside the staging directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bap-staging-'));
    const outside = join(await mkdtemp(join(tmpdir(), 'bap-other-')), 'victim');
    await writeFile(outside, 'victim');

    await deleteTemporaryUpload(base, outside);
    await deleteTemporaryUpload(base, join(base, '..', 'escape'));

    await expect(stat(outside)).resolves.toBeDefined();
  });
});
