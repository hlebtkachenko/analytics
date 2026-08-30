import { assemblePrompt, streamModelText } from '@bap/ai';
import type { AiRegistry } from '@bap/ai';
import { z } from 'zod';

import {
  getDatasetRows,
  getDatasets,
  getOrganizationAccess,
} from '../auth/bff.ts';
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
// A dataset with hundreds of columns must still describe itself in a bounded prompt.
const maxContextColumns = 40;
const maxContextNameCharacters = 120;
const maxContextDescriptionCharacters = 400;
const maxContextColumnCharacters = 80;
// The dataset contract exposes no metadata-only route, so the smallest page is asked for and only its columns are read.
const datasetColumnPageSize = 1;
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
    // Bounds and format come from the BFF schema, which answers an invisible dataset like a missing one.
    datasetId: z.string().optional(),
    // Bounds and format come from the BFF schema, which refuses a forged selector before it signs anything.
    organizationId: z.string(),
  })
  .strict();

// The BFF already validated the whole access contract, so only the gated capability is read back.
const chatAccessSchema = z.object({
  capabilities: z.object({ useAi: z.boolean() }),
});

// Only the metadata the context may quote is described, so the BFF list loses everything else here.
const datasetListSchema = z.object({
  datasets: z.array(
    z.object({
      description: z.string().nullable(),
      id: z.string(),
      name: z.string(),
    }),
  ),
});

// `rows` is deliberately absent: the parsed value carries no cell for the context to reach.
const datasetColumnsSchema = z.object({
  columns: z.array(z.object({ inferredType: z.string(), name: z.string() })),
});

type DatasetContext = Readonly<{
  columns: z.infer<typeof datasetColumnsSchema>['columns'];
  description: string | null;
  name: string;
}>;

const promptSections = [
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
];

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

// Metadata only: the name, the description, and the column headers, never a stored cell.
function describeDataset(dataset: DatasetContext): string {
  const listed = dataset.columns.slice(0, maxContextColumns);
  const withheld = dataset.columns.length - listed.length;
  const lines = [
    `Name: ${clip(dataset.name, maxContextNameCharacters)}`,
    `Description: ${dataset.description === null ? 'none' : clip(dataset.description, maxContextDescriptionCharacters)}`,
    `Columns (${String(dataset.columns.length)}):`,
    ...listed.map(
      (column) =>
        `- ${clip(column.name, maxContextColumnCharacters)}: ${clip(column.inferredType, maxContextColumnCharacters)}`,
    ),
  ];

  if (withheld > 0) {
    lines.push(`${String(withheld)} further columns are not listed.`);
  }

  lines.push('No row of this dataset is available to you, so quote none.');
  return lines.join('\n');
}

function buildSystemPrompt(dataset: DatasetContext | undefined): string {
  return assemblePrompt(
    dataset === undefined
      ? promptSections
      : [
          ...promptSections,
          { content: describeDataset(dataset), title: 'Open dataset' },
        ],
  );
}

export type ChatAuth = Pick<BffAuth, 'getSession' | 'signJWT'>;

export interface ChatDependencies {
  auth: ChatAuth;
  // Injected so a test resolves membership without reaching the application API.
  fetchImplementation?: typeof fetch;
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

// The row reader takes its page from the URL, so the turn asks for the smallest page the contract allows.
function smallestRowPageRequest(request: Request): Request {
  const url = new URL(request.url);
  url.search = `pageSize=${String(datasetColumnPageSize)}`;
  return new Request(url, { headers: request.headers });
}

type DatasetResolution =
  Readonly<{ dataset: DatasetContext }> | Readonly<{ failure: Response }>;

// Resolved through the same BFF calls the dataset pages make, so row level security decides visibility.
async function resolveDataset(
  dependencies: ChatDependencies,
  request: Request,
  organizationId: string,
  datasetId: string,
): Promise<DatasetResolution> {
  const listResponse = await getDatasets(
    dependencies.auth,
    request,
    organizationId,
    dependencies.fetchImplementation,
  );

  if (!listResponse.ok) {
    return { failure: listResponse };
  }

  const list = datasetListSchema.safeParse(await listResponse.json());

  if (!list.success) {
    return { failure: jsonResponse({ error: 'service_unavailable' }, 502) };
  }

  const summary = list.data.datasets.find(
    (candidate) => candidate.id === datasetId,
  );

  // A dataset the caller cannot see is absent from the list, so the turn is refused rather than answered ungrounded.
  if (summary === undefined) {
    return { failure: jsonResponse({ error: 'dataset_not_found' }, 404) };
  }

  const columnsResponse = await getDatasetRows(
    dependencies.auth,
    smallestRowPageRequest(request),
    organizationId,
    datasetId,
    dependencies.fetchImplementation,
  );

  if (!columnsResponse.ok) {
    return { failure: columnsResponse };
  }

  const columns = datasetColumnsSchema.safeParse(await columnsResponse.json());

  if (!columns.success) {
    return { failure: jsonResponse({ error: 'service_unavailable' }, 502) };
  }

  return {
    dataset: {
      columns: columns.data.columns,
      description: summary.description,
      name: summary.name,
    },
  };
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

  // A chat turn is organization work, so membership decides it before the credential is read.
  const accessResponse = await getOrganizationAccess(
    dependencies.auth,
    request,
    'application',
    parsed.data.organizationId,
    dependencies.fetchImplementation,
  );

  if (!accessResponse.ok) {
    return accessResponse;
  }

  const access = chatAccessSchema.safeParse(await accessResponse.json());

  // A member without the useAi capability is refused, and an unreadable contract fails closed.
  if (!access.success || !access.data.capabilities.useAi) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }

  let dataset: DatasetContext | undefined;

  // A named dataset grounds the turn, and one the caller cannot see refuses it before the credential is read.
  if (parsed.data.datasetId !== undefined) {
    const resolved = await resolveDataset(
      dependencies,
      request,
      parsed.data.organizationId,
      parsed.data.datasetId,
    );

    if ('failure' in resolved) {
      return resolved.failure;
    }

    dataset = resolved.dataset;
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
    system: buildSystemPrompt(dataset),
  });

  return result.toUIMessageStreamResponse();
}
