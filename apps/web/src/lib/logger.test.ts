// @vitest-environment node

import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { WebLogger, webLogger } from './logger.ts';

function collectingLogger(): {
  logger: WebLogger;
  output: () => string;
} {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return { logger: new WebLogger(destination), output: () => output };
}

describe('WebLogger', () => {
  it('redacts identity and database configuration like the application API logger', () => {
    const { logger, output } = collectingLogger();

    logger.info('boundary event', {
      authorization: 'Bearer private',
      database: 'postgresql://private',
      email: 'private@example.invalid',
      password: 'private',
    });

    expect(output()).toContain('boundary event');
    expect(output()).not.toContain('Bearer private');
    expect(output()).not.toContain('postgresql://private');
    expect(output()).not.toContain('private@example.invalid');
    expect(output().match(/\[Redacted\]/g)?.length).toBe(4);
  });

  it('redacts resource tokens, provider credentials, and model text', () => {
    const { logger, output } = collectingLogger();

    logger.error('assistant unavailable', {
      apiKey: 'sk-private',
      completion: 'private completion',
      credential: 'private credential',
      messages: 'private conversation',
      prompt: 'private prompt',
      secret: 'private secret',
      sessionToken: 'private session',
      token: 'private.resource.jwt',
    });

    expect(output()).toContain('assistant unavailable');
    expect(output()).not.toContain('sk-private');
    expect(output()).not.toContain('private completion');
    expect(output()).not.toContain('private credential');
    expect(output()).not.toContain('private conversation');
    expect(output()).not.toContain('private prompt');
    expect(output()).not.toContain('private secret');
    expect(output()).not.toContain('private session');
    expect(output()).not.toContain('private.resource.jwt');
    expect(output().match(/\[Redacted\]/g)?.length).toBe(8);
  });

  it('records the service, the level, and the fields a caller may keep', () => {
    const { logger, output } = collectingLogger();

    logger.warn('bff upstream call failed', {
      operation: 'getDatasets',
      reason: 'unreachable',
    });

    const entry: unknown = JSON.parse(output());

    expect(entry).toMatchObject({
      data: { operation: 'getDatasets', reason: 'unreachable' },
      msg: 'bff upstream call failed',
      service: 'web',
    });
  });

  it('exposes a shared instance that stays silent under the test runner', () => {
    expect(webLogger).toBeInstanceOf(WebLogger);
    expect(() => {
      webLogger.info('shared instance event');
    }).not.toThrow();
  });
});
