import { assemblePrompt, streamModelText } from '@bap/ai';
import type { AiRegistry } from '@bap/ai';
import { z } from 'zod';

import type { BffAuth } from '../auth/bff.ts';
import type { ChatRateLimiter } from './rate-limit.ts';

// The credential names one model per role, and this route asks for the chat role.
const chatModelRole = 'chat';
// A turn is a conversation, not a corpus: these ceilings bound provider cost per request.
const maxMessages = 24;
const maxMessageCharacters = 4_000;
const maxConversationCharacters = 24_000;
// Comfortably above the character ceiling once JSON escaping is counted.
const maxBodyBytes = 64_000;
// A model turn legitimately outlives the 3 second access budget, so it gets the upload ceiling instead.
const streamTimeoutMs = 120_000;

// Ten turns a minute is an interactive pace; anything faster is automation.
export const chatRateLimit = {
  limit: 10,
  maxEntries: 10_000,
  windowMs: 60_000,
} as const;

const chatMessageSchema = z.discriminatedUnion('role', [
  z
    .object({
      content: z.string().min(1).max(maxMessageCharacters),
      role: z.literal('assistant'),
    })
    .strict(),
  z
    .object({
      content: z.string().min(1).max(maxMessageCharacters),
      role: z.literal('user'),
    })
    .strict(),
]);

const chatRequestSchema = z
  .object({
    messages: z
      .array(chatMessageSchema)
      .min(1)
      .max(maxMessages)
      .refine(
        (messages) =>
          messages.reduce(
            (total, message) => total + message.content.length,
            0,
          ) <= maxConversationCharacters,
      ),
  })
  .strict();

const systemPrompt = assemblePrompt([
  {
    content:
      'You are the BAP analytics assistant. Answer the signed-in operator in English, briefly and plainly.',
    title: 'Role',
  },
  {
    content:
      'Use only what this conversation contains. Name what you do not know instead of inventing organization data.',
    title: 'Limits',
  },
]);

export type ChatAuth = Pick<BffAuth, 'getSession'>;

export interface ChatDependencies {
  auth: ChatAuth;
  limiter: ChatRateLimiter;
  // Deferred so an unauthenticated request never reaches the provider credential.
  loadRegistry: () => Promise<AiRegistry>;
}

const privateResponseHeaders = { 'cache-control': 'private, no-store' };

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

export async function handleChatRequest(
  dependencies: ChatDependencies,
  request: Request,
): Promise<Response> {
  const session = await dependencies.auth.getSession({
    headers: request.headers,
  });

  if (!session?.user.emailVerified) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const decision = dependencies.limiter.check(session.user.id);

  if (!decision.allowed) {
    return jsonResponse({ error: 'rate_limited' }, 429, {
      'retry-after': String(decision.retryAfterSeconds),
    });
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.startsWith('application/json')) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const declaredBytes = Number(request.headers.get('content-length') ?? '');

  // A chunked body has no declared size, so the ceiling could not be enforced before parsing.
  if (!Number.isInteger(declaredBytes) || declaredBytes < 1) {
    return jsonResponse({ error: 'invalid_request' }, 411);
  }

  if (declaredBytes > maxBodyBytes) {
    return jsonResponse({ error: 'invalid_request' }, 413);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  let registry: AiRegistry;
  let modelId: ReturnType<AiRegistry['modelId']>;

  try {
    registry = await dependencies.loadRegistry();
    modelId = registry.modelId(chatModelRole);
  } catch {
    // A credential problem names the provider and the file, so only the outcome is reported.
    return jsonResponse({ error: 'assistant_unavailable' }, 503);
  }

  const result = streamModelText(registry, modelId, {
    // An abandoned browser must not keep a paid stream running.
    abortSignal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(streamTimeoutMs),
    ]),
    messages: parsed.data.messages,
    system: systemPrompt,
  });

  return result.toUIMessageStreamResponse();
}
