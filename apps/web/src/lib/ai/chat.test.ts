import type { AiLanguageModel, AiRegistry } from '@bap/ai';
import { describe, expect, it, vi } from 'vitest';

import { handleChatRequest } from './chat.ts';
import type { ChatAuth, ChatDependencies } from './chat.ts';
import { ChatRateLimiter } from './rate-limit.ts';

const modelUsage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 11, total: 11 },
  outputTokens: { reasoning: 0, text: 5, total: 5 },
};

// A hand-built model spec instance: apps/web cannot import the `ai/test` helpers.
function mockModel(deltas: readonly string[]): AiLanguageModel {
  return {
    doGenerate: () => Promise.reject(new Error('This route only streams.')),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ id: '1', type: 'text-start' });
            for (const delta of deltas) {
              controller.enqueue({ delta, id: '1', type: 'text-delta' });
            }
            controller.enqueue({ id: '1', type: 'text-end' });
            controller.enqueue({
              finishReason: { raw: 'end_turn', unified: 'stop' },
              type: 'finish',
              usage: modelUsage,
            });
            controller.close();
          },
        }),
      }),
    modelId: 'mock-model',
    provider: 'mock',
    specificationVersion: 'v4',
    supportedUrls: {},
  };
}

function mockRegistry(model: AiLanguageModel): AiRegistry {
  return {
    embeddingModel: () => {
      throw new Error('The chat route resolves no embedding model.');
    },
    languageModel: () => model,
    modelId: () => 'anthropic:mock-model',
    provider: 'anthropic',
  };
}

function signedInAuth(id = 'user_1'): ChatAuth {
  return {
    getSession: vi
      .fn<ChatAuth['getSession']>()
      .mockResolvedValue({ user: { emailVerified: true, id } }),
  };
}

function chatDependencies(
  overrides: Partial<ChatDependencies> = {},
): ChatDependencies {
  return {
    auth: signedInAuth(),
    limiter: new ChatRateLimiter({
      limit: 2,
      maxEntries: 10,
      windowMs: 60_000,
    }),
    loadRegistry: vi
      .fn<ChatDependencies['loadRegistry']>()
      .mockResolvedValue(mockRegistry(mockModel(['mocked ', 'stream']))),
    ...overrides,
  };
}

function chatRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://bap.invalid/api/chat', {
    body,
    headers: {
      'content-length': String(new TextEncoder().encode(body).length),
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });
}

function askRequest(question = 'What changed this week?'): Request {
  return chatRequest(
    JSON.stringify({ messages: [{ content: question, role: 'user' }] }),
  );
}

// The UI message stream is SSE, so the text deltas arrive as JSON data lines.
async function readDeltas(response: Response): Promise<string> {
  const body = await response.text();
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as { delta?: string; type: string })
    .filter((part) => part.type === 'text-delta')
    .map((part) => part.delta ?? '')
    .join('');
}

describe('handleChatRequest', () => {
  it('rejects an unauthenticated request before any provider is reached', async () => {
    const dependencies = chatDependencies({
      auth: {
        getSession: vi.fn<ChatAuth['getSession']>().mockResolvedValue(null),
      },
    });

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects an unverified account before any provider is reached', async () => {
    const dependencies = chatDependencies({
      auth: {
        getSession: vi
          .fn<ChatAuth['getSession']>()
          .mockResolvedValue({ user: { emailVerified: false, id: 'user_1' } }),
      },
    });

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(401);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload before any provider is reached', async () => {
    const dependencies = chatDependencies();

    const response = await handleChatRequest(
      dependencies,
      chatRequest('{"messages":'),
    );

    expect(response.status).toBe(400);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects a payload the schema does not describe', async () => {
    const dependencies = chatDependencies();

    const response = await handleChatRequest(
      dependencies,
      chatRequest(
        JSON.stringify({
          messages: [{ content: 'hello', role: 'system' }],
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects a conversation past the message ceiling', async () => {
    const dependencies = chatDependencies();
    const messages = Array.from({ length: 25 }, () => ({
      content: 'hello',
      role: 'user',
    }));

    const response = await handleChatRequest(
      dependencies,
      chatRequest(JSON.stringify({ messages })),
    );

    expect(response.status).toBe(400);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects a conversation past the character ceiling', async () => {
    const dependencies = chatDependencies();
    const messages = Array.from({ length: 10 }, () => ({
      content: 'a'.repeat(3_000),
      role: 'user',
    }));

    const response = await handleChatRequest(
      dependencies,
      chatRequest(JSON.stringify({ messages })),
    );

    expect(response.status).toBe(400);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a body that declares no size', async () => {
    const dependencies = chatDependencies();
    const request = new Request('https://bap.invalid/api/chat', {
      body: JSON.stringify({ messages: [{ content: 'hello', role: 'user' }] }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    const response = await handleChatRequest(dependencies, request);

    expect(response.status).toBe(411);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a body whose declared size exceeds the ceiling', async () => {
    const dependencies = chatDependencies();

    const response = await handleChatRequest(
      dependencies,
      chatRequest(JSON.stringify({ messages: [] }), {
        'content-length': '64001',
      }),
    );

    expect(response.status).toBe(413);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('streams the mocked model output as server-sent events', async () => {
    const response = await handleChatRequest(chatDependencies(), askRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await readDeltas(response)).toBe('mocked stream');
  });

  it('rejects a subject past the rate limit and leaves other subjects alone', async () => {
    const limiter = new ChatRateLimiter({
      limit: 2,
      maxEntries: 10,
      windowMs: 60_000,
    });
    const dependencies = chatDependencies({ limiter });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const allowed = await handleChatRequest(dependencies, askRequest());
      expect(allowed.status).toBe(200);
      await allowed.text();
    }

    const limited = await handleChatRequest(dependencies, askRequest());

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('retry-after')).toBe('60');

    const other = await handleChatRequest(
      chatDependencies({ auth: signedInAuth('user_2'), limiter }),
      askRequest(),
    );

    expect(other.status).toBe(200);
    await other.text();
  });

  it('reports an unavailable assistant when no chat model is configured', async () => {
    const dependencies = chatDependencies({
      loadRegistry: vi
        .fn<ChatDependencies['loadRegistry']>()
        .mockRejectedValue(new Error('The AI credential names no model.')),
    });

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'assistant_unavailable' });
  });
});
