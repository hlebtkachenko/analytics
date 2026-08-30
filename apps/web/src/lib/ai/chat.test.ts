import type { AiLanguageModel, AiRegistry } from '@bap/ai';
import { describe, expect, it, vi } from 'vitest';

import { handleChatRequest } from './chat.ts';
import type { ChatAuth, ChatDependencies } from './chat.ts';
import { ChatRateLimiter } from './rate-limit.ts';

const modelUsage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 11, total: 11 },
  outputTokens: { reasoning: 0, text: 5, total: 5 },
};

type ModelPrompt = Parameters<AiLanguageModel['doStream']>[0]['prompt'];

// A hand-built model spec instance: apps/web cannot import the `ai/test` helpers.
function mockModel(
  deltas: readonly string[],
  prompts: ModelPrompt[] = [],
): AiLanguageModel {
  return {
    doGenerate: () => Promise.reject(new Error('This route only streams.')),
    doStream: (options) => {
      prompts.push(options.prompt);
      return Promise.resolve({
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
      });
    },
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
  };
}

function signedInAuth(id = 'user_1'): ChatAuth {
  return {
    getSession: vi
      .fn<ChatAuth['getSession']>()
      .mockResolvedValue({ user: { emailVerified: true, id } }),
    signJWT: vi
      .fn<ChatAuth['signJWT']>()
      .mockResolvedValue({ token: 'resource-credential' }),
  };
}

// The access contract the application API returns for a member of org_1.
const memberAccess = {
  capabilities: {
    manageGrants: false,
    manageMembers: false,
    uploadData: true,
    useAi: true,
  },
  organizationId: 'org_1',
  role: 'member',
  service: 'application-api',
};

function accessFetch(payload: unknown = memberAccess, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(payload, { status })),
  );
}

function chatDependencies(
  overrides: Partial<ChatDependencies> = {},
): ChatDependencies {
  return {
    auth: signedInAuth(),
    fetchImplementation: accessFetch(),
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
    JSON.stringify({
      messages: [{ content: question, role: 'user' }],
      organizationId: 'org_1',
    }),
  );
}

const datasetId = '00000000-0000-4000-8000-000000000001';

