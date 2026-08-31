import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './pool.js';
import { runSignupCli } from './cli.js';

function createSignupHarness(
  initialValue: boolean,
  options: Readonly<{ failOnWrite?: Error }> = {},
) {
  let committedValue = initialValue;
  let transactionValue = initialValue;
  const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
    const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'begin') {
      transactionValue = committedValue;
      return { rows: [] };
    }
    if (normalized === 'set local role bap_owner') {
      return { rows: [] };
    }
    if (normalized.startsWith('insert into auth.platform_setting')) {
      if (options.failOnWrite) {
        throw options.failOnWrite;
      }
      transactionValue = parameters?.[0] === true;
      return { rows: [] };
    }
    if (normalized.startsWith('select enabled')) {
      return { rows: [{ enabled: transactionValue }] };
    }
    if (normalized === 'commit') {
      committedValue = transactionValue;
      return { rows: [] };
    }
    if (normalized === 'rollback') {
      transactionValue = committedValue;
      return { rows: [] };
    }
    throw new Error(`Unexpected statement: ${normalized}`);
  });
  const release = vi.fn();
  const end = vi.fn(async () => undefined);
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
    end,
  } as unknown as DatabasePool;

  return {
    end,
    get enabled() {
      return committedValue;
    },
    pool,
    query,
    release,
  };
}

function output() {
  return { write: vi.fn(() => true) };
}

describe('public sign-up database CLI', () => {
  it.each([
    { action: 'enable' as const, initial: false, expected: true },
    { action: 'disable' as const, initial: true, expected: false },
  ])(
    'commits signup $action and emits only JSON state',
    async ({ action, expected, initial }) => {
      const harness = createSignupHarness(initial);
      const stdout = output();
      const stderr = output();

      await expect(
        runSignupCli(action, {
          loadPool: async () => harness.pool,
          stderr,
          stdout,
        }),
      ).resolves.toBe(0);

      expect(harness.enabled).toBe(expected);
      expect(
        harness.query.mock.calls.map(([statement]) =>
          String(statement).replaceAll(/\s+/g, ' ').trim().toLowerCase(),
        ),
      ).toEqual([
        'begin',
        'set local role bap_owner',
        expect.stringMatching(/^insert into auth\.platform_setting/),
        expect.stringMatching(/^select enabled/),
        'commit',
      ]);
      expect(stdout.write).toHaveBeenCalledWith(
        `${JSON.stringify({ publicSignupEnabled: expected })}\n`,
      );
      expect(stderr.write).not.toHaveBeenCalled();
      expect(harness.release).toHaveBeenCalledOnce();
      expect(harness.end).toHaveBeenCalledOnce();
    },
  );

  it('reads signup status inside the owner transaction without writing', async () => {
    const harness = createSignupHarness(true);
    const stdout = output();
    const stderr = output();

    await expect(
      runSignupCli('status', {
        loadPool: async () => harness.pool,
        stderr,
        stdout,
      }),
    ).resolves.toBe(0);

    expect(harness.enabled).toBe(true);
    expect(
      harness.query.mock.calls.map(([statement]) => String(statement)),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining('insert')]));
    expect(harness.query).toHaveBeenLastCalledWith('commit');
    expect(stdout.write).toHaveBeenCalledWith('{"publicSignupEnabled":true}\n');
  });

  it('rolls back and emits a redacted JSON failure', async () => {
    const sensitiveDetail = 'private-database-detail';
    const harness = createSignupHarness(false, {
      failOnWrite: new Error(sensitiveDetail),
    });
    const stdout = output();
    const stderr = output();

    await expect(
      runSignupCli('enable', {
        loadPool: async () => harness.pool,
        stderr,
        stdout,
      }),
    ).resolves.toBe(1);

    expect(harness.enabled).toBe(false);
    expect(harness.query).toHaveBeenCalledWith('rollback');
    expect(stdout.write).not.toHaveBeenCalled();
    expect(stderr.write).toHaveBeenCalledWith(
      '{"code":"PUBLIC_SIGNUP_COMMAND_FAILED","status":"error"}\n',
    );
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(
      sensitiveDetail,
    );
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.end).toHaveBeenCalledOnce();
  });

  it('rejects an invalid action before opening a database pool', async () => {
    const loadPool = vi.fn<() => Promise<DatabasePool>>();
    const stderr = output();

    await expect(
      runSignupCli('unexpected', {
        loadPool,
        stderr,
        stdout: output(),
      }),
    ).resolves.toBe(1);

    expect(loadPool).not.toHaveBeenCalled();
    expect(stderr.write).toHaveBeenCalledWith(
      '{"code":"PUBLIC_SIGNUP_COMMAND_FAILED","status":"error"}\n',
    );
  });
});
