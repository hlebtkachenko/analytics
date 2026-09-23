import type { PoolClient } from 'pg';

import { parsedIsdocDraftSchema } from './contract.js';
import type { InboxExtraction, ParsedIsdocDraft } from './contract.js';
import { loadLatestExtraction } from './inbox-repository-support.js';
import { ISDOC_PROVIDER } from './providers/isdoc.js';

// One typed read of the newest ISDOC row; flagged values remain readable, but the stored shape must be sound.
export async function loadParsedDraft(
  transaction: PoolClient,
  itemId: string,
): Promise<(InboxExtraction & { draft: ParsedIsdocDraft }) | null> {
  const extraction = await loadLatestExtraction(
    transaction,
    itemId,
    ISDOC_PROVIDER,
  );
  return extraction === null
    ? null
    : { ...extraction, draft: parsedIsdocDraftSchema.parse(extraction.draft) };
}
