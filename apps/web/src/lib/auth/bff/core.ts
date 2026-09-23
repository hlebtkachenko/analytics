import { z } from 'zod';

import { identifierSchema } from '../../documents/contract.ts';
import { webLogger } from '../../logger.ts';

// The API lists at most 200 entities, and the browser never asks for more than it can show.
const MAX_LEGAL_ENTITIES = 200;

const LEGAL_ENTITY_TIMEOUT_MS = 10_000;

export const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

// Better Auth mints opaque text user ids, so a member selector is bounded like an organization one.
export const subjectIdSchema = organizationIdSchema;

export const legalEntityIdSchema = z.string().uuid();

// Mirrors the entity scope contract in @bap/security, which apps/web must not import. A resolved
// scope may be restricted with an empty list (a member with no grant), so reads stay permissive.
export const entityScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      legalEntityIds: z.array(legalEntityIdSchema).max(MAX_LEGAL_ENTITIES),
      mode: z.literal('restricted'),
    })
    .strict(),
]);

// Mirrors the entity scope write contract: granting access needs at least one entity, so a
// restricted body with an empty list is refused before a resource token is minted for it.
export const entityScopeWriteSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      legalEntityIds: z
        .array(legalEntityIdSchema)
        .min(1)
        .max(MAX_LEGAL_ENTITIES),
      mode: z.literal('restricted'),
    })
    .strict(),
]);

// Mirrors the access contract in @bap/security, which apps/web must not import.
export const accessResponseSchema = z
  .object({
    capabilities: z
      .object({
        createEntities: z.boolean(),
        deleteEntities: z.boolean(),
        manageDocuments: z.boolean(),
        manageEntityAccess: z.boolean(),
        manageHr: z.boolean(),
        manageMembers: z.boolean(),
        manageOrganization: z.boolean(),
        managePayroll: z.boolean(),
        manageSensitiveHr: z.boolean(),
        approvePayroll: z.boolean(),
        readDocuments: z.boolean(),
        readHr: z.boolean(),
        readPayroll: z.boolean(),
        readSensitiveHr: z.boolean(),
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

export const internalServiceOrigins: Record<BffService, string> = {
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

export const requestIdSchema = z.string().uuid();

// An upload streams up to 25 MB from a browser, so the 3 second access budget would abort a healthy one.
export const UPLOAD_TIMEOUT_MS = 120_000;

// Shared with the public intake route, which answers with the same private headers.
export const privateResponseHeaders = { 'cache-control': 'private, no-store' };

// Bounds the wait for the first byte only: a large download must not be cut off mid stream.
export const DATASET_EXPORT_HEADER_TIMEOUT_MS = 30_000;

export function jsonResponse(
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
export function upstreamFailure(
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
export async function prepareApplicationCall(
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

export function applicationPath(selector: string, suffix: string): string {
  return `${internalServiceOrigins.application}/v1/organizations/${encodeURIComponent(selector)}/${suffix}`;
}

export type EntityScope = z.infer<typeof entityScopeSchema>;

export type OrganizationAccess = z.infer<typeof accessResponseSchema>;

type ApplicationJsonCall = Readonly<{
  body?: unknown;
  errorCode: string;
  headers?: Readonly<Record<string, string>>;
  // A problem code from this closed list is passed through beside the error code; nothing else of the body is.
  passthroughCodes?: z.ZodEnum<Record<string, string>>;
  // A 409 body of this closed shape is passed through whole, since the page acts on the ids it names.
  passthroughConflict?: z.ZodType<Record<string, unknown>>;
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  operation: string;
  path: string;
  // A null schema means the contract answers with no content at all.
  schema: z.ZodType | null;
  successStatus: number | readonly number[];
}>;

// One outbound JSON call under the shared timeout, private headers and failure vocabulary.
export async function callApplicationJson(
  prepared: PreparedApplicationCall,
  call: ApplicationJsonCall,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const outboundHeaders: Record<string, string> = {
    authorization: `Bearer ${prepared.token}`,
    'x-bap-request-id': prepared.requestId,
  };
  Object.assign(outboundHeaders, call.headers);

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

    if (call.passthroughConflict !== undefined && response.status === 409) {
      const conflict = await problemBody(response, call.passthroughConflict);
      if (conflict !== undefined) {
        return jsonResponse({ error: call.errorCode, ...conflict }, 409);
      }
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

  const expectedStatuses = Array.isArray(call.successStatus)
    ? call.successStatus
    : [call.successStatus];
  if (!expectedStatuses.includes(response.status)) {
    return upstreamFailure(call.operation, 'unexpected_shape');
  }

  if (call.schema === null) {
    return new Response(null, {
      headers: {
        ...privateResponseHeaders,
        'x-request-id': prepared.requestId,
      },
      status: response.status,
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

  return jsonResponse(payload.data, response.status, {
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

// The whole problem body, validated against the closed shape; undefined when it is anything else.
async function problemBody<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

type ParsedBody<T> = Readonly<{ data: T }> | Readonly<{ failure: Response }>;

// Every browser body is validated here before a resource token is minted for it.
export async function readJsonBody<T>(
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
export function parsedIdentifier(
  value: string,
  errorCode: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = identifierSchema.safeParse(value);

  return parsed.success
    ? { value: parsed.data }
    : { failure: jsonResponse({ error: errorCode }, 404) };
}

export function parsedSubjectId(
  userId: string,
): Readonly<{ failure: Response }> | Readonly<{ value: string }> {
  const parsed = subjectIdSchema.safeParse(userId);

  return parsed.success
    ? { value: parsed.data }
    : { failure: jsonResponse({ error: 'member_not_found' }, 404) };
}
