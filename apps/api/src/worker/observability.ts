import { createServer } from 'node:http';
import type { RequestListener, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { checkMigrationCompatibility } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';

import type { WorkerMetrics } from './worker-metrics.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3003;
const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
const SERVICE_NAME = 'worker';

type Environment = Record<string, string | undefined>;

export interface ObservabilityServerOptions {
  env: Environment;
  metrics: WorkerMetrics;
  pool: DatabasePool;
}

export interface ObservabilityServer {
  close: () => Promise<void>;
  port: number;
  server: Server;
}

function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Invalid worker observability port.');
  }

  return port;
}

function respondJson(
  response: ServerResponse,
  status: number,
  body: Record<string, string>,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function isMigrationCompatible(pool: DatabasePool): Promise<boolean> {
  try {
    const compatibility = await checkMigrationCompatibility(pool);
    return compatibility.compatible;
  } catch {
    return false;
  }
}

async function handleRequest(
  options: ObservabilityServerOptions,
  method: string,
  path: string,
  response: ServerResponse,
): Promise<void> {
  if (method === 'GET' && path === '/health') {
    respondJson(response, 200, { service: SERVICE_NAME, status: 'ok' });
    return;
  }

  if (method === 'GET' && path === '/ready') {
    const compatible = await isMigrationCompatible(options.pool);
    options.metrics.setMigrationCompatible(compatible);
    respondJson(response, compatible ? 200 : 503, {
      service: SERVICE_NAME,
      status: compatible ? 'ready' : 'unavailable',
    });
    return;
  }

  if (method === 'GET' && path === '/metrics') {
    options.metrics.updatePoolStatistics({
      idle: options.pool.idleCount,
      total: options.pool.totalCount,
      waiting: options.pool.waitingCount,
    });
    const body = await options.metrics.render();
    response.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
    response.end(body);
    return;
  }

  respondJson(response, 404, { service: SERVICE_NAME, status: 'not_found' });
}

function createRequestListener(
  options: ObservabilityServerOptions,
): RequestListener {
  return (request, response) => {
    const path = new URL(request.url ?? '/', 'http://worker.invalid').pathname;

    handleRequest(options, request.method ?? 'GET', path, response).catch(
      () => {
        respondJson(response, 503, {
          service: SERVICE_NAME,
          status: 'unavailable',
        });
      },
    );
  };
}

export function startObservabilityServer(
  options: ObservabilityServerOptions,
): Promise<ObservabilityServer> {
  const host = options.env.HOST ?? DEFAULT_HOST;
  const port = resolvePort(options.env.PORT);
  const server = createServer(createRequestListener(options));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      // Startup rejection is done; later errors need a live listener or Node would throw.
      server.removeListener('error', reject);
      server.on('error', () => undefined);
      const address = server.address() as AddressInfo | null;

      resolve({
        close: () =>
          new Promise<void>((closed, failed) => {
            server.closeAllConnections();
            server.close((error) => {
              if (error === undefined) {
                closed();
                return;
              }

              failed(error);
            });
          }),
        port: address?.port ?? port,
        server,
      });
    });
  });
}
