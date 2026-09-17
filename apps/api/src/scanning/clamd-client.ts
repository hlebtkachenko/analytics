import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';

// Mirrors StreamMaxLength in infrastructure/clamav/clamd.conf: a larger stream is refused here instead of mid-upload.
export const DEFAULT_STREAM_MAX_BYTES = 30_000_000;
export const DEFAULT_SCAN_TIMEOUT_MS = 60_000;
// clamd reads INSTREAM in length-prefixed chunks; 64 KiB keeps the socket busy without a large resident buffer.
const CHUNK_BYTES = 65_536;
const MAX_REPLY_BYTES = 4_096;

export type ScanOutcome =
  | { outcome: 'clean' }
  | { outcome: 'infected'; signature: string }
  | { outcome: 'error'; reason: string };

export interface ClamdClientOptions {
  host: string;
  port: number;
  streamMaxBytes?: number;
  timeoutMs?: number;
}

export interface BlobScanner {
  scan(source: Readable, byteSize: number): Promise<ScanOutcome>;
}

function lengthPrefix(size: number): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(size, 0);
  return prefix;
}

function write(socket: Socket, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

// The zINSTREAM reply is one NUL-terminated line: "stream: OK", "stream: <name> FOUND" or "<message> ERROR".
function parseReply(reply: string): ScanOutcome {
  const line = reply.replace(/\0$/, '').trim();

  if (line === 'stream: OK') {
    return { outcome: 'clean' };
  }

  const found = /^stream: (.+) FOUND$/.exec(line);

  if (found?.[1] !== undefined) {
    return { outcome: 'infected', signature: found[1] };
  }

  return { outcome: 'error', reason: line.endsWith('ERROR') ? line : 'reply' };
}

// One TCP session per scan: connect, stream the bytes as INSTREAM chunks, read the verdict, close.
export async function scanWithClamd(
  options: ClamdClientOptions,
  source: Readable,
  byteSize: number,
): Promise<ScanOutcome> {
  const streamMaxBytes = options.streamMaxBytes ?? DEFAULT_STREAM_MAX_BYTES;

  if (byteSize > streamMaxBytes) {
    source.destroy();
    return { outcome: 'error', reason: 'size_limit' };
  }

  const socket = createConnection({ host: options.host, port: options.port });
  socket.setTimeout(options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS);
  socket.setNoDelay(true);

  let replied: string | undefined;
  const reply = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const settle = (): void => {
      replied = Buffer.concat(chunks).toString('utf8');
      resolve(replied);
    };

    socket.on('data', (data: Buffer) => {
      chunks.push(data);
      received += data.length;

      if (data.includes(0) || received >= MAX_REPLY_BYTES) {
        settle();
        socket.end();
      }
    });
    socket.on('end', settle);
    socket.on('timeout', () => {
      socket.destroy(new Error('clamd timed out'));
    });
    socket.on('error', reject);
  });
  // Nothing else may observe the socket error, so the rejection is consumed here and read through the reply below.
  reply.catch(() => undefined);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    await write(socket, Buffer.from('zINSTREAM\0', 'ascii'));

    for await (const piece of source) {
      const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);

      for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, offset + CHUNK_BYTES);
        await write(socket, Buffer.concat([lengthPrefix(chunk.length), chunk]));
      }
    }

    await write(socket, lengthPrefix(0));
    return parseReply(await reply);
  } catch (error) {
    // clamd refusing the stream (its own size limit) replies and closes while the client is still writing.
    if (replied !== undefined) {
      return parseReply(replied);
    }

    return {
      outcome: 'error',
      reason: error instanceof Error ? error.message : 'socket',
    };
  } finally {
    source.destroy();
    socket.destroy();
  }
}

export class ClamdClient implements BlobScanner {
  constructor(private readonly options: ClamdClientOptions) {}

  scan(source: Readable, byteSize: number): Promise<ScanOutcome> {
    return scanWithClamd(this.options, source, byteSize);
  }
}
