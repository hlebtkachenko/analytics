import { createReadStream } from 'node:fs';
import { chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { organizationIdentifierSchema } from '@bap/security';

// The volume root is shared with the backup one-shot through the group, so group access is part of the contract.
export const BLOB_DIRECTORY_MODE = 0o770;
export const BLOB_FILE_MODE = 0o660;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// Derived from the tenant id and the content hash only, never from a filename, so no upload can steer a path.
export function blobStorageKey(organizationId: string, sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error('A blob key needs a lowercase hex sha256.');
  }

  return `org/${organizationIdentifierSchema.parse(organizationId)}/${sha256}`;
}

export interface BlobStat {
  byteSize: number;
}

export interface ReadRange {
  end: number;
  start: number;
}

export interface PutBlobInput {
  key: string;
  // Already hashed and sized by the caller; the store only moves the bytes into place.
  temporaryPath: string;
}

export abstract class BlobStore {
  abstract delete(key: string): Promise<void>;
  // Multer names its own temporary file, so the store proves containment instead of trusting the caller.
  abstract deleteTemporary(path: string): Promise<void>;
  abstract open(key: string, range?: ReadRange): Readable;
  abstract put(input: PutBlobInput): Promise<void>;
  abstract stat(key: string): Promise<BlobStat | null>;
  // The temporary directory lives on the same volume so the final rename is atomic.
  abstract temporaryDirectory(): string;
}

export class FilesystemBlobStore extends BlobStore {
  constructor(private readonly directory: string) {
    super();
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch(() => undefined);
  }

  async deleteTemporary(path: string): Promise<void> {
    const temporary = this.temporaryDirectory();
    const contained = relative(resolve(temporary), resolve(path));

    if (
      contained === '' ||
      contained.startsWith('..') ||
      contained.includes('/')
    ) {
      return;
    }

    await unlink(join(temporary, contained)).catch(() => undefined);
  }

  open(key: string, range?: ReadRange): Readable {
    return createReadStream(this.resolveKey(key), range);
  }

  async put(input: PutBlobInput): Promise<void> {
    const target = this.resolveKey(input.key);
    await mkdir(resolve(target, '..'), {
      mode: BLOB_DIRECTORY_MODE,
      recursive: true,
    });
    await rename(input.temporaryPath, target);
    // The temporary file inherited the writer's umask, so the group bits are set explicitly.
    await chmod(target, BLOB_FILE_MODE);
  }

  async stat(key: string): Promise<BlobStat | null> {
    try {
      const information = await stat(this.resolveKey(key));
      return information.isFile() ? { byteSize: information.size } : null;
    } catch {
      return null;
    }
  }

  temporaryDirectory(): string {
    return join(this.directory, 'tmp');
  }

  // Belt and braces: the key derivation already cannot escape, and the sink refuses anything that did.
  private resolveKey(key: string): string {
    const target = join(this.directory, key);
    const contained = relative(resolve(this.directory), resolve(target));

    if (
      contained === '' ||
      contained.startsWith('..') ||
      !contained.startsWith('org/')
    ) {
      throw new Error('Blob key escaped the storage directory.');
    }

    return target;
  }
}

export async function createBlobDirectories(directory: string): Promise<void> {
  await mkdir(join(directory, 'tmp'), {
    mode: BLOB_DIRECTORY_MODE,
    recursive: true,
  });
  await mkdir(join(directory, 'org'), {
    mode: BLOB_DIRECTORY_MODE,
    recursive: true,
  });
}
