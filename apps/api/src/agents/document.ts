import { createHash } from 'node:crypto';

// Bounds one embedding request; a dataset profile far longer than this carries no extra signal.
const MAX_DOCUMENT_LENGTH = 2_000;

export interface DatasetProfile {
  columns: string;
  description: string;
  name: string;
}

// Metadata only: names, types and the description. No stored cell value ever reaches the provider.
export function renderDatasetDocument(profile: DatasetProfile): string {
  return [
    `name: ${profile.name}`,
    `description: ${profile.description}`,
    `columns: ${profile.columns}`,
  ]
    .join('\n')
    .slice(0, MAX_DOCUMENT_LENGTH);
}

// The stored hash is of the exact embedded text, so a backfill re-embeds only what changed.
export function hashDocument(document: string): string {
  return createHash('sha256').update(document).digest('hex');
}
