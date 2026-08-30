import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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
  return join(directory, uploadIdentifierSchema.parse(uploadId));
}

export async function createStagingDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o750, recursive: true });
}

// Called on the success and the failure path; an already missing file is the intended end state.
export async function deleteStagedFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
