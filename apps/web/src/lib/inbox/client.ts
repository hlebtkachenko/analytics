import { organizationPath } from '../datasets/client';
import {
  bulkInboxItemsResponseSchema,
  inboxItemDetailSchema,
  inboxRouteConflictSchema,
  inboxRoutingTargetSchema,
  inboxRuleListResponseSchema,
  inboxRuleRefusalCodeSchema,
  inboxRuleSchema,
  inboxSettingsSchema,
  inboxUploadResponseSchema,
} from './contract.ts';
import type {
  BulkInboxItemsRequest,
  BulkInboxItemsResponse,
  CreateInboxRuleRequest,
  InboxRouteConflict,
  InboxRoutingTarget,
  InboxRule,
  InboxRuleRefusalCode,
  InboxSettings,
  PutInboxRoutingTargetRequest,
  PutInboxRuleOrderRequest,
  RouteInboxItemToDocumentRequest,
  UpdateInboxRuleRequest,
  UpdateInboxSettingsRequest,
} from './contract.ts';

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

export function inboxItemsBulkPath(organizationId: string): string {
  return `${inboxItemsPath(organizationId)}/bulk`;
}

export type InboxItemAction =
  | 'assign'
  | 'attach'
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

export type RouteOutcome =
  | Readonly<{ kind: 'routed' }>
  | Readonly<{ conflict: InboxRouteConflict; kind: 'conflict' }>
  | Readonly<{ kind: 'failed' }>;

