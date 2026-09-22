import { z } from 'zod';

import {
  assignInboxItemRequestSchema,
  attachInboxItemRequestSchema,
  bulkInboxItemsRequestSchema,
  bulkInboxItemsResponseSchema,
  createInboxChannelRequestSchema,
  createInboxRuleRequestSchema,
  discardInboxItemRequestSchema,
  inboxChannelListResponseSchema,
  inboxChannelSchema,
  inboxItemDetailSchema,
  inboxItemListQuerySchema,
  inboxItemListResponseSchema,
  inboxRouteConflictSchema,
  inboxRoutingTargetListResponseSchema,
  inboxRoutingTargetSchema,
  inboxRuleListResponseSchema,
  inboxRuleRefusalCodeSchema,
  inboxRuleSchema,
  inboxSettingsSchema,
  inboxUploadResponseSchema,
  isInlineMediaType,
  issueInboxChannelCredentialResponseSchema,
  putInboxRoutingTargetRequestSchema,
  putInboxRuleOrderRequestSchema,
  routeInboxItemToDocumentRequestSchema,
  snoozeInboxItemRequestSchema,
  tokenSchema,
  updateInboxChannelRequestSchema,
  updateInboxHintsRequestSchema,
  updateInboxRuleRequestSchema,
  updateInboxSettingsRequestSchema,
} from '../../inbox/contract.ts';
import {
  DATASET_EXPORT_HEADER_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  applicationPath,
  callApplicationJson,
  jsonResponse,
  parsedIdentifier,
  prepareApplicationCall,
  privateResponseHeaders,
  readJsonBody,
  upstreamFailure,
} from './core.ts';
import type { BffAuth } from './core.ts';

// Rebuilt from validated values only, so no client query string is forwarded verbatim.
function inboxItemListQuery(
  query: z.infer<typeof inboxItemListQuerySchema>,
): string {
  const outbound = new URLSearchParams();

  if (query.status !== undefined) {
    outbound.set('status', query.status.join(','));
  }
  if (query.detectedType !== undefined) {
    outbound.set('detectedType', query.detectedType);
  }
  if (query.issue !== undefined) {
    outbound.set('issue', query.issue);
  }
  if (query.assigneeId !== undefined) {
    outbound.set('assigneeId', query.assigneeId);
  }
  if (query.confidence !== undefined) {
    outbound.set('confidence', query.confidence);
  }
  outbound.set('page', String(query.page));
  outbound.set('pageSize', String(query.pageSize));

  return outbound.toString();
}

