import { createDocumentRequestSchema } from '../../documents/contract.js';
import type { CreateDocumentRequest } from '../../documents/contract.js';
import type { ProviderOutput } from '../contract.js';

export const MANUAL_PROVIDER = 'manual';
export const MANUAL_PROVIDER_VERSION = '2026-09-16.1';

export interface ManualDraft {
  document: CreateDocumentRequest;
  output: ProviderOutput;
}

// A person filled the draft, so every field carries the confidence a person implies: 1.
export function manualProvider(draft: unknown): ManualDraft {
  return manualDraft(createDocumentRequestSchema.parse(draft));
}

// The verdict for a document already validated, or one a parsed route completes from the stored row.
export function manualDraft(document: CreateDocumentRequest): ManualDraft {
  const fieldConfidences = Object.fromEntries(
    Object.keys(document).map((key) => [key, 1]),
  );

  return {
    document,
    output: {
      confidence: 1,
      detectedType: document.kind,
      draft: document,
      fieldConfidences,
      issues: [],
      legalEntityId: document.legalEntityId,
      partnerId: document.partnerId,
      reasons: [
        {
          evidence: 'A person confirmed the draft.',
          step: 'manual',
          weight: 1,
        },
      ],
    },
  };
}
