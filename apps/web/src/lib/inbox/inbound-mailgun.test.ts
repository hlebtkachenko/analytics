// @vitest-environment node

import type { DatabasePool } from '@bap/db/pool';
import { createHash, createHmac } from 'node:crypto';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { webLogger } from '../logger.ts';
import { INTAKE_EDGE_RATE_LIMIT } from './intake.ts';
import {
  INBOUND_MAX_BYTES,
  createInFlightGate,
  loadInboundConfiguration,
  postInboundMailgunMime,
} from './inbound-mailgun.ts';

const CHANNEL_ID = '00000000-0000-4000-8000-000000000060';
const ITEM_ID = '00000000-0000-4000-8000-000000000061';
// Built at runtime so no literal high-entropy string lands in the repository.
const SIGNING_KEY = Buffer.alloc(32, 7).toString('hex');
const RECIPIENT_TOKEN = 'a'.repeat(32);
const RECIPIENT = `in-${RECIPIENT_TOKEN}@in.bap.localhost`;
const LOCAL_PART_SHA256 = createHash('sha256')
  .update(`in-${RECIPIENT_TOKEN}`)
  .digest('hex');
const MAILGUN_TOKEN = 'T'.repeat(50);
const SENDER = 'sender@example.org';
const NOW = 1_700_000_000_000;
const TIMESTAMP = String(Math.floor(NOW / 1000));
const MIME = 'From: a@b.invalid\r\nSubject: x\r\n\r\nbody\r\n';

function sign(timestamp: string, token: string, key = SIGNING_KEY): string {
  return createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
}

type PoolState = Readonly<{
  bucketCount?: number;
  bucketLastRequest?: number;
  credential?: Readonly<{ kind: string }> | null;
}>;

// A pool answering the three statements the route may issue, recording which ones it saw.
function fakePool(state: PoolState = {}, expectedHash = LOCAL_PART_SHA256) {
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
      expect(parameters).toEqual([expectedHash]);
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

type Fields = Readonly<Record<string, string | Blob | undefined>>;

function mailgunFields(overrides: Fields = {}): Fields {
  return {
    'body-mime': MIME,
    recipient: RECIPIENT,
    sender: SENDER,
    signature: sign(TIMESTAMP, MAILGUN_TOKEN),
    timestamp: TIMESTAMP,
    token: MAILGUN_TOKEN,
    ...overrides,
  };
}

function inboundRequest(
  fields: Fields = mailgunFields(),
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      form.append(name, value);
    }
  }
  const request = new Request('https://bap.invalid/api/inbound/mailgun/mime', {
    body: form,
    headers: { 'x-bap-client-ip': '203.0.113.7', ...headers },
    method: 'POST',
  });
  return request;
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
  gate = createInFlightGate(4),
) {
  return {
    fetchImplementation,
    gate,
    loadPool: async () => pool,
    now: () => NOW,
    signingKey: SIGNING_KEY,
    signJWT,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  signJWT.mockClear();
});

