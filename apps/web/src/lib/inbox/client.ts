import { organizationPath } from '../datasets/client';
import { inboxUploadResponseSchema } from './contract.ts';

// The inbox BFF shapes the browser may ask for, all fixed paths under one organization.
export function inboxPath(organizationId: string): string {
  return `${organizationPath(organizationId)}/inbox`;
}

export function inboxUploadsPath(organizationId: string): string {
  return `${inboxPath(organizationId)}/uploads`;
}

export function inboxItemsPath(
  organizationId: string,
  query?: URLSearchParams,
): string {
  const search = query === undefined ? '' : query.toString();
  return `${inboxPath(organizationId)}/items${search.length === 0 ? '' : `?${search}`}`;
}

export function inboxItemPath(organizationId: string, itemId: string): string {
  return `${inboxItemsPath(organizationId)}/${encodeURIComponent(itemId)}`;
}

export type InboxItemAction =
  | 'assign'
  | 'discard'
  | 'hints'
  | 'process'
  | 'restore'
  | 'route/document'
  | 'route/undo'
  | 'snooze';

export function inboxItemActionPath(
  organizationId: string,
  itemId: string,
  action: InboxItemAction,
): string {
  return `${inboxItemPath(organizationId, itemId)}/${action}`;
}

export function inboxBlobDownloadPath(
  organizationId: string,
  blobId: string,
): string {
  return `${inboxPath(organizationId)}/blobs/${encodeURIComponent(blobId)}/download`;
}

export function inboxBlobInlinePath(
  organizationId: string,
  blobId: string,
): string {
  return `${inboxPath(organizationId)}/blobs/${encodeURIComponent(blobId)}/inline`;
}

export type UploadOutcome =
  | Readonly<{ itemId: string; kind: 'created' }>
  | Readonly<{ duplicateOfItemId: string; itemId: string; kind: 'duplicate' }>
  | Readonly<{ kind: 'refused'; reason: UploadRefusal }>;

// The API answers 413 for an oversized file and for an exhausted quota alike.
export type UploadRefusal = 'too_large' | 'denied' | 'failed';

// One request per file, so a refused file never takes the others down with it.
export async function uploadInboxFile(
  organizationId: string,
  file: File,
): Promise<UploadOutcome> {
  const body = new FormData();
  body.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(inboxUploadsPath(organizationId), {
      body,
      cache: 'no-store',
      method: 'POST',
    });
  } catch {
    return { kind: 'refused', reason: 'failed' };
  }

  if (!response.ok) {
    return { kind: 'refused', reason: refusalReason(response.status) };
  }

  let payload: ReturnType<typeof inboxUploadResponseSchema.parse>;
  try {
    payload = inboxUploadResponseSchema.parse(await response.json());
  } catch {
    return { kind: 'refused', reason: 'failed' };
  }

  return payload.duplicateOfItemId === null
    ? { itemId: payload.item.id, kind: 'created' }
    : {
        duplicateOfItemId: payload.duplicateOfItemId,
        itemId: payload.item.id,
        kind: 'duplicate',
      };
}

function refusalReason(status: number): UploadRefusal {
  if (status === 413) {
    return 'too_large';
  }
  if (status === 401 || status === 403) {
    return 'denied';
  }
  return 'failed';
}
