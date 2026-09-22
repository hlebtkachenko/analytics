import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboxItem } from '../inbox/contract.js';
import type { ComposedDocument } from '../inbox/draft-composer.js';
import {
  AUTO_ROUTE_PROVIDER,
  AUTOMATION_SUBJECT,
  routeInboxItem,
} from './route-inbox-item.js';
import { WorkerMetrics } from './worker-metrics.js';

const repository = vi.hoisted(() => ({
  finishRouteInTransaction: vi.fn(async () => undefined),
  insertExtraction: vi.fn(async () => undefined),
  loadItem: vi.fn(),
  loadItemFiles: vi.fn(async () => [{ blobId: BLOB_ID }]),
  loadLatestExtraction: vi.fn(async () => ({
    reasons: [{ evidence: 'rule 1: type pdf sets kind other', step: 'rule' }],
  })),
  loadMatchedRuleIds: vi.fn(async () => []),
  loadRouteSuggestion: vi.fn(),
}));
const documents = vi.hoisted(() => ({
  createDocumentInTransaction: vi.fn(),
}));
const BLOB_ID = '7d1c8a44-3d29-4b4a-9d9b-1f0c3e2a5b6c';

vi.mock('../inbox/inbox-repository.js', () => repository);
vi.mock('../documents/document-repository.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDocumentInTransaction: documents.createDocumentInTransaction,
}));

const ORGANIZATION = 'org_1';
const ITEM_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const RULE_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const ENTITY_ID = '2c9d5b1a-7e3f-4a8b-9c0d-1e2f3a4b5c6d';
const DOCUMENT_ID = '8b1e2d3c-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface FixtureOptions {
  authorRow?: Record<string, unknown>[];
  attempt?: { last_attempt: Date | null; last_touch: Date | null };
  membership?: Record<string, unknown>[];
  scope?: { granted: string[]; mode: string };
  // The skip definer raises: the item left review between the two transactions.
  skipRefused?: boolean;
}

interface Fixture {
  contexts: string[];
  metrics: WorkerMetrics;
  pool: DatabasePool;
  queries: RecordedQuery[];
  run: (ruleId?: string | null) => ReturnType<typeof routeInboxItem>;
}

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    assigneeId: null,
    channelId: null,
    channelKind: 'upload',
    confidence: 0.9,
    createdAt: '2026-09-17T08:00:00.000Z',
    datasetId: null,
    decidedByKind: null,
    decidedByRuleId: null,
    decidedByUserId: null,
    detectedType: 'pdf',
    documentId: null,
    duplicateOfItemId: null,
    hintKind: null,
    hintLegalEntityId: null,
    hintLinkDocumentId: null,
    hintPartnerId: null,
    hintText: null,
    humanTouched: false,
    id: ITEM_ID,
    legalEntityId: null,
    origin: null,
    partnerId: null,
    payloadKind: 'file',
    receivedAt: '2026-09-17T08:00:00.000Z',
    routedAt: null,
    snoozedUntil: null,
    status: 'needs_review',
    updatedAt: '2026-09-17T08:00:00.000Z',
    ...overrides,
  };
}

function composed(
  overrides: Partial<ComposedDocument['draft']> = {},
  missing: string[] = [],
): ComposedDocument {
  return {
    draft: {
      currencyCode: 'CZK',
      documentDate: '2026-09-17',
      kind: 'other',
      legalEntityId: ENTITY_ID,
      partnerId: null,
      reference: null,
      title: 'scan.pdf',
      ...overrides,
    },
    missing,
    sources: {
      currency_code: 'provider',
      document_date: 'provider',
      kind: 'rule',
      legal_entity_id: 'rule',
      partner_id: null,
      reference: null,
      title: 'provider',
    },
  };
}

function fixture(options: FixtureOptions = {}): Fixture {
  const queries: RecordedQuery[] = [];
  const contexts: string[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });

      if (text.includes('set_config')) {
        contexts.push(String(values[0]));
        return { rows: [] };
      }

      if (text.includes('from app.inbox_rule where id = $1')) {
        return { rows: options.authorRow ?? [{ created_by: 'user-1' }] };
      }

      if (text.includes('from app.list_inbox_routing_targets() where')) {
        return { rows: options.authorRow ?? [] };
      }

      if (
        options.skipRefused === true &&
        text.includes('app.record_inbox_automation_skip')
      ) {
        throw new Error(
          'Inbox automation skips name an item in review of the current organization',
        );
      }

      if (text.includes('last_attempt')) {
        return {
          rows: [options.attempt ?? { last_attempt: null, last_touch: null }],
        };
      }

      if (text.includes('app.member_entity_scope')) {
        return { rows: [{ mode: options.scope?.mode ?? 'all' }] };
      }

      if (text.includes('app.legal_entity_access')) {
        return {
          rows: (options.scope?.granted ?? []).map((id) => ({
            legal_entity_id: id,
          })),
        };
      }

      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
    query: async () => ({
      rows: options.membership ?? [{ email_verified: true, role: 'admin' }],
    }),
  } as unknown as DatabasePool;
  const metrics = new WorkerMetrics();

  return {
    contexts,
    metrics,
    pool,
    queries,
    run: (ruleId: string | null = RULE_ID) =>
      routeInboxItem({
        data: { itemId: ITEM_ID, organizationId: ORGANIZATION, ruleId },
        logger: { log: () => undefined },
        metrics,
        pool,
      }),
  };
}