// The dataset the list makes visible to a member of org_1.
const visibleDataset = {
  createdAt: '2026-01-01T00:00:00.000Z',
  description: 'Weekly totals per region.',
  id: datasetId,
  name: 'Weekly revenue',
  rowCount: 2,
  status: 'ready',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

// The cell values the row reader returns and the context must never carry.
const storedRow = { data: { region: 'Prague', revenue: 4211 }, rowNumber: 1 };

const twoColumns = [
  { inferredType: 'text', name: 'region', position: 0 },
  { inferredType: 'number', name: 'revenue', position: 1 },
];

// Long enough that an unbounded context would run to hundreds of kilobytes.
function manyColumns(count: number) {
  return Array.from({ length: count }, (_column, index) => ({
    inferredType: 'text',
    name: `column_${String(index).padStart(3, '0')}_${'x'.repeat(200)}`,
    position: index,
  }));
}

// Answers the access, dataset list, and row page calls the way the application API does.
function datasetFetch(
  options: Readonly<{
    columns?: readonly (typeof twoColumns)[number][];
    datasets?: readonly (typeof visibleDataset)[];
  }> = {},
) {
  return vi.fn<typeof fetch>((input) => {
    const url = String(input);

    if (url.endsWith('/access')) {
      return Promise.resolve(Response.json(memberAccess));
    }

    if (url.includes('/rows')) {
      return Promise.resolve(
        Response.json({
          columns: options.columns ?? twoColumns,
          datasetId,
          nextCursor: null,
          pageSize: 1,
          rows: [storedRow],
        }),
      );
    }

    return Promise.resolve(
      Response.json({ datasets: options.datasets ?? [visibleDataset] }),
    );
  });
}

function groundedRequest(named = datasetId): Request {
  return chatRequest(
    JSON.stringify({
      datasetId: named,
      messages: [{ content: 'What does this dataset hold?', role: 'user' }],
      organizationId: 'org_1',
    }),
  );
}

// Keeps the assembled prompt from the mocked provider so the context can be read back.
function capturingDependencies(
  overrides: Partial<ChatDependencies> = {},
): Readonly<{ dependencies: ChatDependencies; prompts: ModelPrompt[] }> {
  const prompts: ModelPrompt[] = [];
  return {
    dependencies: chatDependencies({
      loadRegistry: vi
        .fn<ChatDependencies['loadRegistry']>()
        .mockResolvedValue(
          mockRegistry(mockModel(['mocked ', 'stream'], prompts)),
        ),
      ...overrides,
    }),
    prompts,
  };
}

function systemPrompt(prompts: readonly ModelPrompt[]): string {
  const system = prompts[0]?.find(
    (message): message is Extract<ModelPrompt[number], { role: 'system' }> =>
      message.role === 'system',
  );
  return system?.content ?? '';
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
        ...signedInAuth(),
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
        ...signedInAuth(),
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
          organizationId: 'org_1',
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
      chatRequest(JSON.stringify({ messages, organizationId: 'org_1' })),
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
      chatRequest(JSON.stringify({ messages, organizationId: 'org_1' })),
    );

    expect(response.status).toBe(400);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a body that declares no size', async () => {
    const dependencies = chatDependencies();
    const request = new Request('https://bap.invalid/api/chat', {
      body: JSON.stringify({
        messages: [{ content: 'hello', role: 'user' }],
        organizationId: 'org_1',
      }),
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
      chatRequest(JSON.stringify({ messages: [], organizationId: 'org_1' }), {
        'content-length': '64001',
      }),
    );

    expect(response.status).toBe(413);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('streams the mocked model output as server-sent events', async () => {
    const fetchImplementation = accessFetch();

    const response = await handleChatRequest(
      chatDependencies({ fetchImplementation }),
      askRequest(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await readDeltas(response)).toBe('mocked stream');
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      'http://api:3001/v1/organizations/org_1/access',
    );
  });

  it('refuses a request that names no organization', async () => {
    const dependencies = chatDependencies();

    const response = await handleChatRequest(
      dependencies,
      chatRequest(
        JSON.stringify({ messages: [{ content: 'hello', role: 'user' }] }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not a member of the named organization', async () => {
    const dependencies = chatDependencies({
      fetchImplementation: accessFetch({ error: 'access_denied' }, 403),
    });

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a member whose contract withholds the useAi capability', async () => {
    const dependencies = chatDependencies({
      fetchImplementation: accessFetch({
        ...memberAccess,
        capabilities: { ...memberAccess.capabilities, useAi: false },
      }),
    });

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('refuses a forged organization selector before it mints a credential', async () => {
    const dependencies = chatDependencies();

    const response = await handleChatRequest(
      dependencies,
      chatRequest(
        JSON.stringify({
          messages: [{ content: 'hello', role: 'user' }],
          organizationId: '../forged',
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(dependencies.auth.signJWT).not.toHaveBeenCalled();
    expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
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

  it('refuses a dataset the caller cannot see before the credential is read', async () => {
    const fetchImplementation = datasetFetch({ datasets: [] });
    const dependencies = chatDependencies({ fetchImplementation });

    const response = await handleChatRequest(dependencies, groundedRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'dataset_not_found' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    // The row reader is never called either, so nothing about the dataset is fetched.
    expect(
      fetchImplementation.mock.calls.map((call) => String(call[0])),
    ).toEqual([
      'http://api:3001/v1/organizations/org_1/access',
      'http://api:3001/v1/organizations/org_1/datasets',
    ]);
    expect(dependencies.loadRegistry).not.toHaveBeenCalled();
  });

  it('grounds the turn in dataset metadata and never in row content', async () => {
    const fetchImplementation = datasetFetch();
    const { dependencies, prompts } = capturingDependencies({
      fetchImplementation,
    });

    const response = await handleChatRequest(dependencies, groundedRequest());

    expect(response.status).toBe(200);
    await response.text();
    const context = systemPrompt(prompts);
    expect(context).toContain('Weekly revenue');
    expect(context).toContain('Weekly totals per region.');
    expect(context).toContain('- region: text');
    expect(context).toContain('- revenue: number');
    // No cell of the row the reader returned reaches the provider, in the context or anywhere else.
    expect(JSON.stringify(prompts)).not.toContain('Prague');
    expect(JSON.stringify(prompts)).not.toContain('4211');
    expect(String(fetchImplementation.mock.calls[2]?.[0])).toBe(
      `http://api:3001/v1/organizations/org_1/datasets/${datasetId}/rows?pageSize=1`,
    );
  });

  it('bounds the context of a dataset with hundreds of long columns', async () => {
    const { dependencies, prompts } = capturingDependencies({
      fetchImplementation: datasetFetch({
        columns: manyColumns(300),
        datasets: [
          {
            ...visibleDataset,
            description: 'd'.repeat(2_000),
            name: 'n'.repeat(500),
          },
        ],
      }),
    });

    const response = await handleChatRequest(dependencies, groundedRequest());

    expect(response.status).toBe(200);
    await response.text();
    const context = systemPrompt(prompts);
    expect(context).toContain('Columns (300):');
    expect(context).toContain('- column_000_');
    expect(context).toContain('- column_039_');
    expect(context).not.toContain('column_040');
    expect(context).toContain('260 further columns are not listed.');
    // Every field is clipped, so no name, description, or column name arrives whole.
    expect(context).not.toContain('n'.repeat(121));
    expect(context).not.toContain('d'.repeat(401));
    expect(context).not.toContain('x'.repeat(81));
    expect(context.length).toBeLessThan(8_000);
  });

  it('assembles no dataset context when the turn names no dataset', async () => {
    const { dependencies, prompts } = capturingDependencies();

    const response = await handleChatRequest(dependencies, askRequest());

    expect(response.status).toBe(200);
    await response.text();
    expect(systemPrompt(prompts)).not.toContain('Open dataset');
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
