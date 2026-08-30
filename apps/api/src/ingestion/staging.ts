import { mkdir, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { z } from 'zod';

import { uploadIdentifierSchema } from './contract.js';

type Environment = Record<string, string | undefined>;

const DEFAULT_STAGING_DIRECTORY = '/var/lib/bap/uploads';

const stagingEnvironmentSchema = z.object({
  BAP_UPLOAD_STAGING_DIR: z.string().trim().min(1).startsWith('/').optional(),
});

export function loadStagingDirectory(environment: Environment): string {
  const parsed = stagingEnvironmentSchema.parse(environment);
  return parsed.BAP_UPLOAD_STAGING_DIR ?? DEFAULT_STAGING_DIRECTORY;
}

// The staged path is derived from the server generated upload id and never from the uploaded filename.
// A uuid matches [0-9a-fA-F-] only, so it can carry no separator, no traversal segment and no null byte.
export function resolveStagedFilePath(
  directory: string,
  uploadId: string,
): string {
  const staged = join(directory, uploadIdentifierSchema.parse(uploadId));
  const contained = relative(resolve(directory), resolve(staged));

  // Belt and braces: the uuid already cannot escape, and the sink refuses anything that did.
  if (contained.startsWith('..') || contained.includes('/')) {
    throw new Error('Staged upload path escaped the staging directory.');
  }

  return staged;
}

export async function createStagingDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o750, recursive: true });
}

// Multer names its own temporary file, so this sink proves containment instead of trusting the caller.
export async function deleteTemporaryUpload(
  directory: string,
  path: string,
): Promise<void> {
  const contained = relative(resolve(directory), resolve(path));

  if (
    contained === '' ||
    contained.startsWith('..') ||
    contained.includes('/')
  ) {
    return;
  }

  await unlink(join(directory, contained)).catch(() => undefined);
}

// Takes the id rather than a path so the only way to name the file is through the validated derivation.
// Called on the success and the failure path; an already missing file is the intended end state.
export async function deleteStagedFile(
  directory: string,
  uploadId: string,
): Promise<void> {
  await unlink(resolveStagedFilePath(directory, uploadId)).catch(
    () => undefined,
  );
}
