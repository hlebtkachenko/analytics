import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  blobStorageKey,
  createBlobDirectories,
  FilesystemBlobStore,
} from './blob-store.js';

const SHA256 = 'a'.repeat(64);
const KEY = `org/organization_1/${SHA256}`;

async function collect(
  stream: AsyncIterable<Buffer | string>,
): Promise<string> {
  let text = '';

  for await (const chunk of stream) {
    text += chunk.toString();
  }

  return text;
}

describe('blobStorageKey', () => {
  it('derives the key from the organization and the hash only', () => {
    expect(blobStorageKey('organization_1', SHA256)).toBe(KEY);
  });

  it.each(['A'.repeat(64), 'abc', '../etc/passwd', ''])(
    'refuses %s as a hash',
    (candidate) => {
      expect(() => blobStorageKey('organization_1', candidate)).toThrow();
    },
  );
});

describe('FilesystemBlobStore', () => {
  let directory: string;
  let store: FilesystemBlobStore;
  let previousUmask: number;

  beforeAll(async () => {
    previousUmask = process.umask(0o007);
    directory = await mkdtemp(join(tmpdir(), 'bap-blobs-'));
    await createBlobDirectories(directory);
    store = new FilesystemBlobStore(directory);
  });

  afterAll(async () => {
    process.umask(previousUmask);
    await rm(directory, { force: true, recursive: true });
  });

  it('moves a temporary file into its content-addressed path with group access', async () => {
    const temporaryPath = join(store.temporaryDirectory(), 'upload-1');
    await writeFile(temporaryPath, 'placeholder bytes');

    await store.put({ key: KEY, temporaryPath });

    const stored = join(directory, KEY);
    expect(await readFile(stored, 'utf8')).toBe('placeholder bytes');
    expect((await stat(stored)).mode & 0o777).toBe(0o660);
    expect(
      (await stat(join(directory, 'org/organization_1'))).mode & 0o777,
    ).toBe(0o770);
    await expect(stat(temporaryPath)).rejects.toThrow();
    expect(await store.stat(KEY)).toEqual({ byteSize: 17 });
  });

  it('opens the whole file or a byte range', async () => {
    expect(await collect(store.open(KEY))).toBe('placeholder bytes');
    expect(await collect(store.open(KEY, { end: 10, start: 0 }))).toBe(
      'placeholder',
    );
  });

  it('answers a missing key with null', async () => {
    const missing = `org/organization_1/${'b'.repeat(64)}`;
    expect(await store.stat(missing)).toBeNull();
  });

  it.each(['../outside', 'tmp/upload-1', '/etc/passwd', 'org', ''])(
    'refuses the key %s',
    async (key) => {
      await expect(store.stat(key)).resolves.toBeNull();
      expect(() => store.open(key)).toThrow();
    },
  );
});

describe('orphan sweep support', () => {
  it('lists organizations, the stale content-addressed files of one, and unlinks by key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-blobs-'));
    await createBlobDirectories(directory);
    const store = new FilesystemBlobStore(directory);
    const organization = join(directory, 'org', 'organization_1');
    await mkdir(organization);
    await mkdir(join(directory, 'org', 'not a tenant'));
    await mkdir(join(directory, 'org', 'organization_2'));
    const old = 'c'.repeat(64);
    const young = 'd'.repeat(64);
    await writeFile(join(organization, old), 'old');
    await writeFile(join(organization, young), 'young');
    await writeFile(join(organization, 'notes.txt'), 'not a blob');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(organization, old), twoHoursAgo, twoHoursAgo);
    await utimes(join(organization, 'notes.txt'), twoHoursAgo, twoHoursAgo);
    const olderThan = new Date(Date.now() - 60 * 60 * 1000);

    expect(await store.listOrganizations()).toEqual([
      'organization_1',
      'organization_2',
    ]);
    expect(await store.listStale('organization_1', olderThan, 1000)).toEqual([
      { key: `org/organization_1/${old}`, sha256: old },
    ]);
    expect(await store.listStale('organization_1', olderThan, 0)).toEqual([]);
    expect(await store.listStale('organization_2', olderThan, 1000)).toEqual(
      [],
    );

    await store.unlink(`org/organization_1/${old}`);
    await expect(stat(join(organization, old))).rejects.toThrow();
    expect((await stat(join(organization, young))).isFile()).toBe(true);
    await expect(store.unlink('tmp/anything')).rejects.toThrow();
    await rm(directory, { force: true, recursive: true });
  });
});

describe('deleteTemporary', () => {
  it('removes only a file inside the temporary directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-blobs-'));
    await createBlobDirectories(directory);
    const store = new FilesystemBlobStore(directory);
    const inside = join(directory, 'tmp', 'upload-2');
    const outside = join(directory, 'outside');
    await writeFile(inside, 'x');
    await writeFile(outside, 'x');

    await store.deleteTemporary(inside);
    await store.deleteTemporary(outside);
    await store.deleteTemporary(join(directory, 'tmp', '..', 'outside'));

    await expect(stat(inside)).rejects.toThrow();
    expect((await stat(outside)).isFile()).toBe(true);
    await rm(directory, { force: true, recursive: true });
  });
});
