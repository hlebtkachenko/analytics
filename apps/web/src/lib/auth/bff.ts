import { z } from 'zod';

import {
  createDocumentLinkRequestSchema,
  createDocumentRequestSchema,
  createPartnerRequestSchema,
  directiveAccountListSchema,
  documentAnalyticsQuerySchema,
  documentAnalyticsResponseSchema,
  documentDetailSchema,
  documentLinkSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  identifierSchema,
  partnerListQuerySchema,
  partnerListSchema,
  partnerSchema,
  updateDocumentRequestSchema,
  updatePartnerRequestSchema,
} from '../documents/contract.ts';
import {
  assignInboxItemRequestSchema,
  createInboxChannelRequestSchema,
  createInboxRuleRequestSchema,
  discardInboxItemRequestSchema,
  inboxChannelListResponseSchema,
  inboxChannelSchema,
  inboxItemDetailSchema,
  inboxItemListQuerySchema,
  inboxItemListResponseSchema,
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
} from '../inbox/contract.ts';
import { webLogger } from '../logger.ts';

// The API lists at most 200 entities, and the browser never asks for more than it can show.
const MAX_LEGAL_ENTITIES = 200;
const MAX_LEGAL_ENTITY_NAME_LENGTH = 200;
// The same bound and alphabet the database check constraint enforces on app.legal_entity.
const MAX_REGISTRATION_NUMBER_LENGTH = 32;
const registrationNumberPattern = /^[A-Za-z0-9-]+$/;
const LEGAL_ENTITY_TIMEOUT_MS = 10_000;

const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
// Better Auth mints opaque text user ids, so a member selector is bounded like an organization one.
const subjectIdSchema = organizationIdSchema;
const legalEntityIdSchema = z.string().uuid();
const legalEntityKindSchema = z.enum(['company', 'sole_trader']);
// Mirrors the entity scope contract in @bap/security, which apps/web must not import.
const entityScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      legalEntityIds: z.array(legalEntityIdSchema).max(MAX_LEGAL_ENTITIES),
      mode: z.literal('restricted'),
    })
    .strict(),
]);
// Mirrors the access contract in @bap/security, which apps/web must not import.
const accessResponseSchema = z
  .object({
    capabilities: z
      .object({
        createEntities: z.boolean(),
        deleteEntities: z.boolean(),
        manageDocuments: z.boolean(),
        manageEntityAccess: z.boolean(),
        manageMembers: z.boolean(),
        manageOrganization: z.boolean(),
        readDocuments: z.boolean(),
        updateEntities: z.boolean(),
        uploadData: z.boolean(),
        useAi: z.boolean(),
      })
      .strict(),
    entityScope: entityScopeSchema,
    organizationId: organizationIdSchema,
    role: z.enum(['owner', 'admin', 'member']),
    service: z.enum(['application-api', 'reporting-api']),
  })
  .strict();
// Mirrors the legal entity contract in @bap/api, which apps/web must not import.
const legalEntitySchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: legalEntityIdSchema,
    kind: legalEntityKindSchema,
    name: z.string(),
    registrationNumber: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

const legalEntityListSchema = z
  .object({ legalEntities: z.array(legalEntitySchema) })
  .strict();

const registrationNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REGISTRATION_NUMBER_LENGTH)
  .regex(registrationNumberPattern);

const legalEntityCreateBodySchema = z
  .object({
    kind: legalEntityKindSchema,
    name: z.string().trim().min(1).max(MAX_LEGAL_ENTITY_NAME_LENGTH),
    registrationNumber: registrationNumberSchema.optional(),
  })
  .strict();

