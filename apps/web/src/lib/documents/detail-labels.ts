import type { DocumentSummary } from './contract.ts';

// One translation key per source value, so the summary never prints the raw code.
export const documentSourceLabelKeys: Readonly<
  Record<DocumentSummary['source'], string>
> = {
  api: 'documents.detail.sourceApi',
  import: 'documents.detail.sourceImport',
  manual: 'documents.detail.sourceManual',
  upload: 'documents.detail.sourceUpload',
};
