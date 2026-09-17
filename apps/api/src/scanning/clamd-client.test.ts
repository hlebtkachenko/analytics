import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClamdClient, scanWithClamd } from './clamd-client.js';

interface ReceivedStream {
  command: string;
  payload: Buffer;
}

// Speaks enough of the clamd INSTREAM protocol to record what was sent and answer as the test dictates.
function fakeClamd(
  answer: (received: ReceivedStream) => string | null,
  options: { closeAfterBytes?: number } = {},
): Server {
  return createServer((socket: Socket) => {
    let buffered = Buffer.alloc(0);
    let command = '';
    const payload: Buffer[] = [];
    let total = 0;
    let ended = false;

    socket.on('data', (data: Buffer) => {
      if (ended) {
        return;
      }

      buffered = Buffer.concat([buffered, data]);

      if (command === '') {
        const end = buffered.indexOf(0);
        if (end === -1) {
          return;
        }
        command = buffered.subarray(0, end).toString('ascii');
        buffered = buffered.subarray(end + 1);
      }

      for (;;) {
        if (buffered.length < 4) {
          return;
        }
        const length = buffered.readUInt32BE(0);
        if (buffered.length < 4 + length) {
          return;
        }
        const chunk = buffered.subarray(4, 4 + length);
        buffered = buffered.subarray(4 + length);
        total += chunk.length;

        if (
          options.closeAfterBytes !== undefined &&
          total > options.closeAfterBytes
        ) {
          ended = true;
          socket.end('INSTREAM size limit exceeded. ERROR\0');
          return;
        }

        if (length === 0) {
          const reply = answer({ command, payload: Buffer.concat(payload) });
          if (reply === null) {
            return;
          }
          ended = true;
          socket.end(`${reply}\0`);
          return;
        }

        payload.push(chunk);
      }
    });
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('scanWithClamd', () => {
  const servers: Server[] = [];
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bap-clamd-'));
  });

  afterAll(async () => {
    await Promise.all(servers.map(close));
    await rm(directory, { force: true, recursive: true });
  });

  async function start(
    answer: (received: ReceivedStream) => string | null,
    options?: { closeAfterBytes?: number },
  ): Promise<number> {
    const server = fakeClamd(answer, options);
    servers.push(server);
    return listen(server);
  }

  it('streams the bytes as zINSTREAM chunks and reads OK as clean', async () => {
    let received: ReceivedStream | undefined;
    const port = await start((stream) => {
      received = stream;
      return 'stream: OK';
    });
    const bytes = Buffer.alloc(200_000, 7);

    const outcome = await scanWithClamd(
      { host: '127.0.0.1', port },
      Readable.from([bytes]),
      bytes.length,
    );

    expect(outcome).toEqual({ outcome: 'clean' });
    expect(received?.command).toBe('zINSTREAM');
    expect(received?.payload.equals(bytes)).toBe(true);
  });

  it('reports the signature name for FOUND', async () => {
    const port = await start((stream) =>
      stream.payload.toString('latin1').includes('EICAR')
        ? 'stream: Win.Test.EICAR_HDB-1 FOUND'
        : 'stream: OK',
    );
    const path = join(directory, 'eicar.txt');
    await writeFile(path, EICAR);

    const client = new ClamdClient({ host: '127.0.0.1', port });
    expect(
      await client.scan(createReadStream(path), Buffer.byteLength(EICAR)),
    ).toEqual({
      outcome: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('reports an ERROR reply and an unparseable reply as errors', async () => {
    const errorPort = await start(() => 'stream: Scan failed. ERROR');
    expect(
      await scanWithClamd(
        { host: '127.0.0.1', port: errorPort },
        Readable.from([Buffer.from('x')]),
        1,
      ),
    ).toEqual({ outcome: 'error', reason: 'stream: Scan failed. ERROR' });

    const garblePort = await start(() => 'something else');
    expect(
      await scanWithClamd(
        { host: '127.0.0.1', port: garblePort },
        Readable.from([Buffer.from('x')]),
        1,
      ),
    ).toEqual({ outcome: 'error', reason: 'reply' });
  });

  it('times out a silent scanner and fails an unreachable one', async () => {
    const silentPort = await start(() => null);
    expect(
      await scanWithClamd(
        { host: '127.0.0.1', port: silentPort, timeoutMs: 100 },
        Readable.from([Buffer.from('x')]),
        1,
      ),
    ).toEqual({ outcome: 'error', reason: 'clamd timed out' });

    const closed = await start(() => 'stream: OK');
    await close(servers.pop() as Server);
    const outcome = await scanWithClamd(
      { host: '127.0.0.1', port: closed },
      Readable.from([Buffer.from('x')]),
      1,
    );
    expect(outcome.outcome).toBe('error');
  });

  it('refuses a stream above the configured limit before connecting and reads the daemon limit reply', async () => {
    const source = Readable.from([Buffer.alloc(10)]);
    expect(
      await scanWithClamd(
        { host: '127.0.0.1', port: 1, streamMaxBytes: 5 },
        source,
        10,
      ),
    ).toEqual({ outcome: 'error', reason: 'size_limit' });
    expect(source.destroyed).toBe(true);

    const port = await start(() => 'stream: OK', { closeAfterBytes: 70_000 });
    const bytes = Buffer.alloc(2_000_000, 1);
    expect(
      await scanWithClamd(
        { host: '127.0.0.1', port },
        Readable.from([bytes]),
        bytes.length,
      ),
    ).toEqual({
      outcome: 'error',
      reason: 'INSTREAM size limit exceeded. ERROR',
    });
  });
});