// A patch carries only what changes, an empty object is refused, and null clears the number.
const legalEntityUpdateBodySchema = legalEntityCreateBodySchema
  .partial()
  .extend({
    registrationNumber: registrationNumberSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);

// The owner-only bulk read: one row per member with a stored scope, an omission meaning all.
const memberEntityScopeListSchema = z
  .object({
    entityScopes: z.array(
      z
        .object({ entityScope: entityScopeSchema, userId: subjectIdSchema })
        .strict(),
    ),
  })
  .strict();

export type BffService = 'application' | 'reporting';

export type AuthSession = Readonly<{
  user: Readonly<{
    emailVerified: boolean;
    id: string;
  }>;
}>;

export type BffAuth = Readonly<{
  getSession: (
    input: Readonly<{ headers: Headers }>,
  ) => Promise<AuthSession | null>;
  signJWT: (
    input: Readonly<{
      body: Readonly<{ payload: Readonly<{ iat: number; sub: string }> }>;
    }>,
  ) => Promise<Readonly<{ token: string }>>;
}>;

const internalServiceOrigins: Record<BffService, string> = {
  application: 'http://api:3001',
  reporting: 'http://reporting-api:3002',
};

const expectedServiceNames: Record<
  BffService,
  'application-api' | 'reporting-api'
> = {
  application: 'application-api',
  reporting: 'reporting-api',
};
const requestIdSchema = z.string().uuid();
// Mirrors the upload contract in @bap/api, which apps/web must not import.
const uploadAcceptedSchema = z
  .object({
    status: z.literal('accepted'),
    uploadId: z.string().uuid(),
  })
  .strict();
// An upload streams up to 25 MB from a browser, so the 3 second access budget would abort a healthy one.
const UPLOAD_TIMEOUT_MS = 120_000;
// Shared with the public intake route, which answers with the same private headers.
export const privateResponseHeaders = { 'cache-control': 'private, no-store' };

const datasetIdSchema = z.string().uuid();
// Mirrors the dataset contract in @bap/api, which apps/web must not import.
const MAX_DATASET_ROW_PAGE_SIZE = 500;
const DEFAULT_DATASET_ROW_PAGE_SIZE = 100;
const DATASET_READ_TIMEOUT_MS = 10_000;
// Bounds the wait for the first byte only: a large download must not be cut off mid stream.
const DATASET_EXPORT_HEADER_TIMEOUT_MS = 30_000;

const datasetExportFormatSchema = z.enum(['csv', 'xlsx']);

const datasetExportQuerySchema = z
  .object({ format: datasetExportFormatSchema })
  .strict();

type DatasetExportFormat = z.infer<typeof datasetExportFormatSchema>;

const datasetExportMediaTypes: Record<DatasetExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const datasetRowQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DATASET_ROW_PAGE_SIZE)
      .default(DEFAULT_DATASET_ROW_PAGE_SIZE),
  })
  .strict();

// The only dataset filter the browser may ask for: one entity, or none at all.
const datasetListFilterSchema = legalEntityIdSchema.optional();

