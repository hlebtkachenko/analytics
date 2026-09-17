import type { DatabasePool } from '@bap/db/pool';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { webLogger } from '../logger.ts';
import { INTAKE_EDGE_RATE_LIMIT, postIntakeItem } from './intake.ts';

const CHANNEL_ID = '00000000-0000-4000-8000-000000000060';
const ITEM_ID = '00000000-0000-4000-8000-000000000061';
const SECRET = `bap_intake_${'A'.repeat(43)}`;
const SECRET_SHA256 = createHash('sha256').update(SECRET).digest('hex');
const NOW = 1_700_000_000_000;

type PoolState = Readonly<{
  bucketCount?: number;
  bucketLastRequest?: number;
  credential?: Readonly<{ kind: string }> | null;
}>;

// A pool answering the three statements the route may issue, recording which ones it saw.
function fakePool(state: PoolState = {}) {
  const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
    if (statement.startsWith('select count, last_request')) {
      return state.bucketCount === undefined
        ? { rows: [] }
        : {
            rows: [
              {
                count: state.bucketCount,
                last_request: state.bucketLastRequest ?? NOW - 1000,
              },
            ],
          };
    }
    if (statement.includes('auth.resolve_channel_credential')) {
      expect(parameters).toEqual([SECRET_SHA256]);
      return state.credential === null || state.credential === undefined
        ? { rows: [] }
        : {
            rows: [
              {
                channel_id: CHANNEL_ID,
                kind: state.credential.kind,
                organization_id: 'org_1',
              },
            ],
          };
    }
    if (statement.includes('insert into auth.rate_limit')) {
      return { rows: [{ count: 1, last_request: NOW }] };
    }
    throw new Error(`Unexpected statement: ${statement}`);
  });
  return { pool: { query } as unknown as DatabasePool, query };
}

function statements(query: ReturnType<typeof fakePool>['query']): string[] {
  return query.mock.calls.map(([statement]) =>
    statement.startsWith('select count')
      ? 'bucket_check'
      : statement.includes('resolve_channel_credential')
        ? 'resolve'
        : 'bucket_consume',
  );
}

