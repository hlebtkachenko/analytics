import type { DatabasePool } from '@bap/db/pool';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

import type { BffAuth } from '../auth/bff.ts';
import { webLogger } from '../logger.ts';
import {
  INTAKE_DISPLAY_PREFIX_LENGTH,
  inboxIntakeResponseSchema,
} from './contract.ts';
import {
  INTERNAL_APPLICATION_ORIGIN,
  consumeEdgeBucket,
  edgeBucketRetryAfterSeconds,
  edgeRateLimitKey,
  jsonResponse,
  mintChannelToken,
  resolveChannelCredential,
} from './intake.ts';

// Mailgun's ceiling is 25 MB; the form overhead around a message at that ceiling fits under 30 MB.
export const INBOUND_MAX_BYTES = 30_000_000;
export const INBOUND_TIMESTAMP_WINDOW_SECONDS = 300;
export const INBOUND_RETRY_AFTER_SECONDS = 30;
export const DEFAULT_INBOUND_MAX_IN_FLIGHT = 4;
const RATE_LIMIT_KEY_PREFIX = 'bap-edge:inbound:';
const OPERATION = 'postInboundMailgunMime';
const FORWARD_TIMEOUT_MS = 120_000;
const LOCAL_PART_PREFIX = 'in-';
const LOCAL_PART_PATTERN = /^in-[0-9a-f]{32}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,16}$/;
// The API's own header bounds, checked here so a bad value answers 406 rather than a forwarded 400.
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SENDER_PATTERN = /^[\x20-\x7e]{1,320}$/;

const inboundEnvironmentSchema = z.object({
  BAP_INBOUND_MAX_IN_FLIGHT: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(DEFAULT_INBOUND_MAX_IN_FLIGHT),
  BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE: z.string().min(1),
});

export type InboundConfiguration = Readonly<{
  maxInFlight: number;
  signingKey: string;
}>;

// The key file is read once and never echoed; a placeholder-free, protected regular file as ADR 0005 requires.
export async function loadInboundConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<InboundConfiguration> {
  const parsed = inboundEnvironmentSchema.parse(environment);
  const path = parsed.BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE;
  const details = await stat(path);
  const permissions = details.mode & 0o777;
  if (!details.isFile() || ![0o400, 0o444, 0o600].includes(permissions)) {
    throw new Error(
      'Mailgun webhook signing key must be a protected regular file.',
    );
  }
  const signingKey = (await readFile(path, 'utf8')).trim();
  if (signingKey.length === 0) {
    throw new Error('Mailgun webhook signing key file is empty.');
  }
  return { maxInFlight: parsed.BAP_INBOUND_MAX_IN_FLIGHT, signingKey };
}

export type InFlightGate = Readonly<{
  acquire: () => boolean;
  release: () => void;
}>;

// A counter, not a queue: past the limit the poster is told to retry rather than wait.
export function createInFlightGate(limit: number): InFlightGate {
  let inFlight = 0;
  return {
    acquire: () => {
      if (inFlight >= limit) {
        return false;
      }
      inFlight += 1;
      return true;
    },
    release: () => {
      inFlight -= 1;
    },
  };
}

export type InboundDependencies = Readonly<{
  fetchImplementation?: typeof fetch;
  gate: InFlightGate;
  loadPool: () => Promise<DatabasePool>;
  now?: () => number;
  signingKey: string;
  signJWT: BffAuth['signJWT'];
}>;

type FormFields = Readonly<{
  bodyMime: FormDataEntryValue | null;
  recipient: string | null;
  sender: string | null;
  signature: string | null;
  timestamp: string | null;
  token: string | null;
}>;