const datasetListSchema = z
  .object({
    datasets: z.array(
      z
        .object({
          createdAt: z.iso.datetime(),
          description: z.string().nullable(),
          id: datasetIdSchema,
          legalEntityId: legalEntityIdSchema,
          name: z.string(),
          rowCount: z.number().int().min(0),
          status: z.enum(['importing', 'ready', 'failed']),
          updatedAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();

const datasetRowPageSchema = z
  .object({
    columns: z.array(
      z
        .object({
          inferredType: z.string(),
          name: z.string(),
          position: z.number().int().min(0),
        })
        .strict(),
    ),
    datasetId: datasetIdSchema,
    nextCursor: z.number().int().min(0).nullable(),
    pageSize: z.number().int().min(1).max(MAX_DATASET_ROW_PAGE_SIZE),
    rows: z.array(
      z
        .object({
          // Column names come from the dataset, so only the cell values are constrained.
          data: z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          ),
          rowNumber: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    headers: { ...privateResponseHeaders, ...headers },
    status,
  });
}

// A 502 reaches the browser as a bare error code, so the reason is recorded without the upstream body.
function upstreamFailure(
  operation: string,
  reason:
    'unreachable' | 'unreadable' | 'unexpected_shape' | 'unexpected_media_type',
): Response {
  webLogger.error('bff upstream call failed', { operation, reason });
  return jsonResponse({ error: 'service_unavailable' }, 502);
}

export function parseOrganizationId(value: string): string {
  return organizationIdSchema.parse(value);
}

export async function getOrganizationAccess(
  auth: BffAuth,
  request: Request,
  service: BffService,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsedSelector = organizationIdSchema.safeParse(organizationId);
  if (!parsedSelector.success) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }
  const selector = parsedSelector.data;
  const session = await auth.getSession({ headers: request.headers });

  if (!session?.user.emailVerified) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const { token } = await auth.signJWT({
    body: {
      payload: {
        iat: Math.floor(Date.now() / 1000),
        sub: session.user.id,
      },
    },
  });
  const incomingRequestId = request.headers.get('x-bap-request-id');
  const parsedRequestId = requestIdSchema.safeParse(incomingRequestId);
  const requestId = parsedRequestId.success
    ? parsedRequestId.data
    : crypto.randomUUID();
  let response: Response;
  try {
    response = await fetchImplementation(
      `${internalServiceOrigins[service]}/v1/organizations/${encodeURIComponent(selector)}/access`,
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          'x-bap-request-id': requestId,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );
  } catch {
    return upstreamFailure('getOrganizationAccess', 'unreachable');
  }

  if (!response.ok) {
    // An upstream fault would otherwise reach the browser labelled as a refusal with no trace.
    if (response.status >= 500) {
      return upstreamFailure('getOrganizationAccess', 'unreachable');
    }

    return jsonResponse({ error: 'access_denied' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure('getOrganizationAccess', 'unreadable');
  }
  const payload = accessResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    return upstreamFailure('getOrganizationAccess', 'unexpected_shape');
  }
  if (
    payload.data.organizationId !== selector ||
    payload.data.service !== expectedServiceNames[service]
  ) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }

  return jsonResponse(payload.data, 200, { 'x-request-id': requestId });
}

export async function postDatasetUpload(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsedSelector = organizationIdSchema.safeParse(organizationId);
  if (!parsedSelector.success) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }
  const selector = parsedSelector.data;
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data') || request.body === null) {
    return jsonResponse({ error: 'invalid_upload' }, 400);
  }
  const session = await auth.getSession({ headers: request.headers });

  if (!session?.user.emailVerified) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // Minted per outbound call and never stored, exactly like the access route.
  const { token } = await auth.signJWT({
    body: {
      payload: {
        iat: Math.floor(Date.now() / 1000),
        sub: session.user.id,
      },
    },
  });
  const incomingRequestId = request.headers.get('x-bap-request-id');
  const parsedRequestId = requestIdSchema.safeParse(incomingRequestId);
  const requestId = parsedRequestId.success
    ? parsedRequestId.data
    : crypto.randomUUID();
  let response: Response;
  try {
    response = await fetchImplementation(
      `${internalServiceOrigins.application}/v1/organizations/${encodeURIComponent(selector)}/uploads`,
      {
        // The body is forwarded as a stream, so the web service never holds the whole upload.
        body: request.body,
        cache: 'no-store',
        duplex: 'half',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': contentType,
          'x-bap-request-id': requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      } as RequestInit & { duplex: 'half' },
    );
  } catch {
    return upstreamFailure('postDatasetUpload', 'unreachable');
  }

  if (!response.ok) {
    return jsonResponse({ error: 'upload_rejected' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure('postDatasetUpload', 'unreadable');
  }
  const payload = uploadAcceptedSchema.safeParse(responseBody);
  if (!payload.success) {
    return upstreamFailure('postDatasetUpload', 'unexpected_shape');
  }

  return jsonResponse(payload.data, 202, { 'x-request-id': requestId });
}

type PreparedApplicationCall = Readonly<{
  requestId: string;
  selector: string;
  token: string;
}>;

type PreparedCall = PreparedApplicationCall | Readonly<{ failure: Response }>;

function resolveRequestId(request: Request): string {
  const parsed = requestIdSchema.safeParse(
    request.headers.get('x-bap-request-id'),
  );
  return parsed.success ? parsed.data : crypto.randomUUID();
}

// Validates the selector and the session, then mints one resource token for one outbound call.
async function prepareApplicationCall(
  auth: BffAuth,
  request: Request,
  organizationId: string,
): Promise<PreparedCall> {
  const parsedSelector = organizationIdSchema.safeParse(organizationId);

  if (!parsedSelector.success) {
    return { failure: jsonResponse({ error: 'access_denied' }, 403) };
  }

  const session = await auth.getSession({ headers: request.headers });

  if (!session?.user.emailVerified) {
    return { failure: jsonResponse({ error: 'unauthorized' }, 401) };
  }

  const { token } = await auth.signJWT({
    body: {
      payload: { iat: Math.floor(Date.now() / 1000), sub: session.user.id },
    },
  });

  return {
    requestId: resolveRequestId(request),
    selector: parsedSelector.data,
    token,
  };
}

function applicationPath(selector: string, suffix: string): string {
  return `${internalServiceOrigins.application}/v1/organizations/${encodeURIComponent(selector)}/${suffix}`;
}

function datasetPath(
  selector: string,
  datasetId: string,
  suffix: string,
): string {
  return applicationPath(
    selector,
    `datasets/${encodeURIComponent(datasetId)}/${suffix}`,
  );
}

export async function getDatasets(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  // Only the entity filter is read, so an unrelated parameter is ignored rather than refused.
  const requestedFilter = new URL(request.url).searchParams.get(
    'legalEntityId',
  );
  // A malformed entity filter is refused here, never widened into an unfiltered list.
  const query = datasetListFilterSchema.safeParse(
    requestedFilter === null ? undefined : requestedFilter.toLowerCase(),
  );

  if (!query.success) {
    return jsonResponse({ error: 'invalid_filter' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from the validated value only, so no client query string is forwarded verbatim.
  const filter =
    query.data === undefined
      ? ''
      : `?legalEntityId=${encodeURIComponent(query.data)}`;
  let response: Response;
  try {
    response = await fetchImplementation(
      `${applicationPath(prepared.selector, 'datasets')}${filter}`,
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${prepared.token}`,
          'x-bap-request-id': prepared.requestId,
        },
        signal: AbortSignal.timeout(DATASET_READ_TIMEOUT_MS),
      },
    );
  } catch {
    return upstreamFailure('getDatasets', 'unreachable');
  }

  if (!response.ok) {
    // An upstream fault is not a refusal, so it is recorded rather than passed through silently.
    if (response.status >= 500) {
      return upstreamFailure('getDatasets', 'unreachable');
    }

    return jsonResponse({ error: 'datasets_unavailable' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure('getDatasets', 'unreadable');
  }
  const payload = datasetListSchema.safeParse(responseBody);
  if (!payload.success) {
    return upstreamFailure('getDatasets', 'unexpected_shape');
  }

  return jsonResponse(payload.data, 200, {
    'x-request-id': prepared.requestId,
  });
}

export async function getDatasetRows(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  datasetId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsedDatasetId = datasetIdSchema.safeParse(datasetId);

  // A malformed identifier answers exactly like an invisible dataset, so nothing can be enumerated.
  if (!parsedDatasetId.success) {
    return jsonResponse({ error: 'dataset_not_found' }, 404);
  }

  // The page bound is enforced here as well as at the API: an oversized page is rejected, never clamped.
  const query = datasetRowQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!query.success) {
    return jsonResponse({ error: 'invalid_page' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from validated values only, so no client query string is forwarded verbatim.
  const outbound = new URLSearchParams();
  if (query.data.after !== undefined) {
    outbound.set('after', String(query.data.after));
  }
  outbound.set('pageSize', String(query.data.pageSize));

  let response: Response;
  try {
    response = await fetchImplementation(
      `${datasetPath(prepared.selector, parsedDatasetId.data, 'rows')}?${outbound.toString()}`,
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${prepared.token}`,
          'x-bap-request-id': prepared.requestId,
        },
        signal: AbortSignal.timeout(DATASET_READ_TIMEOUT_MS),
      },
    );
  } catch {
    return upstreamFailure('getDatasetRows', 'unreachable');
  }

  if (!response.ok) {
    // An upstream fault is not a refusal, so it is recorded rather than passed through silently.
    if (response.status >= 500) {
      return upstreamFailure('getDatasetRows', 'unreachable');
    }

    return jsonResponse({ error: 'rows_unavailable' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure('getDatasetRows', 'unreadable');
  }
  const payload = datasetRowPageSchema.safeParse(responseBody);
  if (!payload.success || payload.data.datasetId !== parsedDatasetId.data) {
    return upstreamFailure('getDatasetRows', 'unexpected_shape');
  }

  return jsonResponse(payload.data, 200, {
    'x-request-id': prepared.requestId,
  });
}

export async function getDatasetExport(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  datasetId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsedDatasetId = datasetIdSchema.safeParse(datasetId);

  if (!parsedDatasetId.success) {
    return jsonResponse({ error: 'dataset_not_found' }, 404);
  }

  const query = datasetExportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  // CSV and XLSX only: ADR 0005 rejects PDF, so no third format can be asked for.
  if (!query.success) {
    return jsonResponse({ error: 'invalid_format' }, 400);
  }

  const format = query.data.format;

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Bounds the wait for the response head only, so a long download is never cut off mid stream.
  const controller = new AbortController();
  const headerTimeout = setTimeout(() => {
    controller.abort();
  }, DATASET_EXPORT_HEADER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImplementation(
      `${datasetPath(prepared.selector, parsedDatasetId.data, 'export')}?format=${format}`,
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
    return upstreamFailure('getDatasetExport', 'unreachable');
  } finally {
    clearTimeout(headerTimeout);
  }

  if (!response.ok) {
    // An upstream fault is not a refusal, so it is recorded rather than passed through silently.
    if (response.status >= 500) {
      return upstreamFailure('getDatasetExport', 'unreachable');
    }

    return jsonResponse({ error: 'export_rejected' }, response.status);
  }

  const mediaType = datasetExportMediaTypes[format];

  if (
    (response.headers.get('content-type') ?? '').toLowerCase() !== mediaType ||
    response.body === null
  ) {
    return upstreamFailure('getDatasetExport', 'unexpected_media_type');
  }

  // The filename is minted here from the validated dataset id, so no upstream header reaches the browser.
  return new Response(response.body, {
    headers: {
      ...privateResponseHeaders,
      'content-disposition': `attachment; filename="dataset-${parsedDatasetId.data}.${format}"`,
      'content-type': mediaType,
      'x-request-id': prepared.requestId,
    },
    status: 200,
  });
}

export type EntityScope = z.infer<typeof entityScopeSchema>;
export type LegalEntity = z.infer<typeof legalEntitySchema>;
export type OrganizationAccess = z.infer<typeof accessResponseSchema>;

// Exported so a server render and the entity actions reuse the contract validated here.
export {
  accessResponseSchema,
  entityScopeSchema,
  legalEntityCreateBodySchema,
  legalEntityIdSchema,
  legalEntityKindSchema,
  legalEntityListSchema,
  legalEntitySchema,
  legalEntityUpdateBodySchema,
  memberEntityScopeListSchema,
  subjectIdSchema,
};

type ApplicationJsonCall = Readonly<{
  body?: unknown;
  errorCode: string;
  // A problem code from this closed list is passed through beside the error code; nothing else of the body is.
  passthroughCodes?: z.ZodEnum<Record<string, string>>;
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  operation: string;
  path: string;
  // A null schema means the contract answers with no content at all.
  schema: z.ZodType | null;
  successStatus: number;
}>;

// One outbound JSON call under the shared timeout, private headers and failure vocabulary.
async function callApplicationJson(
  prepared: PreparedApplicationCall,
  call: ApplicationJsonCall,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const outboundHeaders: Record<string, string> = {
    authorization: `Bearer ${prepared.token}`,
    'x-bap-request-id': prepared.requestId,
  };

  if (call.body !== undefined) {
    outboundHeaders['content-type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetchImplementation(
      applicationPath(prepared.selector, call.path),
      {
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
        cache: 'no-store',
        headers: outboundHeaders,
        method: call.method,
        signal: AbortSignal.timeout(LEGAL_ENTITY_TIMEOUT_MS),
      },
    );
  } catch {
    return upstreamFailure(call.operation, 'unreachable');
  }

  if (!response.ok) {
    // An upstream fault is not a refusal, so it is recorded rather than passed through silently.
    if (response.status >= 500) {
      return upstreamFailure(call.operation, 'unreachable');
    }

    const code =
      call.passthroughCodes === undefined
        ? undefined
        : await problemCode(response, call.passthroughCodes);

    return jsonResponse(
      { error: call.errorCode, ...(code === undefined ? {} : { code }) },
      response.status,
    );
  }

  if (call.schema === null) {
    return new Response(null, {
      headers: {
        ...privateResponseHeaders,
        'x-request-id': prepared.requestId,
      },
      status: call.successStatus,
    });
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return upstreamFailure(call.operation, 'unreadable');
  }
  const payload = call.schema.safeParse(responseBody);

  if (!payload.success) {
    return upstreamFailure(call.operation, 'unexpected_shape');
  }

  return jsonResponse(payload.data, call.successStatus, {
    'x-request-id': prepared.requestId,
  });
}

// The API's problem body names a machine-readable code; only a listed one crosses to the browser.
async function problemCode(
  response: Response,
  codes: z.ZodEnum<Record<string, string>>,
): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  const parsed = codes.safeParse(
    typeof body === 'object' && body !== null
      ? (body as { code?: unknown }).code
      : undefined,
  );
  return parsed.success ? parsed.data : undefined;
}

type ParsedBody<T> = Readonly<{ data: T }> | Readonly<{ failure: Response }>;

// Every browser body is validated here before a resource token is minted for it.
async function readJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParsedBody<T>> {
  if (
    !(request.headers.get('content-type') ?? '').startsWith('application/json')
  ) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }

  return { data: parsed.data };
}

// A malformed identifier answers exactly like an invisible one, so nothing can be enumerated.
function parsedIdentifier(
  value: string,
  errorCode: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = identifierSchema.safeParse(value);

  return parsed.success
    ? { value: parsed.data }
    : { failure: jsonResponse({ error: errorCode }, 404) };
}

function parsedSubjectId(
  userId: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = subjectIdSchema.safeParse(userId);

  return parsed.success
    ? { value: parsed.data }
    : { failure: jsonResponse({ error: 'member_not_found' }, 404) };
}

export async function getLegalEntities(
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
      errorCode: 'legal_entities_unavailable',
      method: 'GET',
      operation: 'getLegalEntities',
      path: 'legal-entities',
      schema: legalEntityListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, legalEntityCreateBodySchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'legal_entity_rejected',
      method: 'POST',
      operation: 'postLegalEntity',
      path: 'legal-entities',
      schema: legalEntitySchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function patchLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  legalEntityId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selectedEntity = parsedIdentifier(
    legalEntityId,
    'legal_entity_not_found',
  );

  if ('failure' in selectedEntity) {
    return selectedEntity.failure;
  }

  const body = await readJsonBody(request, legalEntityUpdateBodySchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'legal_entity_rejected',
      method: 'PATCH',
      operation: 'patchLegalEntity',
      path: `legal-entities/${encodeURIComponent(selectedEntity.value)}`,
      schema: legalEntitySchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function deleteLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  legalEntityId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selectedEntity = parsedIdentifier(
    legalEntityId,
    'legal_entity_not_found',
  );

  if ('failure' in selectedEntity) {
    return selectedEntity.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'legal_entity_rejected',
      method: 'DELETE',
      operation: 'deleteLegalEntity',
      path: `legal-entities/${encodeURIComponent(selectedEntity.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

// One owner-only read for the whole member list, so a members page never fans out per member.
export async function getMemberEntityScopes(
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
      errorCode: 'entity_scopes_unavailable',
      method: 'GET',
      operation: 'getMemberEntityScopes',
      path: 'entity-scopes',
      schema: memberEntityScopeListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getMemberEntityScope(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  userId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const subject = parsedSubjectId(userId);

  if ('failure' in subject) {
    return subject.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'entity_scope_unavailable',
      method: 'GET',
      operation: 'getMemberEntityScope',
      path: `members/${encodeURIComponent(subject.value)}/entity-scope`,
      schema: entityScopeSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function putMemberEntityScope(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  userId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const subject = parsedSubjectId(userId);

  if ('failure' in subject) {
    return subject.failure;
  }

  const body = await readJsonBody(request, entityScopeSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'entity_scope_rejected',
      method: 'PUT',
      operation: 'putMemberEntityScope',
      path: `members/${encodeURIComponent(subject.value)}/entity-scope`,
      schema: entityScopeSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

// Rebuilt from validated values only, so no client query string is forwarded verbatim.
function documentListQuery(
  query: z.infer<typeof documentListQuerySchema>,
): string {
  const outbound = new URLSearchParams();

  if (query.legalEntityId !== undefined) {
    outbound.set('legalEntityId', query.legalEntityId);
  }
  if (query.kind !== undefined) {
    outbound.set('kind', query.kind.join(','));
  }
  if (query.status !== undefined) {
    outbound.set('status', query.status.join(','));
  }
  if (query.partnerId !== undefined) {
    outbound.set('partnerId', query.partnerId);
  }
  if (query.dateFrom !== undefined) {
    outbound.set('dateFrom', query.dateFrom);
  }
  if (query.dateTo !== undefined) {
    outbound.set('dateTo', query.dateTo);
  }
  if (query.q !== undefined) {
    outbound.set('q', query.q);
  }
  outbound.set('page', String(query.page));
  outbound.set('pageSize', String(query.pageSize));
  outbound.set('sort', query.sort);
  outbound.set('order', query.order);

  return outbound.toString();
}

export async function getDocuments(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = documentListQuerySchema.safeParse(
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
      errorCode: 'documents_unavailable',
      method: 'GET',
      operation: 'getDocuments',
      path: `documents?${documentListQuery(query.data)}`,
      schema: documentListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getDocumentAnalytics(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = documentAnalyticsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  // A malformed entity filter is refused here, never widened into an unfiltered read.
  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from the validated value only, so no client query string is forwarded verbatim.
  const filter =
    query.data.legalEntityId === undefined
      ? ''
      : `?legalEntityId=${encodeURIComponent(query.data.legalEntityId)}`;

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_analytics_unavailable',
      method: 'GET',
      operation: 'getDocumentAnalytics',
      path: `documents/analytics${filter}`,
      schema: documentAnalyticsResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createDocumentRequestSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'document_rejected',
      method: 'POST',
      operation: 'postDocument',
      path: 'documents',
      schema: documentDetailSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function getDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

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
      errorCode: 'document_unavailable',
      method: 'GET',
      operation: 'getDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: documentDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function patchDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, updateDocumentRequestSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'document_rejected',
      method: 'PATCH',
      operation: 'patchDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: documentDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function deleteDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

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
      errorCode: 'document_rejected',
      method: 'DELETE',
      operation: 'deleteDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

export async function postDocumentLink(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, createDocumentLinkRequestSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'document_link_rejected',
      method: 'POST',
      operation: 'postDocumentLink',
      path: `documents/${encodeURIComponent(selected.value)}/links`,
      schema: documentLinkSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function deleteDocumentLink(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  linkId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const selectedLink = parsedIdentifier(linkId, 'link_not_found');

  if ('failure' in selectedLink) {
    return selectedLink.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_link_rejected',
      method: 'DELETE',
      operation: 'deleteDocumentLink',
      path: `documents/${encodeURIComponent(selected.value)}/links/${encodeURIComponent(selectedLink.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

export async function getPartners(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const requested = new URL(request.url).searchParams.get('q');
  const query = partnerListQuerySchema.safeParse(
    requested === null ? {} : { q: requested },
  );

  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from the validated value only, so no client query string is forwarded verbatim.
  const filter =
    query.data.q === undefined ? '' : `?q=${encodeURIComponent(query.data.q)}`;

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'partners_unavailable',
      method: 'GET',
      operation: 'getPartners',
      path: `partners${filter}`,
      schema: partnerListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postPartner(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createPartnerRequestSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'partner_rejected',
      method: 'POST',
      operation: 'postPartner',
      path: 'partners',
      schema: partnerSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function patchPartner(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  partnerId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(partnerId, 'partner_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, updatePartnerRequestSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'partner_rejected',
      method: 'PATCH',
      operation: 'patchPartner',
      path: `partners/${encodeURIComponent(selected.value)}`,
      schema: partnerSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getDirectiveAccounts(
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
      errorCode: 'directive_accounts_unavailable',
      method: 'GET',
      operation: 'getDirectiveAccounts',
      path: 'directive-accounts',
      schema: directiveAccountListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

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
    | 'discard'
    | 'hints'
    | 'process'
    | 'restore'
    | 'route/document'
    | 'route/undo'
    | 'snooze';
  bodySchema: z.ZodType | null;
  method: 'PATCH' | 'POST';
  operation: string;
}>;

// Every item write answers with the refreshed detail, so one helper covers the whole set.
async function writeInboxItem(
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
      path: `inbox/items/${encodeURIComponent(selected.value)}/${write.action}`,
      schema: inboxItemDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function patchInboxItemHints(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'hints',
      bodySchema: updateInboxHintsRequestSchema,
      method: 'PATCH',
      operation: 'patchInboxItemHints',
    },
    fetchImplementation,
  );
}

export async function postInboxItemProcess(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'process',
      bodySchema: null,
      method: 'POST',
      operation: 'postInboxItemProcess',
    },
    fetchImplementation,
  );
}

export async function postInboxItemRouteDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'route/document',
      bodySchema: routeInboxItemToDocumentRequestSchema,
      method: 'POST',
      operation: 'postInboxItemRouteDocument',
    },
    fetchImplementation,
  );
}

export async function postInboxItemRouteUndo(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'route/undo',
      bodySchema: null,
      method: 'POST',
      operation: 'postInboxItemRouteUndo',
    },
    fetchImplementation,
  );
}

export async function postInboxItemDiscard(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'discard',
      bodySchema: discardInboxItemRequestSchema,
      method: 'POST',
      operation: 'postInboxItemDiscard',
    },
    fetchImplementation,
  );
}

export async function postInboxItemRestore(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'restore',
      bodySchema: null,
      method: 'POST',
      operation: 'postInboxItemRestore',
    },
    fetchImplementation,
  );
}

export async function postInboxItemAssign(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'assign',
      bodySchema: assignInboxItemRequestSchema,
      method: 'POST',
      operation: 'postInboxItemAssign',
    },
    fetchImplementation,
  );
}

export async function postInboxItemSnooze(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return await writeInboxItem(
    auth,
    request,
    organizationId,
    itemId,
    {
      action: 'snooze',
      bodySchema: snoozeInboxItemRequestSchema,
      method: 'POST',
      operation: 'postInboxItemSnooze',
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

    // The API's 409 is the quarantine gate on an infected or unscannable blob; the browser reads the code.
    return jsonResponse(
      {
        error: response.status === 409 ? 'blob_quarantined' : 'blob_rejected',
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