// A route may answer 409 with a named conflict the page must resolve, so it is not folded into a failure.
export async function routeInboxItemToDocument(
  organizationId: string,
  itemId: string,
  body: RouteInboxItemToDocumentRequest,
): Promise<RouteOutcome> {
  let response: Response;
  try {
    response = await fetch(
      inboxItemActionPath(organizationId, itemId, 'route/document'),
      {
        body: JSON.stringify(body),
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 409) {
    try {
      const conflict = inboxRouteConflictSchema.safeParse(
        await response.json(),
      );
      return conflict.success
        ? { conflict: conflict.data, kind: 'conflict' }
        : { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }
  if (!response.ok) {
    return { kind: 'failed' };
  }
  try {
    inboxItemDetailSchema.parse(await response.json());
    return { kind: 'routed' };
  } catch {
    return { kind: 'failed' };
  }
}

// The answer is per id with HTTP 200 whatever the mix, so the page counts it rather than trusting a status.
export async function bulkInboxItems(
  organizationId: string,
  body: BulkInboxItemsRequest,
): Promise<BulkInboxItemsResponse> {
  const response = await fetch(inboxItemsBulkPath(organizationId), {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return bulkInboxItemsResponseSchema.parse(await response.json());
}

export function inboxChannelsPath(organizationId: string): string {
  return `${inboxPath(organizationId)}/channels`;
}

export function inboxChannelPath(
  organizationId: string,
  channelId: string,
): string {
  return `${inboxChannelsPath(organizationId)}/${encodeURIComponent(channelId)}`;
}

export function inboxChannelCredentialsPath(
  organizationId: string,
  channelId: string,
): string {
  return `${inboxChannelPath(organizationId, channelId)}/credentials`;
}

export function inboxChannelCredentialPath(
  organizationId: string,
  channelId: string,
  credentialId: string,
): string {
  return `${inboxChannelCredentialsPath(organizationId, channelId)}/${encodeURIComponent(credentialId)}`;
}

export function inboxRoutingTargetsPath(organizationId: string): string {
  return `${inboxPath(organizationId)}/routing-targets`;
}

export function inboxRoutingTargetPath(
  organizationId: string,
  detectedType: string,
): string {
  return `${inboxRoutingTargetsPath(organizationId)}/${encodeURIComponent(detectedType)}`;
}

export function inboxSettingsPath(organizationId: string): string {
  return `${inboxPath(organizationId)}/settings`;
}

export function inboxRulesPath(organizationId: string): string {
  return `${inboxPath(organizationId)}/rules`;
}

export function inboxRulePath(organizationId: string, ruleId: string): string {
  return `${inboxRulesPath(organizationId)}/${encodeURIComponent(ruleId)}`;
}

export function inboxRuleAdoptPath(
  organizationId: string,
  ruleId: string,
): string {
  return `${inboxRulePath(organizationId, ruleId)}/adopt`;
}

export function inboxRuleOrderPath(organizationId: string): string {
  return `${inboxRulesPath(organizationId)}/order`;
}

export type RuleWriteOutcome =
  | Readonly<{ kind: 'saved'; rule: InboxRule }>
  | Readonly<{ kind: 'refused'; code: InboxRuleRefusalCode }>
  | Readonly<{ kind: 'failed' }>;

// A create or edit may be refused with a named 422 code, which the page names rather than folding into a failure.
async function writeInboxRule(
  path: string,
  method: 'PATCH' | 'POST',
  body: CreateInboxRuleRequest | UpdateInboxRuleRequest,
): Promise<RuleWriteOutcome> {
  let response: Response;
  try {
    response = await fetch(path, {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method,
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 422) {
    let code: unknown;
    try {
      code = ((await response.json()) as { code?: unknown }).code;
    } catch {
      return { kind: 'failed' };
    }
    const parsed = inboxRuleRefusalCodeSchema.safeParse(code);
    return parsed.success
      ? { code: parsed.data, kind: 'refused' }
      : { kind: 'failed' };
  }
  if (!response.ok) {
    return { kind: 'failed' };
  }
  try {
    return {
      kind: 'saved',
      rule: inboxRuleSchema.parse(await response.json()),
    };
  } catch {
    return { kind: 'failed' };
  }
}

export async function createInboxRule(
  organizationId: string,
  body: CreateInboxRuleRequest,
): Promise<RuleWriteOutcome> {
  return await writeInboxRule(inboxRulesPath(organizationId), 'POST', body);
}

export async function updateInboxRule(
  organizationId: string,
  ruleId: string,
  body: UpdateInboxRuleRequest,
): Promise<RuleWriteOutcome> {
  return await writeInboxRule(
    inboxRulePath(organizationId, ruleId),
    'PATCH',
    body,
  );
}

// The order is the whole list, so the shared mutation helper's verbs do not fit; the answer is the reordered list.
export async function saveInboxRuleOrder(
  organizationId: string,
  body: PutInboxRuleOrderRequest,
): Promise<InboxRule[]> {
  const response = await fetch(inboxRuleOrderPath(organizationId), {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return inboxRuleListResponseSchema.parse(await response.json()).rules;
}

// A PUT carries the whole target, so the shared mutation helper's verbs do not fit; this is the one PUT the inbox makes.
export async function saveInboxRoutingTarget(
  organizationId: string,
  detectedType: string,
  body: PutInboxRoutingTargetRequest,
): Promise<InboxRoutingTarget> {
  const response = await fetch(
    inboxRoutingTargetPath(organizationId, detectedType),
    {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    },
  );
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return inboxRoutingTargetSchema.parse(await response.json());
}

export type SettingsOutcome =
  | Readonly<{ kind: 'saved'; settings: InboxSettings }>
  | Readonly<{ kind: 'above_cap' }>
  | Readonly<{ kind: 'failed' }>;

// The API answers 422 for a quota above the platform cap, which the page names rather than folding into a failure.
export async function updateInboxSettings(
  organizationId: string,
  body: UpdateInboxSettingsRequest,
): Promise<SettingsOutcome> {
  let response: Response;
  try {
    response = await fetch(inboxSettingsPath(organizationId), {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 422) {
    return { kind: 'above_cap' };
  }
  if (!response.ok) {
    return { kind: 'failed' };
  }
  try {
    return {
      kind: 'saved',
      settings: inboxSettingsSchema.parse(await response.json()),
    };
  } catch {
    return { kind: 'failed' };
  }
}

// The public push route lives at a fixed path on the same origin the owner is signed into.
export function intakeCurlExample(origin: string, secret: string): string {
  return `curl -X POST ${origin}/api/intake/v1/items -H "Authorization: Bearer ${secret}" -F file=@invoice.pdf`;
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
