import type { DatabasePool } from '@bap/db/pool';
import { createHash } from 'node:crypto';

import type { BffAuth } from '../auth/bff.ts';
import { privateResponseHeaders } from '../auth/bff.ts';
import { normalizePublicSignUpClientIdentity } from '../auth/public-sign-up-edge.ts';
import { webLogger } from '../logger.ts';
import {
  INTAKE_DISPLAY_PREFIX_LENGTH,
  INTAKE_SECRET_PREFIX,
  inboxIntakeResponseSchema,
  intakeSecretSchema,
} from './contract.ts';

// The same shape as the public sign-up bucket, in its own namespace, checked before and consumed after a miss.
export const INTAKE_EDGE_RATE_LIMIT = { max: 3, windowSeconds: 60 } as const;
const RATE_LIMIT_KEY_PREFIX = 'bap-edge:intake:';
// The API's JSON body parser stops at 1 MiB, so a larger structured push is refused here first.
const MAX_STRUCTURED_BYTES = 1_048_576;
// A file streams up to 25 MB, so the multipart forward shares the upload budget of Phase 0.
const INTAKE_TIMEOUT_MS = 120_000;
const INTERNAL_APPLICATION_ORIGIN = 'http://api:3001';

const upstreamErrorCodes: Readonly<Record<number, string>> = {
  400: 'invalid_body',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'channel_not_found',
  409: 'conflict',
  413: 'too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

export type IntakeDependencies = Readonly<{
  fetchImplementation?: typeof fetch;
  loadPool: () => Promise<DatabasePool>;
  now?: () => number;
  signJWT: BffAuth['signJWT'];
}>;

type ResolvedCredential = Readonly<{
  channelId: string;
  organizationId: string;
}>;

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

function rateLimitKey(request: Request): string {
  const identity = normalizePublicSignUpClientIdentity(
    request.headers.get('x-bap-client-ip'),
  );
  return `${RATE_LIMIT_KEY_PREFIX}${createHash('sha256').update(identity).digest('hex')}`;
}

// A read only: a full bucket refuses before any credential is looked up.
async function bucketRetryAfterSeconds(
  pool: DatabasePool,
  key: string,
  now: number,
): Promise<number | null> {
  const windowMilliseconds = INTAKE_EDGE_RATE_LIMIT.windowSeconds * 1000;
  const result = await pool.query<{
    count: number | string;
    last_request: number | string;
  }>('select count, last_request from auth.rate_limit where "key" = $1', [key]);
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  const count = Number(row.count);
  const lastRequest = Number(row.last_request);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(lastRequest)) {
    throw new Error('Invalid intake rate-limit state.');
  }
  if (
    lastRequest <= now - windowMilliseconds ||
    count < INTAKE_EDGE_RATE_LIMIT.max
  ) {
    return null;
  }
  return Math.max(
    1,
    Math.ceil((lastRequest + windowMilliseconds - now) / 1000),
  );
}

// The sign-up upsert in the intake namespace: one attempt per miss, capped, pruning only its own rows.
async function consumeBucket(
  pool: DatabasePool,
  key: string,
  now: number,
): Promise<void> {
  const windowMilliseconds = INTAKE_EDGE_RATE_LIMIT.windowSeconds * 1000;
  await pool.query(
    `with pruned as (
       delete from auth.rate_limit
       where "key" like '${RATE_LIMIT_KEY_PREFIX}%'
         and "key" <> $1
         and last_request <= $2::bigint - $3::bigint
     )
     insert into auth.rate_limit (id, "key", count, last_request)
     values ($1, $1, 1, $2)
     on conflict ("key") do update
     set count = case
           when auth.rate_limit.last_request <= $2::bigint - $3::bigint then 1
           else auth.rate_limit.count + 1
         end,
         last_request = case
           when auth.rate_limit.last_request <= $2::bigint - $3::bigint then $2
           else auth.rate_limit.last_request
         end
     where auth.rate_limit.last_request <= $2::bigint - $3::bigint
        or auth.rate_limit.count < $4::integer`,
    [key, now, windowMilliseconds, INTAKE_EDGE_RATE_LIMIT.max],
  );
}

// The raw bearer is hashed and forgotten; only the definer function sees the hash.
async function resolveCredential(
  pool: DatabasePool,
  secret: string,
): Promise<ResolvedCredential | null> {
  const secretSha256 = createHash('sha256').update(secret).digest('hex');
  const result = await pool.query<{
    channel_id: string;
    kind: string;
    organization_id: string;
  }>(
    'select organization_id, channel_id, kind from auth.resolve_channel_credential($1)',
    [secretSha256],
  );
  const row = result.rows[0];
  // An email address credential never authenticates the API route, whatever its channel.
  if (row === undefined || row.kind !== 'api_token') {
    return null;
  }
  return { channelId: row.channel_id, organizationId: row.organization_id };
}

function bearerSecret(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  const parsed = intakeSecretSchema.safeParse(header.slice('Bearer '.length));
  return parsed.success ? parsed.data : null;
}

function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase();
}