describe('postInboundMailgunMime', () => {
  it('forwards a signed post as message/rfc822 under a channel token and answers 200', async () => {
    const { pool, query } = fakePool({ credential: { kind: 'email_address' } });
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/inbox/channels/${CHANNEL_ID}/email`,
      );
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(Blob);
      expect(await (init?.body as Blob).text()).toBe(MIME);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer channel-token');
      expect(headers.get('content-type')).toBe('message/rfc822');
      expect(headers.get('x-bap-intake-external-id')).toBe(MAILGUN_TOKEN);
      expect(headers.get('x-bap-intake-origin')).toBe('aaaaaaaa');
      expect(headers.get('x-bap-intake-sender')).toBe(SENDER);
      expect(headers.get('x-bap-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      return Response.json(accepted, { status: 202 });
    });

    const response = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ itemId: ITEM_ID });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(signJWT).toHaveBeenCalledWith({
      body: {
        payload: { iat: Math.floor(NOW / 1000), sub: `channel_${CHANNEL_ID}` },
      },
    });
    expect(statements(query)).toEqual(['bucket_check', 'resolve']);
  });

  it('omits the sender header when the sender is not printable ASCII and forwards a File as is', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const file = new File([MIME], 'message.eml', { type: 'message/rfc822' });
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body).toBeInstanceOf(File);
      expect(await (init?.body as File).text()).toBe(MIME);
      expect(new Headers(init?.headers).has('x-bap-intake-sender')).toBe(false);
      return Response.json(accepted, { status: 202 });
    });

    const response = await postInboundMailgunMime(
      inboundRequest(mailgunFields({ 'body-mime': file, sender: 'Ž@x.cz' })),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['63 characters', sign(TIMESTAMP, MAILGUN_TOKEN).slice(1)],
    ['65 characters', `${sign(TIMESTAMP, MAILGUN_TOKEN)}0`],
    ['non-hex', 'g'.repeat(64)],
    ['the wrong key', sign(TIMESTAMP, MAILGUN_TOKEN, 'other-key')],
    ['no signature', undefined],
  ])(
    'consumes the bucket and answers 401 for a signature of %s',
    async (_name, signature) => {
      const { pool, query } = fakePool({
        credential: { kind: 'email_address' },
      });
      const fetchImplementation = vi.fn<typeof fetch>();

      const response = await postInboundMailgunMime(
        inboundRequest(mailgunFields({ signature })),
        dependencies(pool, fetchImplementation),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      expect(statements(query)).toEqual(['bucket_check', 'bucket_consume']);
      expect(query.mock.calls[1]?.[1]?.[0]).toMatch(
        /^bap-edge:inbound:[0-9a-f]{64}$/,
      );
      expect(fetchImplementation).not.toHaveBeenCalled();
      expect(signJWT).not.toHaveBeenCalled();
    },
  );

  it('consumes the bucket and answers 401 for a timestamp outside 300 seconds', async () => {
    const { pool, query } = fakePool({ credential: { kind: 'email_address' } });
    const stale = String(Math.floor(NOW / 1000) - 301);

    const response = await postInboundMailgunMime(
      inboundRequest(
        mailgunFields({
          signature: sign(stale, MAILGUN_TOKEN),
          timestamp: stale,
        }),
      ),
      dependencies(pool),
    );
    const fresh = await postInboundMailgunMime(
      inboundRequest(
        mailgunFields({
          signature: sign(String(Math.floor(NOW / 1000) - 300), MAILGUN_TOKEN),
          timestamp: String(Math.floor(NOW / 1000) - 300),
        }),
      ),
      dependencies(fakePool({ credential: { kind: 'email_address' } }).pool),
    );

    expect(response.status).toBe(401);
    expect(statements(query)).toEqual(['bucket_check', 'bucket_consume']);
    expect(fresh.status).toBe(200);
  });

  it('consumes the bucket and answers 401 for a body that is not a form', async () => {
    const { pool, query } = fakePool();

    const response = await postInboundMailgunMime(
      new Request('https://bap.invalid/api/inbound/mailgun/mime', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      dependencies(pool),
    );

    expect(response.status).toBe(401);
    expect(statements(query)).toEqual(['bucket_check', 'bucket_consume']);
  });

  it('answers 429 from a full bucket before parsing the form', async () => {
    const { pool, query } = fakePool({
      bucketCount: INTAKE_EDGE_RATE_LIMIT.max,
      bucketLastRequest: NOW - 10_000,
    });
    const request = inboundRequest();
    const formData = vi.spyOn(request, 'formData');

    const response = await postInboundMailgunMime(request, dependencies(pool));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('50');
    expect(await response.json()).toEqual({
      error: 'rate_limited',
      retryAfterSeconds: 50,
    });
    expect(statements(query)).toEqual(['bucket_check']);
    expect(formData).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown recipient', null, `in-${'b'.repeat(32)}`],
    ['an api_token credential', { kind: 'api_token' }, `in-${RECIPIENT_TOKEN}`],
  ])(
    'answers 406 without consuming the bucket for %s',
    async (_name, credential, localPart) => {
      const { pool, query } = fakePool(
        { credential },
        createHash('sha256').update(localPart).digest('hex'),
      );
      const fetchImplementation = vi.fn<typeof fetch>();

      const response = await postInboundMailgunMime(
        inboundRequest(mailgunFields({ recipient: `${localPart}@x.invalid` })),
        dependencies(pool, fetchImplementation),
      );

      expect(response.status).toBe(406);
      expect(await response.json()).toEqual({ error: 'recipient_unknown' });
      expect(statements(query)).toEqual(['bucket_check', 'resolve']);
      expect(fetchImplementation).not.toHaveBeenCalled();
      expect(signJWT).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no in- prefix', `${'c'.repeat(32)}@x.invalid`],
    ['a short token', 'in-abc@x.invalid'],
    ['no recipient', undefined],
  ])(
    'answers 406 for a recipient with %s without a lookup',
    async (_name, recipient) => {
      const { pool, query } = fakePool();

      const response = await postInboundMailgunMime(
        inboundRequest(mailgunFields({ recipient })),
        dependencies(pool),
      );

      expect(response.status).toBe(406);
      expect(statements(query)).toEqual(['bucket_check']);
    },
  );

  it('resolves the recipient local part case-insensitively', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });

    const response = await postInboundMailgunMime(
      inboundRequest(
        mailgunFields({ recipient: `IN-${'A'.repeat(32)}@In.Bap.Localhost` }),
      ),
      dependencies(pool),
    );

    expect(response.status).toBe(200);
  });

  it('answers 406 for a missing or empty body-mime', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const fetchImplementation = vi.fn<typeof fetch>();

    const missing = await postInboundMailgunMime(
      inboundRequest(mailgunFields({ 'body-mime': undefined })),
      dependencies(pool, fetchImplementation),
    );
    const empty = await postInboundMailgunMime(
      inboundRequest(mailgunFields({ 'body-mime': '' })),
      dependencies(pool, fetchImplementation),
    );

    expect(missing.status).toBe(406);
    expect(await missing.json()).toEqual({ error: 'invalid_body' });
    expect(empty.status).toBe(406);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('answers 406 for a declared content-length above 30 MB before any database call', async () => {
    const { pool, query } = fakePool();
    const loadPool = vi.fn(async () => pool);

    const response = await postInboundMailgunMime(
      inboundRequest(mailgunFields(), {
        'content-length': String(INBOUND_MAX_BYTES + 1),
      }),
      { ...dependencies(pool), loadPool },
    );

    expect(response.status).toBe(406);
    expect(await response.json()).toEqual({ error: 'too_large' });
    expect(loadPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('answers 503 with retry-after past the in-flight limit and frees the slot afterwards', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const gate = createInFlightGate(1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      await blocked;
      return Response.json(accepted, { status: 202 });
    });

    const first = postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, fetchImplementation, gate),
    );
    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    });
    const second = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, fetchImplementation, gate),
    );
    release();
    expect((await first).status).toBe(200);
    const third = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, fetchImplementation, gate),
    );

    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('30');
    expect(await second.json()).toEqual({ error: 'busy' });
    expect(third.status).toBe(200);
  });

  it.each([
    [400, 406],
    [404, 406],
    [413, 406],
    [415, 406],
    [401, 502],
    [403, 502],
    [500, 502],
    [409, 502],
  ])('maps an upstream %i to %i', async (upstream, expected) => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });

    const response = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(
        pool,
        vi.fn<typeof fetch>(
          async () =>
            new Response(null, {
              headers: { 'x-upstream': 'leak' },
              status: upstream,
            }),
        ),
      ),
    );

    expect(response.status).toBe(expected);
    expect(response.headers.get('x-upstream')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('maps an upstream 429 to 503 with its retry-after, or 30 without one', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const upstream = (headers: Record<string, string>) =>
      vi.fn<typeof fetch>(
        async () => new Response(null, { headers, status: 429 }),
      );

    const withWait = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, upstream({ 'retry-after': '7' })),
    );
    const withoutWait = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(pool, upstream({})),
    );

    expect(withWait.status).toBe(503);
    expect(withWait.headers.get('retry-after')).toBe('7');
    expect(withoutWait.status).toBe(503);
    expect(withoutWait.headers.get('retry-after')).toBe('30');
  });

  it('answers 502 when the upstream is unreachable and 503 when the lookup fails', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const unreachable = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(
        pool,
        vi.fn<typeof fetch>(async () => {
          throw new Error('down');
        }),
      ),
    );
    const brokenPool = {
      query: vi.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as DatabasePool;
    const unavailable = await postInboundMailgunMime(
      inboundRequest(),
      dependencies(brokenPool),
    );

    expect(unreachable.status).toBe(502);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'inbound_unavailable' });
  });

  it('never logs the recipient, sender, token, signature, key or body', async () => {
    const info = vi.spyOn(webLogger, 'info');
    const warn = vi.spyOn(webLogger, 'warn');
    const error = vi.spyOn(webLogger, 'error');
    const { pool } = fakePool({ credential: { kind: 'email_address' } });

    await postInboundMailgunMime(inboundRequest(), dependencies(pool));
    await postInboundMailgunMime(
      inboundRequest(mailgunFields({ signature: '0'.repeat(64) })),
      dependencies(pool),
    );
    await postInboundMailgunMime(
      inboundRequest(mailgunFields({ recipient: `in-${'b'.repeat(32)}` })),
      dependencies(
        fakePool(
          { credential: null },
          createHash('sha256')
            .update(`in-${'b'.repeat(32)}`)
            .digest('hex'),
        ).pool,
      ),
    );
    await postInboundMailgunMime(
      inboundRequest(),
      dependencies(
        pool,
        vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })),
      ),
    );

    const logged = JSON.stringify([
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(info).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    for (const secret of [
      RECIPIENT_TOKEN,
      LOCAL_PART_SHA256,
      MAILGUN_TOKEN,
      SENDER,
      SIGNING_KEY,
      sign(TIMESTAMP, MAILGUN_TOKEN),
      'body',
      'aaaaaaaa',
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain(CHANNEL_ID);
    expect(logged).toContain(ITEM_ID);
  });

  it('keeps a 25 MB body-mime field intact through the form parser', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const large = `${MIME}${'x'.repeat(25_000_000 - MIME.length)}`;
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body as Blob;
      expect(body.size).toBe(25_000_000);
      const text = await body.text();
      expect(text.startsWith(MIME)).toBe(true);
      expect(text.endsWith('xxxx')).toBe(true);
      return Response.json(accepted, { status: 202 });
    });

    const response = await postInboundMailgunMime(
      inboundRequest(mailgunFields({ 'body-mime': large })),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('answers 406 for a body-mime above 30 MB', async () => {
    const { pool } = fakePool({ credential: { kind: 'email_address' } });
    const fetchImplementation = vi.fn<typeof fetch>();
    const oversized = new File(
      [new Uint8Array(INBOUND_MAX_BYTES + 1)],
      'big.eml',
    );

    const response = await postInboundMailgunMime(
      inboundRequest(mailgunFields({ 'body-mime': oversized })),
      dependencies(pool, fetchImplementation),
    );

    expect(response.status).toBe(406);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('loadInboundConfiguration', () => {
  it('reads the trimmed key from a protected file and the in-flight default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-inbound-'));
    const path = join(directory, 'mailgun-webhook-signing-key');
    await writeFile(path, `${SIGNING_KEY}\n`, { mode: 0o600 });
    await chmod(path, 0o600);

    const configuration = await loadInboundConfiguration({
      BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE: path,
      NODE_ENV: 'test',
    });
    const tuned = await loadInboundConfiguration({
      BAP_INBOUND_MAX_IN_FLIGHT: '2',
      BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE: path,
      NODE_ENV: 'test',
    });

    expect(configuration).toEqual({ maxInFlight: 4, signingKey: SIGNING_KEY });
    expect(tuned.maxInFlight).toBe(2);
  });

  it('refuses an empty or world-writable key file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bap-inbound-'));
    const empty = join(directory, 'empty');
    await writeFile(empty, '\n', { mode: 0o600 });
    await chmod(empty, 0o600);
    const open = join(directory, 'open');
    await writeFile(open, SIGNING_KEY, { mode: 0o666 });
    await chmod(open, 0o666);

    await expect(
      loadInboundConfiguration({
        BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE: empty,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('empty');
    await expect(
      loadInboundConfiguration({
        BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE: open,
        NODE_ENV: 'test',
      }),
    ).rejects.toThrow('protected regular file');
  });
});