function skipCalls(queries: RecordedQuery[]): RecordedQuery[] {
  return queries.filter((query) =>
    query.text.includes('app.record_inbox_automation_skip'),
  );
}

async function jobCount(
  metrics: WorkerMetrics,
  outcome: string,
): Promise<number> {
  const rendered = await metrics.render();
  const line = rendered
    .split('\n')
    .find(
      (candidate) =>
        candidate.includes('route_inbox_item') && candidate.includes(outcome),
    );
  return line === undefined ? 0 : Number(line.split(' ').at(-1));
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.loadItem.mockResolvedValue(item());
  repository.loadRouteSuggestion.mockResolvedValue(composed());
  documents.createDocumentInTransaction.mockResolvedValue({
    document: { id: DOCUMENT_ID, kind: 'other', legalEntityId: ENTITY_ID },
  });
});

describe('routeInboxItem author resolution', () => {
  it('reads the item and the author as the automation subject, then routes as the author', async () => {
    const context = fixture();
    const outcome = await context.run();

    expect(outcome).toEqual({ documentId: DOCUMENT_ID, kind: 'routed' });
    expect(context.contexts).toEqual([AUTOMATION_SUBJECT, 'user-1']);
    expect(repository.loadItem.mock.calls).toEqual([
      [expect.anything(), ITEM_ID, null],
      [expect.anything(), ITEM_ID, null, true],
    ]);
    expect(repository.finishRouteInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ORGANIZATION, role: 'admin', userId: 'user-1' },
      expect.objectContaining({ id: ITEM_ID }),
      { id: DOCUMENT_ID, kind: 'other', legalEntityId: ENTITY_ID },
      [BLOB_ID],
      { kind: 'rule', ruleId: RULE_ID },
    );
    expect(repository.insertExtraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
      ITEM_ID,
      expect.objectContaining({
        output: expect.objectContaining({
          issues: [],
          legalEntityId: ENTITY_ID,
          reasons: [
            { evidence: 'rule 1: type pdf sets kind other', step: 'rule' },
          ],
        }),
        provider: AUTO_ROUTE_PROVIDER,
      }),
    );
    expect(skipCalls(context.queries)).toEqual([]);
    expect(await jobCount(context.metrics, 'completed')).toBe(1);
  });

  it('routes a target default as its editor with decided_by_kind target_default', async () => {
    const context = fixture({ authorRow: [{ updated_by: 'user-7' }] });
    const outcome = await context.run(null);

    expect(outcome).toEqual({ documentId: DOCUMENT_ID, kind: 'routed' });
    expect(context.contexts).toEqual([AUTOMATION_SUBJECT, 'user-7']);
    expect(
      context.queries.find((query) =>
        query.text.includes('from app.list_inbox_routing_targets() where'),
      )?.values,
    ).toEqual(['pdf']);
    expect(repository.finishRouteInTransaction).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-7' }),
      expect.anything(),
      expect.anything(),
      [BLOB_ID],
      { kind: 'target_default', userId: 'user-7' },
    );
  });

  it.each([
    ['no membership', { membership: [] }],
    [
      'a member role',
      { membership: [{ email_verified: true, role: 'member' }] },
    ],
    ['an erased tombstone', { authorRow: [{ created_by: 'erased_1' }] }],
  ])(
    'records rule_author_unavailable and does not throw for %s',
    async (_name, options) => {
      const context = fixture(options);
      const outcome = await context.run();

      expect(outcome).toEqual({ kind: 'author_unavailable' });
      expect(context.contexts).toEqual([
        AUTOMATION_SUBJECT,
        AUTOMATION_SUBJECT,
      ]);
      expect(skipCalls(context.queries).map((query) => query.values)).toEqual([
        [ITEM_ID, 'rule_author_unavailable'],
      ]);
      expect(repository.insertExtraction).not.toHaveBeenCalled();
      expect(documents.createDocumentInTransaction).not.toHaveBeenCalled();
    },
  );

  it('refuses a rule that was disabled or deleted after the enqueue, writing nothing', async () => {
    const context = fixture({ authorRow: [] });

    expect(await context.run()).toEqual({
      kind: 'refused',
      reason: 'rule_unavailable',
    });
    expect(context.contexts).toEqual([AUTOMATION_SUBJECT]);
    expect(
      context.queries.find((query) =>
        query.text.includes('from app.inbox_rule where id = $1'),
      )?.text,
    ).toContain('and enabled and deleted_at is null');
    expect(skipCalls(context.queries)).toEqual([]);
    expect(await jobCount(context.metrics, 'completed')).toBe(1);
  });

  it('records the skip for a platform target default that has no editor', async () => {
    const context = fixture({ authorRow: [] });

    expect(await context.run(null)).toEqual({ kind: 'author_unavailable' });
    expect(skipCalls(context.queries)).toHaveLength(1);
  });

  it('records the skip when the author scope excludes the draft entity, writing nothing else', async () => {
    const context = fixture({ scope: { granted: [], mode: 'restricted' } });

    expect(await context.run()).toEqual({ kind: 'author_unavailable' });
    expect(context.contexts).toEqual([
      AUTOMATION_SUBJECT,
      'user-1',
      AUTOMATION_SUBJECT,
    ]);
    expect(skipCalls(context.queries)).toHaveLength(1);
    expect(repository.insertExtraction).not.toHaveBeenCalled();
    expect(documents.createDocumentInTransaction).not.toHaveBeenCalled();
  });

  it('checks the scope before the missing field, so a restricted author leaves no attempt row', async () => {
    repository.loadRouteSuggestion.mockResolvedValueOnce(
      composed({ kind: null }, ['kind']),
    );
    const context = fixture({ scope: { granted: [], mode: 'restricted' } });

    expect(await context.run()).toEqual({ kind: 'author_unavailable' });
    expect(repository.insertExtraction).not.toHaveBeenCalled();
    expect(skipCalls(context.queries)).toHaveLength(1);
  });

  it('refuses instead of retrying when the skip definer finds the item gone from review', async () => {
    const context = fixture({ membership: [], skipRefused: true });

    expect(await context.run()).toEqual({
      kind: 'refused',
      reason: 'item_unavailable',
    });
    expect(await jobCount(context.metrics, 'completed')).toBe(1);
    expect(await jobCount(context.metrics, 'failed')).toBe(0);
  });

  it('passes a restricted scope that admits the entity to the document create', async () => {
    const context = fixture({
      scope: { granted: [ENTITY_ID], mode: 'restricted' },
    });

    expect(await context.run()).toMatchObject({ kind: 'routed' });
    expect(documents.createDocumentInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inbox: { itemId: ITEM_ID, source: 'upload' },
        legalEntityIds: [ENTITY_ID],
        userId: 'user-1',
      }),
    );
  });
});

