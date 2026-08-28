import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ApplicationLogger } from './logger.js';

describe('ApplicationLogger', () => {
  it('redacts identity, credentials, and database configuration', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = new ApplicationLogger(destination);

    logger.log({
      authorization: 'Bearer private',
      database: 'postgresql://private',
      email: 'private@example.invalid',
      password: 'private',
    });

    expect(output).not.toContain('Bearer private');
    expect(output).not.toContain('private@example.invalid');
    expect(output).not.toContain('postgresql://private');
    expect(output.match(/\[Redacted\]/g)?.length).toBe(4);
  });

  it('does not serialize raw error messages or traces', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = new ApplicationLogger(destination);

    logger.error('private@example.invalid', 'Bearer private', 'Test');
    logger.fatal('postgresql://private', 'password=private', 'Test');

    expect(output).toContain('Application error');
    expect(output).not.toContain('private@example.invalid');
    expect(output).not.toContain('Bearer private');
    expect(output).not.toContain('postgresql://private');
    expect(output).not.toContain('password=private');
  });
});