function stringField(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

function refused(reason: string, status: number, error: string): Response {
  webLogger.warn('inbound refused', { operation: OPERATION, reason });
  return jsonResponse({ error }, status);
}

function unavailable(reason: string): Response {
  webLogger.error('inbound unavailable', { operation: OPERATION, reason });
  return jsonResponse({ error: 'service_unavailable' }, 502);
}

// The hex signature is compared in constant time; a length mismatch is refused before the compare.
function signatureVerified(
  fields: FormFields,
  signingKey: string,
  now: number,
): boolean {
  const { signature, timestamp, token } = fields;
  if (
    signature === null ||
    timestamp === null ||
    token === null ||
    !SIGNATURE_PATTERN.test(signature) ||
    !TIMESTAMP_PATTERN.test(timestamp) ||
    token.length === 0
  ) {
    return false;
  }
  const expected = createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    return false;
  }
  const skewSeconds = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  return skewSeconds <= INBOUND_TIMESTAMP_WINDOW_SECONDS;
}

// The local part alone binds the post; the domain and every header of the message bind nothing.
function recipientLocalPart(recipient: string | null): string | null {
  if (recipient === null) {
    return null;
  }
  const at = recipient.lastIndexOf('@');
  const local = (at === -1 ? recipient : recipient.slice(0, at))
    .trim()
    .toLowerCase();
  return LOCAL_PART_PATTERN.test(local) ? local : null;
}

// The raw MIME is forwarded as the Blob the form parser produced, never copied.
function mimeBody(value: FormDataEntryValue | null): Blob | null {
  if (value === null) {
    return null;
  }
  const blob =
    typeof value === 'string'
      ? new Blob([value], { type: 'message/rfc822' })
      : value;
  return blob.size === 0 || blob.size > INBOUND_MAX_BYTES ? null : blob;
}

// The public inbound route: gate, size, bucket, form, signature, recipient, then one forwarded call.
export async function postInboundMailgunMime(
  request: Request,
  dependencies: InboundDependencies,
): Promise<Response> {
  if (!dependencies.gate.acquire()) {
    webLogger.warn('inbound deferred', {
      operation: OPERATION,
      reason: 'in_flight_limit',
    });
    return jsonResponse({ error: 'busy' }, 503, {
      'retry-after': String(INBOUND_RETRY_AFTER_SECONDS),
    });
  }
  try {
    return await handleInbound(request, dependencies);
  } finally {
    dependencies.gate.release();
  }
}