describe('routeInboxItem guardrails', () => {
  it('refuses before resolving the author when the item left review', async () => {
    repository.loadItem.mockResolvedValueOnce(item({ status: 'routed' }));
    const context = fixture();

    expect(await context.run()).toEqual({
      kind: 'refused',
      reason: 'item_unavailable',
    });
    expect(context.contexts).toEqual([AUTOMATION_SUBJECT]);
    expect(skipCalls(context.queries)).toEqual([]);
  });

  it.each([
    ['status', item({ status: 'discarded' })],
    ['user_decided', item({ decidedByKind: 'user', decidedByUserId: 'u' })],
    [
      'snoozed',
      item({ snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() }),
    ],
    ['item_unavailable', null],
  ])(
    'refuses %s under the row lock and writes nothing',
    async (reason, locked) => {
      repository.loadItem
        .mockResolvedValueOnce(item())
        .mockResolvedValueOnce(locked);
      const context = fixture();

      expect(await context.run()).toEqual({ kind: 'refused', reason });
      expect(repository.insertExtraction).not.toHaveBeenCalled();
      expect(documents.createDocumentInTransaction).not.toHaveBeenCalled();
      expect(skipCalls(context.queries)).toEqual([]);
      expect(await jobCount(context.metrics, 'completed')).toBe(1);
    },
  );

  it('lets a snooze that has passed through', async () => {
    repository.loadItem.mockResolvedValue(
      item({ snoozedUntil: '2026-09-16T08:00:00.000Z' }),
    );

    expect(await fixture().run()).toMatchObject({ kind: 'routed' });
  });

  it('refuses a second attempt with no newer human touch', async () => {
    const attempted = new Date('2026-09-17T09:00:00.000Z');
    const context = fixture({
      attempt: { last_attempt: attempted, last_touch: null },
    });

    expect(await context.run()).toEqual({
      kind: 'refused',
      reason: 'already_attempted',
    });
    expect(repository.insertExtraction).not.toHaveBeenCalled();
  });

  it('refuses when the human touch is older than the last attempt', async () => {
    const context = fixture({
      attempt: {
        last_attempt: new Date('2026-09-17T09:00:00.000Z'),
        last_touch: new Date('2026-09-17T08:30:00.000Z'),
      },
    });

    expect(await context.run()).toMatchObject({ reason: 'already_attempted' });
  });

  it('allows one more attempt after a newer human touch', async () => {
    const context = fixture({
      attempt: {
        last_attempt: new Date('2026-09-17T09:00:00.000Z'),
        last_touch: new Date('2026-09-17T09:30:00.000Z'),
      },
    });

    expect(await context.run()).toMatchObject({ kind: 'routed' });
    expect(
      context.queries.find((query) => query.text.includes('last_attempt'))
        ?.values,
    ).toEqual([
      ITEM_ID,
      AUTO_ROUTE_PROVIDER,
      ['hint_added', 'assigned', 'restored', 'reopened', 'unrouted'],
    ]);
  });
});