function intakeRequest(init: RequestInit & { bearer?: string | null }) {
  const { bearer = SECRET, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (bearer !== null) {
    headers.set('authorization', `Bearer ${bearer}`);
  }
  headers.set('x-bap-client-ip', '203.0.113.7');
  return new Request('https://bap.invalid/api/intake/v1/items', {
    ...rest,
    headers,
    method: 'POST',
  });
}

function multipartRequest(bearer: string | null = SECRET) {
  return intakeRequest({
    bearer,
    body: 'part',
    headers: { 'content-type': 'multipart/form-data; boundary=b' },
  });
}

const signJWT = vi.fn(async () => ({ token: 'channel-token' }));
const accepted = {
  duplicateOfItemId: null,
  itemId: ITEM_ID,
  status: 'received',
};

function dependencies(
  pool: DatabasePool,
  fetchImplementation: typeof fetch = vi.fn<typeof fetch>(async () =>
    Response.json(accepted, { status: 202 }),
  ),
) {
  return {
    fetchImplementation,
    loadPool: async () => pool,
    now: () => NOW,
    signJWT,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  signJWT.mockClear();
});

describe('postIntakeItem', () => {
  it('refuses a malformed bearer with 401 before touching the database', async () => {
    const { pool, query } = fakePool();
    const loadPool = vi.fn(async () => pool);
    const fetchImplementation = vi.fn<typeof fetch>();

    const missing = await postIntakeItem(multipartRequest(null), {
      ...dependencies(pool, fetchImplementation),
      loadPool,
    });
    const wrongShape = await postIntakeItem(multipartRequest('bap_intake_x'), {
      ...dependencies(pool, fetchImplementation),
      loadPool,
    });

    expect(missing.status).toBe(401);
    expect(wrongShape.status).toBe(401);
    expect(await wrongShape.json()).toEqual({ error: 'unauthorized' });
    expect(loadPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(missing.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 429 from a full bucket before the credential lookup', async () => {
    const { pool, query } = fakePool({
      bucketCount: INTAKE_EDGE_RATE_LIMIT.max,
      bucketLastRequest: NOW - 10_000,
    });
    const fetchImplementation = vi.fn<typeof fetch>();

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('50');
    expect(await response.json()).toEqual({
      error: 'rate_limited',
      retryAfterSeconds: 50,
    });
    expect(statements(query)).toEqual(['bucket_check']);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('lets an expired bucket through', async () => {
    const { pool, query } = fakePool({
      bucketCount: INTAKE_EDGE_RATE_LIMIT.max,
      bucketLastRequest: NOW - INTAKE_EDGE_RATE_LIMIT.windowSeconds * 1000,
      credential: { kind: 'api_token' },
    });

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool),
    );

    expect(response.status).toBe(202);
    expect(statements(query)).toEqual(['bucket_check', 'resolve']);
  });

  it('consumes the bucket and answers 401 on an unknown credential', async () => {
    const { pool, query } = fakePool({ credential: null });
    const fetchImplementation = vi.fn<typeof fetch>();

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(statements(query)).toEqual([
      'bucket_check',
      'resolve',
      'bucket_consume',
    ]);
    expect(query.mock.calls[2]?.[1]?.[0]).toMatch(
      /^bap-edge:intake:[0-9a-f]{64}$/,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(signJWT).not.toHaveBeenCalled();
  });

  it('treats an email address credential as a miss on the API route', async () => {
    const { pool, query } = fakePool({ credential: { kind: 'email_address' } });

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool),
    );

    expect(response.status).toBe(401);
    expect(statements(query)).toEqual([
      'bucket_check',
      'resolve',
      'bucket_consume',
    ]);
  });

  it('mints a channel token and streams multipart to the channel items route', async () => {
    const { pool, query } = fakePool({ credential: { kind: 'api_token' } });
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/inbox/channels/${CHANNEL_ID}/items`,
      );
      expect(init?.method).toBe('POST');
      expect((init as { duplex?: string }).duplex).toBe('half');
      expect(init?.body).toBeInstanceOf(ReadableStream);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer channel-token');
      expect(headers.get('content-type')).toBe(
        'multipart/form-data; boundary=b',
      );
      expect(headers.get('x-bap-intake-origin')).toBe('AAAAAAAA');
      expect(headers.get('x-bap-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      return Response.json(accepted, { status: 202 });
    });

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(accepted);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(signJWT).toHaveBeenCalledWith({
      body: {
        payload: { iat: Math.floor(NOW / 1000), sub: `channel_${CHANNEL_ID}` },
      },
    });
    expect(statements(query)).toEqual(['bucket_check', 'resolve']);
  });

  it('passes a bounded JSON body through and refuses one above 1 MiB', async () => {
    const { pool } = fakePool({ credential: { kind: 'api_token' } });
    const structured = { externalId: 'ext-1', payload: { total: '1.00' } };
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('content-type')).toBe('application/json');
      expect(init?.body).toBeInstanceOf(Blob);
      expect(JSON.parse(await (init?.body as Blob).text())).toEqual(structured);
      return Response.json(accepted, { status: 202 });
    });

    const response = await postIntakeItem(
      intakeRequest({
        body: JSON.stringify(structured),
        headers: { 'content-type': 'application/json' },
      }),
      dependencies(pool, fetchImplementation),
    );
    const oversized = await postIntakeItem(
      intakeRequest({
        body: 'x'.repeat(1_048_577),
        headers: { 'content-type': 'application/json' },
      }),
      dependencies(pool, fetchImplementation),
    );
    const unsupported = await postIntakeItem(
      intakeRequest({
        body: 'plain',
        headers: { 'content-type': 'text/plain' },
      }),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(202);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'too_large' });
    expect(unsupported.status).toBe(415);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('passes an upstream 413 through as a problem body without upstream headers', async () => {
    const { pool } = fakePool({ credential: { kind: 'api_token' } });
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response('{"statusCode":413}', {
          headers: { 'x-upstream': 'leak' },
          status: 413,
        }),
    );

    const response = await postIntakeItem(
      multipartRequest(),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_large' });
    expect(response.headers.get('x-upstream')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 502 for an upstream fault and 503 when the lookup fails', async () => {
    const { pool } = fakePool({ credential: { kind: 'api_token' } });
    const faulted = await postIntakeItem(
      multipartRequest(),
      dependencies(
        pool,
        vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })),
      ),
    );
    const brokenPool = {
      query: vi.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as DatabasePool;
    const unavailable = await postIntakeItem(
      multipartRequest(),
      dependencies(brokenPool),
    );

    expect(faulted.status).toBe(502);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'intake_unavailable' });
  });

  it('never logs the bearer, its hash or the origin', async () => {
    const info = vi.spyOn(webLogger, 'info');
    const warn = vi.spyOn(webLogger, 'warn');
    const error = vi.spyOn(webLogger, 'error');
    const { pool } = fakePool({ credential: { kind: 'api_token' } });

    await postIntakeItem(multipartRequest(), dependencies(pool));
    await postIntakeItem(
      multipartRequest(),
      dependencies(fakePool({ credential: null }).pool),
    );
    await postIntakeItem(multipartRequest('bad'), dependencies(pool));

    const logged = JSON.stringify([
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(info).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SECRET_SHA256);
    expect(logged).not.toContain('AAAAAAAA');
    expect(logged).toContain(CHANNEL_ID);
  });
});