export async function postInboxUpload(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data') || request.body === null) {
    return jsonResponse({ error: 'invalid_upload' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  let response: Response;
  try {
    response = await fetchImplementation(
      applicationPath(prepared.selector, 'inbox/uploads'),
      {
        // The body is forwarded as a stream, so the web service never holds the whole file.
        body: request.body,
        cache: 'no-store',
        duplex: 'half',
        headers: {
          authorization: `Bearer ${prepared.token}`,
          'content-type': contentType,
          'x-bap-request-id': prepared.requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      } as RequestInit & { duplex: 'half' },
    );
  } catch {
    return upstreamFailure('postInboxUpload', 'unreachable');
  }

  if (!response.ok) {
    if (response.status >= 500) {
      return upstreamFailure('postInboxUpload', 'unreachable');
    }

    return jsonResponse({ error: 'upload_rejected' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure('postInboxUpload', 'unreadable');
  }
  const payload = inboxUploadResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    return upstreamFailure('postInboxUpload', 'unexpected_shape');
  }

  return jsonResponse(payload.data, 201, {
    'x-request-id': prepared.requestId,
  });
}

export async function getInboxItems(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = inboxItemListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  // An unsupported filter, an oversized page, or a window beyond the bound is refused, never clamped.
  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_unavailable',
      method: 'GET',
      operation: 'getInboxItems',
      path: `inbox/items?${inboxItemListQuery(query.data)}`,
      schema: inboxItemListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getInboxItem(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(itemId, 'inbox_item_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_item_unavailable',
      method: 'GET',
      operation: 'getInboxItem',
      path: `inbox/items/${encodeURIComponent(selected.value)}`,
      schema: inboxItemDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

type InboxItemWrite = Readonly<{
  action:
    | 'assign'
    | 'attach'
    | 'discard'
    | 'hints'
    | 'process'
    | 'restore'
    | 'route/document'
    | 'route/undo'
    | 'snooze';
  bodySchema: z.ZodType | null;
  conflictSchema?: z.ZodType<Record<string, unknown>>;
  method: 'PATCH' | 'POST';
  operation: string;
}>;

// Every item write answers with the refreshed detail, so one helper covers the whole set.
async function writeInboxItemWith(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  write: InboxItemWrite,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const selected = parsedIdentifier(itemId, 'inbox_item_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  let body: unknown;
  if (write.bodySchema !== null) {
    const parsed = await readJsonBody(request, write.bodySchema);

    if ('failure' in parsed) {
      return parsed.failure;
    }

    body = parsed.data;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      ...(body === undefined ? {} : { body }),
      errorCode: 'inbox_item_rejected',
      method: write.method,
      operation: write.operation,
      ...(write.conflictSchema === undefined
        ? {}
        : { passthroughConflict: write.conflictSchema }),
      path: `inbox/items/${encodeURIComponent(selected.value)}/${write.action}`,
      schema: inboxItemDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

const inboxItemWrites = {
  assign: {
    action: 'assign',
    bodySchema: assignInboxItemRequestSchema,
    method: 'POST',
    operation: 'postInboxItemAssign',
  },
  attach: {
    action: 'attach',
    bodySchema: attachInboxItemRequestSchema,
    method: 'POST',
    operation: 'postInboxItemAttach',
  },
  discard: {
    action: 'discard',
    bodySchema: discardInboxItemRequestSchema,
    method: 'POST',
    operation: 'postInboxItemDiscard',
  },
  hints: {
    action: 'hints',
    bodySchema: updateInboxHintsRequestSchema,
    method: 'PATCH',
    operation: 'patchInboxItemHints',
  },
  process: {
    action: 'process',
    bodySchema: null,
    method: 'POST',
    operation: 'postInboxItemProcess',
  },
  restore: {
    action: 'restore',
    bodySchema: null,
    method: 'POST',
    operation: 'postInboxItemRestore',
  },
  routeDocument: {
    action: 'route/document',
    bodySchema: routeInboxItemToDocumentRequestSchema,
    conflictSchema: inboxRouteConflictSchema,
    method: 'POST',
    operation: 'postInboxItemRouteDocument',
  },
  routeUndo: {
    action: 'route/undo',
    bodySchema: null,
    method: 'POST',
    operation: 'postInboxItemRouteUndo',
  },
  snooze: {
    action: 'snooze',
    bodySchema: snoozeInboxItemRequestSchema,
    method: 'POST',
    operation: 'postInboxItemSnooze',
  },
} as const satisfies Record<string, InboxItemWrite>;

export type InboxItemWriteAction = keyof typeof inboxItemWrites;

export async function writeInboxItem(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  action: InboxItemWriteAction,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItemWith(
    auth,
    request,
    organizationId,
    itemId,
    inboxItemWrites[action],
    fetchImplementation,
  );
}

// One request per page of ids; the answer names every id, so a refusal never hides another.
export async function postInboxItemsBulk(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsed = await readJsonBody(request, bulkInboxItemsRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_bulk_rejected',
      method: 'POST',
      operation: 'postInboxItemsBulk',
      path: 'inbox/items/bulk',
      schema: bulkInboxItemsResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// The media type the API sniffed: a bare type and subtype, nothing a browser could be steered by.
const blobMediaTypeSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/,
  );

// The upstream filename is re-sanitised here and never forwarded verbatim: ASCII only, no quote, no separator.
function blobDispositionFilename(
  upstreamDisposition: string | null,
  blobId: string,
): string {
  const match = /filename="([^"]*)"/.exec(upstreamDisposition ?? '');
  const sanitised = (match?.[1] ?? '')
    .replaceAll(/[^\x20-\x7e]/g, '')
    .replaceAll(/["\\/;]/g, '')
    .trim()
    .slice(0, 255);

  return sanitised.length > 0 ? sanitised : `blob-${blobId}`;
}

// The two 409 codes of the blob routes; an unreadable body falls back to the quarantine code.
async function blobConflictCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const code = (body as { code?: unknown } | null)?.code;
  return code === 'blob_scan_pending'
    ? 'blob_scan_pending'
    : 'blob_quarantined';
}

async function streamInboxBlob(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  blobId: string,
  inline: boolean,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const selected = parsedIdentifier(blobId, 'blob_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  const operation = inline ? 'getInboxBlobInline' : 'getInboxBlobDownload';
  // Bounds the wait for the response head only, so a long download is never cut off mid stream.
  const controller = new AbortController();
  const headerTimeout = setTimeout(() => {
    controller.abort();
  }, DATASET_EXPORT_HEADER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImplementation(
      applicationPath(
        prepared.selector,
        `inbox/blobs/${encodeURIComponent(selected.value)}/${inline ? 'inline' : 'download'}`,
      ),
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${prepared.token}`,
          'x-bap-request-id': prepared.requestId,
        },
        signal: controller.signal,
      },
    );
  } catch {
    return upstreamFailure(operation, 'unreachable');
  } finally {
    clearTimeout(headerTimeout);
  }

  if (!response.ok) {
    if (response.status >= 500) {
      return upstreamFailure(operation, 'unreachable');
    }

    // The API's 409 is the scan gate: quarantined for a bad verdict, pending while the scan has not answered.
    return jsonResponse(
      {
        error:
          response.status === 409
            ? await blobConflictCode(response)
            : 'blob_rejected',
      },
      response.status,
    );
  }

  const mediaType = blobMediaTypeSchema.safeParse(
    (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase(),
  );

  // Inline is a closed list even if the API were to widen it: anything else must never render in a frame.
  if (
    !mediaType.success ||
    response.body === null ||
    (inline && !isInlineMediaType(mediaType.data))
  ) {
    return upstreamFailure(operation, 'unexpected_media_type');
  }

  const filename = blobDispositionFilename(
    response.headers.get('content-disposition'),
    selected.value,
  );

  // Every header is minted here, so no upstream header reaches the browser.
  return new Response(response.body, {
    headers: {
      ...privateResponseHeaders,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'content-type': mediaType.data,
      // A sandboxed context disables plugins, and Chromium's PDF viewer is one, so only images carry the sandbox.
      ...(inline && mediaType.data !== 'application/pdf'
        ? { 'content-security-policy': 'sandbox' }
        : {}),
      'x-content-type-options': 'nosniff',
      'x-request-id': prepared.requestId,
    },
    status: 200,
  });
}

export async function getInboxBlobDownload(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  blobId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await streamInboxBlob(
    auth,
    request,
    organizationId,
    blobId,
    false,
    fetchImplementation,
  );
}

export async function getInboxBlobInline(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  blobId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await streamInboxBlob(
    auth,
    request,
    organizationId,
    blobId,
    true,
    fetchImplementation,
  );
}

export async function getInboxChannels(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_channels_unavailable',
      method: 'GET',
      operation: 'getInboxChannels',
      path: 'inbox/channels',
      schema: inboxChannelListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postInboxChannel(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsed = await readJsonBody(request, createInboxChannelRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_channel_rejected',
      method: 'POST',
      operation: 'postInboxChannel',
      path: 'inbox/channels',
      schema: inboxChannelSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function getInboxChannel(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  channelId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(channelId, 'inbox_channel_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_channel_unavailable',
      method: 'GET',
      operation: 'getInboxChannel',
      path: `inbox/channels/${encodeURIComponent(selected.value)}`,
      schema: inboxChannelSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function patchInboxChannel(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  channelId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(channelId, 'inbox_channel_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const parsed = await readJsonBody(request, updateInboxChannelRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_channel_rejected',
      method: 'PATCH',
      operation: 'patchInboxChannel',
      path: `inbox/channels/${encodeURIComponent(selected.value)}`,
      schema: inboxChannelSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// The plain secret passes through this response once and is never logged or stored here.
export async function postInboxChannelCredential(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  channelId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(channelId, 'inbox_channel_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_credential_rejected',
      method: 'POST',
      operation: 'postInboxChannelCredential',
      path: `inbox/channels/${encodeURIComponent(selected.value)}/credentials`,
      schema: issueInboxChannelCredentialResponseSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function deleteInboxChannelCredential(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  channelId: string,
  credentialId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selectedChannel = parsedIdentifier(
    channelId,
    'inbox_channel_not_found',
  );

  if ('failure' in selectedChannel) {
    return selectedChannel.failure;
  }

  const selectedCredential = parsedIdentifier(
    credentialId,
    'inbox_credential_not_found',
  );

  if ('failure' in selectedCredential) {
    return selectedCredential.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_credential_rejected',
      method: 'DELETE',
      operation: 'deleteInboxChannelCredential',
      path: `inbox/channels/${encodeURIComponent(selectedChannel.value)}/credentials/${encodeURIComponent(selectedCredential.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

// A detected type is a token; anything else answers like a type that has no target.
function parsedDetectedType(
  value: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = tokenSchema.safeParse(value);

  return parsed.success
    ? { value: parsed.data }
    : {
        failure: jsonResponse({ error: 'inbox_routing_target_not_found' }, 404),
      };
}

export async function getInboxRoutingTargets(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_routing_targets_unavailable',
      method: 'GET',
      operation: 'getInboxRoutingTargets',
      path: 'inbox/routing-targets',
      schema: inboxRoutingTargetListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// The body is the whole target, so a one-field edit never resets the rest of the row.
export async function putInboxRoutingTarget(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  detectedType: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedDetectedType(detectedType);

  if ('failure' in selected) {
    return selected.failure;
  }

  const parsed = await readJsonBody(
    request,
    putInboxRoutingTargetRequestSchema,
  );

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_routing_target_rejected',
      method: 'PUT',
      operation: 'putInboxRoutingTarget',
      path: `inbox/routing-targets/${encodeURIComponent(selected.value)}`,
      schema: inboxRoutingTargetSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function deleteInboxRoutingTarget(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  detectedType: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedDetectedType(detectedType);

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_routing_target_rejected',
      method: 'DELETE',
      operation: 'deleteInboxRoutingTarget',
      path: `inbox/routing-targets/${encodeURIComponent(selected.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

export async function getInboxSettings(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_settings_unavailable',
      method: 'GET',
      operation: 'getInboxSettings',
      path: 'inbox/settings',
      schema: inboxSettingsSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// A quota above the platform cap comes back as the API's 422 under the rejection code.
export async function patchInboxSettings(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsed = await readJsonBody(request, updateInboxSettingsRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_settings_rejected',
      method: 'PATCH',
      operation: 'patchInboxSettings',
      path: 'inbox/settings',
      schema: inboxSettingsSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getInboxRules(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_rules_unavailable',
      method: 'GET',
      operation: 'getInboxRules',
      path: 'inbox/rules',
      schema: inboxRuleListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// A 422 carries rule_limit or not_available beside the rejection code, so the page can name the refusal.
export async function postInboxRule(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsed = await readJsonBody(request, createInboxRuleRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_rule_rejected',
      method: 'POST',
      operation: 'postInboxRule',
      passthroughCodes: inboxRuleRefusalCodeSchema,
      path: 'inbox/rules',
      schema: inboxRuleSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function patchInboxRule(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  ruleId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(ruleId, 'inbox_rule_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const parsed = await readJsonBody(request, updateInboxRuleRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_rule_rejected',
      method: 'PATCH',
      operation: 'patchInboxRule',
      passthroughCodes: inboxRuleRefusalCodeSchema,
      path: `inbox/rules/${encodeURIComponent(selected.value)}`,
      schema: inboxRuleSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// A delete is soft upstream; the browser only learns that the rule is gone from the list.
export async function deleteInboxRule(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  ruleId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(ruleId, 'inbox_rule_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_rule_rejected',
      method: 'DELETE',
      operation: 'deleteInboxRule',
      path: `inbox/rules/${encodeURIComponent(selected.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

// The body is the whole ordered id list, so one reorder is one statement upstream.
export async function putInboxRuleOrder(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsed = await readJsonBody(request, putInboxRuleOrderRequestSchema);

  if ('failure' in parsed) {
    return parsed.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: parsed.data,
      errorCode: 'inbox_rule_rejected',
      method: 'PUT',
      operation: 'putInboxRuleOrder',
      path: 'inbox/rules/order',
      schema: inboxRuleListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postInboxRuleAdopt(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  ruleId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(ruleId, 'inbox_rule_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'inbox_rule_rejected',
      method: 'POST',
      operation: 'postInboxRuleAdopt',
      path: `inbox/rules/${encodeURIComponent(selected.value)}/adopt`,
      schema: inboxRuleSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