describe('routeInboxItem failure modes', () => {
  it('commits a missing_required_field row for a draft the composer left incomplete', async () => {
    repository.loadRouteSuggestion.mockResolvedValue(
      composed({ kind: null }, ['kind']),
    );
    const context = fixture();

    expect(await context.run()).toEqual({
      field: 'kind',
      issue: 'missing_required_field',
      kind: 'failed',
    });
    expect(repository.insertExtraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ITEM_ID,
      expect.objectContaining({
        output: expect.objectContaining({
          issues: [
            expect.objectContaining({
              code: 'missing_required_field',
              field: 'kind',
            }),
          ],
        }),
        provider: AUTO_ROUTE_PROVIDER,
      }),
    );
    expect(documents.createDocumentInTransaction).not.toHaveBeenCalled();
    expect(repository.finishRouteInTransaction).not.toHaveBeenCalled();
  });

  it('refuses an invoice kind defensively as a missing invoice block', async () => {
    repository.loadRouteSuggestion.mockResolvedValue(
      composed({ kind: 'received_invoice' }),
    );

    expect(await fixture().run()).toEqual({
      field: 'invoice',
      issue: 'missing_required_field',
      kind: 'failed',
    });
    expect(documents.createDocumentInTransaction).not.toHaveBeenCalled();
  });

  it('rolls back to the savepoint and commits a reference_conflict row', async () => {
    const violation = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'document_current_reference_key',
    });
    documents.createDocumentInTransaction.mockRejectedValueOnce(violation);
    const context = fixture();

    expect(await context.run()).toEqual({
      field: 'reference',
      issue: 'reference_conflict',
      kind: 'failed',
    });
    expect(
      context.queries
        .map((query) => query.text)
        .filter((text) => text.includes('savepoint')),
    ).toEqual([
      'savepoint auto_route_document',
      'rollback to savepoint auto_route_document',
    ]);
    expect(repository.insertExtraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ITEM_ID,
      expect.objectContaining({
        output: expect.objectContaining({
          issues: [expect.objectContaining({ code: 'reference_conflict' })],
        }),
      }),
    );
    expect(repository.finishRouteInTransaction).not.toHaveBeenCalled();
  });

  it('refuses without a row when the destination answers null', async () => {
    documents.createDocumentInTransaction.mockResolvedValueOnce(null);

    expect(await fixture().run()).toEqual({
      kind: 'refused',
      reason: 'destination_refused',
    });
    expect(repository.insertExtraction).not.toHaveBeenCalled();
  });

  it('rethrows an infrastructure error and counts the job as failed', async () => {
    documents.createDocumentInTransaction.mockRejectedValueOnce(
      new Error('connection reset'),
    );
    const context = fixture();

    await expect(context.run()).rejects.toThrow('connection reset');
    expect(await jobCount(context.metrics, 'failed')).toBe(1);
    expect(
      context.queries
        .map((query) => query.text)
        .filter((t) => t === 'rollback'),
    ).toHaveLength(1);
  });

  it('refuses a payload that names no item', async () => {
    await expect(
      routeInboxItem({
        data: { organizationId: ORGANIZATION, ruleId: RULE_ID },
        logger: { log: () => undefined },
        metrics: new WorkerMetrics(),
        pool: fixture().pool,
      }),
    ).rejects.toThrow();
  });
});
