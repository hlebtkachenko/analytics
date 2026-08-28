import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ReportingLogger } from './logger.js';

describe('ReportingLogger', () => {
  it('redacts authorization values while retaining correlation identifiers', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const logger = new ReportingLogger(destination);

    logger.log(
      { authorization: 'test-only-token', requestId: 'request-identifier' },
      'HTTP request',
    );

    expect(output).toContain('request-identifier');
    expect(output).not.toContain('test-only-token');
  });

  it('does not serialize raw error messages or traces', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const logger = new ReportingLogger(destination);

    logger.error('private@example.invalid', 'Bearer private', 'Test');
    logger.fatal('postgresql://private', 'password=private', 'Test');

    expect(output).toContain('Reporting service error');
    expect(output).not.toContain('private@example.invalid');
    expect(output).not.toContain('Bearer private');
    expect(output).not.toContain('postgresql://private');
    expect(output).not.toContain('password=private');
  });
});