async function handleInbound(
  request: Request,
  dependencies: InboundDependencies,
): Promise<Response> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const now = dependencies.now?.() ?? Date.now();

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > INBOUND_MAX_BYTES) {
    return refused('too_large', 406, 'too_large');
  }

  const key = edgeRateLimitKey(request, RATE_LIMIT_KEY_PREFIX);
  let pool: DatabasePool;
  try {
    pool = await dependencies.loadPool();
    const retryAfterSeconds = await edgeBucketRetryAfterSeconds(pool, key, now);
    if (retryAfterSeconds !== null) {
      webLogger.warn('inbound refused', {
        operation: OPERATION,
        reason: 'rate_limited',
      });
      return jsonResponse({ error: 'rate_limited', retryAfterSeconds }, 429, {
        'retry-after': String(retryAfterSeconds),
      });
    }
  } catch {
    webLogger.error('inbound lookup failed', {
      operation: OPERATION,
      reason: 'unavailable',
    });
    return jsonResponse({ error: 'inbound_unavailable' }, 503);
  }

  let fields: FormFields;
  try {
    const form = await request.formData();
    fields = {
      bodyMime: form.get('body-mime'),
      recipient: stringField(form, 'recipient'),
      sender: stringField(form, 'sender'),
      signature: stringField(form, 'signature'),
      timestamp: stringField(form, 'timestamp'),
      token: stringField(form, 'token'),
    };
  } catch {
    fields = {
      bodyMime: null,
      recipient: null,
      sender: null,
      signature: null,
      timestamp: null,
      token: null,
    };
  }

  // An unsigned poster is not Mailgun: it spends the bucket, exactly as an unknown bearer does.
  if (!signatureVerified(fields, dependencies.signingKey, now)) {
    try {
      await consumeEdgeBucket(pool, key, RATE_LIMIT_KEY_PREFIX, now);
    } catch {
      webLogger.error('inbound lookup failed', {
        operation: OPERATION,
        reason: 'unavailable',
      });
      return jsonResponse({ error: 'inbound_unavailable' }, 503);
    }
    return refused('signature_invalid', 401, 'unauthorized');
  }

  const localPart = recipientLocalPart(fields.recipient);
  if (localPart === null) {
    return refused('recipient_malformed', 406, 'recipient_unknown');
  }
  if (!EXTERNAL_ID_PATTERN.test(fields.token!)) {
    return refused('token_malformed', 406, 'token_invalid');
  }

  let credential;
  try {
    credential = await resolveChannelCredential(pool, localPart);
  } catch {
    webLogger.error('inbound lookup failed', {
      operation: OPERATION,
      reason: 'unavailable',
    });
    return jsonResponse({ error: 'inbound_unavailable' }, 503);
  }
  // A signed miss never spends the bucket: the token has 128 bits and Mailgun stops on 406.
  if (credential === null || credential.kind !== 'email_address') {
    return refused('recipient_unknown', 406, 'recipient_unknown');
  }

  const body = mimeBody(fields.bodyMime);
  if (body === null) {
    return refused('body_missing', 406, 'invalid_body');
  }

  const token = await mintChannelToken(
    dependencies.signJWT,
    credential.channelId,
    now,
  );
  const requestId = crypto.randomUUID();
  const origin = localPart.slice(
    LOCAL_PART_PREFIX.length,
    LOCAL_PART_PREFIX.length + INTAKE_DISPLAY_PREFIX_LENGTH,
  );
  const sender =
    fields.sender !== null && SENDER_PATTERN.test(fields.sender)
      ? fields.sender
      : null;

  let response: Response;
  try {
    response = await fetchImplementation(
      `${INTERNAL_APPLICATION_ORIGIN}/v1/organizations/${encodeURIComponent(credential.organizationId)}/inbox/channels/${encodeURIComponent(credential.channelId)}/email`,
      {
        body,
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'message/rfc822',
          'x-bap-intake-external-id': fields.token!,
          'x-bap-intake-origin': origin,
          ...(sender === null ? {} : { 'x-bap-intake-sender': sender }),
          'x-bap-request-id': requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      },
    );
  } catch {
    webLogger.error('inbound upstream call failed', {
      channelId: credential.channelId,
      operation: OPERATION,
      reason: 'unreachable',
    });
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }

  if (response.status !== 202) {
    return mapUpstreamRefusal(response, credential.channelId);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return unavailable('unreadable');
  }
  const payload = inboxIntakeResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    return unavailable('unexpected_shape');
  }

  webLogger.info('inbound accepted', {
    channelId: credential.channelId,
    itemId: payload.data.itemId,
    operation: OPERATION,
    status: payload.data.status,
  });
  return jsonResponse({ itemId: payload.data.itemId }, 200, {
    'x-request-id': requestId,
  });
}

// 406 stops Mailgun for good; 502 and 503 make it retry for eight hours.
function mapUpstreamRefusal(response: Response, channelId: string): Response {
  const { status } = response;
  if (status === 400 || status === 404 || status === 413 || status === 415) {
    webLogger.info('inbound rejected', {
      channelId,
      operation: OPERATION,
      status,
    });
    return jsonResponse({ error: 'rejected' }, 406);
  }
  if (status === 429) {
    webLogger.warn('inbound deferred', {
      channelId,
      operation: OPERATION,
      reason: 'upstream_rate_limited',
    });
    return jsonResponse({ error: 'busy' }, 503, {
      'retry-after':
        response.headers.get('retry-after') ??
        String(INBOUND_RETRY_AFTER_SECONDS),
    });
  }
  // The minted channel token is the web's own; an upstream refusal of it is a platform fault.
  webLogger.error('inbound upstream call failed', {
    channelId,
    operation: OPERATION,
    status,
  });
  return jsonResponse({ error: 'service_unavailable' }, 502);
}
