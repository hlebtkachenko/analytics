import { z } from 'zod';

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
        manageEntityAccess: z.boolean(),
        manageMembers: z.boolean(),
        manageOrganization: z.boolean(),
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

const legalEntityCreateBodySchema = z
  .object({
    kind: legalEntityKindSchema,
    name: z.string().trim().min(1).max(MAX_LEGAL_ENTITY_NAME_LENGTH),
    registrationNumber: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REGISTRATION_NUMBER_LENGTH)
      .regex(registrationNumberPattern)
      .optional(),
  })
  .strict();

// A patch carries only what changes, so an empty object is refused rather than sent.
const legalEntityUpdateBodySchema = legalEntityCreateBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0);

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
const privateResponseHeaders = { 'cache-control': 'private, no-store' };

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
const datasetListQuerySchema = z
  .object({ legalEntityId: legalEntityIdSchema.optional() })
  .strict();

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
  // A malformed entity filter is refused here, never widened into an unfiltered list.
  const query = datasetListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
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
    query.data.legalEntityId === undefined
      ? ''
      : `?legalEntityId=${encodeURIComponent(query.data.legalEntityId)}`;
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

// Exported so a server render parses exactly the contract this module already validated.
export {
  accessResponseSchema,
  entityScopeSchema,
  legalEntityListSchema,
  legalEntitySchema,
};

type ApplicationJsonCall = Readonly<{
  body?: unknown;
  errorCode: string;
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

    return jsonResponse({ error: call.errorCode }, response.status);
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

// A malformed entity id answers exactly like an invisible one, so nothing can be enumerated.
function parsedLegalEntityId(
  legalEntityId: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = legalEntityIdSchema.safeParse(legalEntityId);

  return parsed.success
    ? { value: parsed.data }
    : { failure: jsonResponse({ error: 'legal_entity_not_found' }, 404) };
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
  const selectedEntity = parsedLegalEntityId(legalEntityId);

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
  const selectedEntity = parsedLegalEntityId(legalEntityId);

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