type ForwardBody =
  | Readonly<{ body: BodyInit; contentType: string }>
  | Readonly<{ failure: Response }>;

// Multipart streams through untouched; JSON is bounded here so the web never buffers more than the API accepts.
async function forwardBody(request: Request): Promise<ForwardBody> {
  const type = mediaType(request);
  if (request.body === null) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }
  if (type === 'multipart/form-data') {
    return {
      body: request.body,
      contentType: request.headers.get('content-type')!,
    };
  }
  if (type !== 'application/json') {
    return {
      failure: jsonResponse({ error: 'unsupported_media_type' }, 415),
    };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_STRUCTURED_BYTES) {
    return { failure: jsonResponse({ error: 'too_large' }, 413) };
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > MAX_STRUCTURED_BYTES) {
      await reader.cancel();
      return { failure: jsonResponse({ error: 'too_large' }, 413) };
    }
    chunks.push(new Uint8Array(value));
  }
  return {
    body: new Blob(chunks, { type: 'application/json' }),
    contentType: 'application/json',
  };
}

// The organization-less push route: bucket, bearer, lookup, then one forwarded call under a channel token.
export async function postIntakeItem(
  request: Request,
  dependencies: IntakeDependencies,
): Promise<Response> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const now = dependencies.now?.() ?? Date.now();
  const secret = bearerSecret(request);
  if (secret === null) {
    webLogger.warn('intake refused', {
      operation: 'postIntakeItem',
      reason: 'malformed_bearer',
    });
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let pool: DatabasePool;
  let credential: ResolvedCredential | null;
  const key = rateLimitKey(request);
  try {
    pool = await dependencies.loadPool();
    const retryAfterSeconds = await bucketRetryAfterSeconds(pool, key, now);
    if (retryAfterSeconds !== null) {
      webLogger.warn('intake refused', {
        operation: 'postIntakeItem',
        reason: 'rate_limited',
      });
      return jsonResponse({ error: 'rate_limited', retryAfterSeconds }, 429, {
        'retry-after': String(retryAfterSeconds),
      });
    }
    credential = await resolveCredential(pool, secret);
    if (credential === null) {
      await consumeBucket(pool, key, now);
    }
  } catch {
    webLogger.error('intake lookup failed', {
      operation: 'postIntakeItem',
      reason: 'unavailable',
    });
    return jsonResponse({ error: 'intake_unavailable' }, 503);
  }

  if (credential === null) {
    webLogger.warn('intake refused', {
      operation: 'postIntakeItem',
      reason: 'unknown_credential',
    });
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const forward = await forwardBody(request);
  if ('failure' in forward) {
    return forward.failure;
  }

  const { token } = await dependencies.signJWT({
    body: {
      payload: {
        iat: Math.floor(now / 1000),
        sub: `channel_${credential.channelId}`,
      },
    },
  });
  const requestId = crypto.randomUUID();
  const origin = secret.slice(
    INTAKE_SECRET_PREFIX.length,
    INTAKE_SECRET_PREFIX.length + INTAKE_DISPLAY_PREFIX_LENGTH,
  );

  let response: Response;
  try {
    response = await fetchImplementation(
      `${INTERNAL_APPLICATION_ORIGIN}/v1/organizations/${encodeURIComponent(credential.organizationId)}/inbox/channels/${encodeURIComponent(credential.channelId)}/items`,
      {
        body: forward.body,
        cache: 'no-store',
        duplex: 'half',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': forward.contentType,
          'x-bap-intake-origin': origin,
          'x-bap-request-id': requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(INTAKE_TIMEOUT_MS),
      } as RequestInit & { duplex: 'half' },
    );
  } catch {
    webLogger.error('intake upstream call failed', {
      channelId: credential.channelId,
      operation: 'postIntakeItem',
      reason: 'unreachable',
    });
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }

  if (response.status !== 202) {
    if (response.status >= 500) {
      webLogger.error('intake upstream call failed', {
        channelId: credential.channelId,
        operation: 'postIntakeItem',
        reason: 'unreachable',
      });
      return jsonResponse({ error: 'service_unavailable' }, 502);
    }
    webLogger.info('intake rejected', {
      channelId: credential.channelId,
      operation: 'postIntakeItem',
      status: response.status,
    });
    return jsonResponse(
      { error: upstreamErrorCodes[response.status] ?? 'intake_rejected' },
      response.status,
      { 'x-request-id': requestId },
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    webLogger.error('intake upstream call failed', {
      channelId: credential.channelId,
      operation: 'postIntakeItem',
      reason: 'unreadable',
    });
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }
  const payload = inboxIntakeResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    webLogger.error('intake upstream call failed', {
      channelId: credential.channelId,
      operation: 'postIntakeItem',
      reason: 'unexpected_shape',
    });
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }

  webLogger.info('intake accepted', {
    channelId: credential.channelId,
    itemId: payload.data.itemId,
    operation: 'postIntakeItem',
    status: payload.data.status,
  });
  return jsonResponse(payload.data, 202, { 'x-request-id': requestId });
}
