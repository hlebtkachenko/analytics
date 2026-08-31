import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './pool.js';
import {
  isDirectInvocation,
  parseEraseUserId,
  parseOrganizationQuotaArguments,
  runEraseUserCli,
  runOrganizationQuotaCli,
  runSignupCli,
} from './cli.js';

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

function createEraseUserHarness(
  options: Readonly<{
    appHasSubject?: boolean;
    failOnConsume?: Error;
    failOnErasure?: Error;
    live?: boolean;
    pending?: boolean;
  }> = {},
) {
  const userId = 'user-to-erase';
  const opaqueTombstone = 'erased_00000000-0000-4000-8000-000000000111';
  let committedAppValue =
    options.appHasSubject === false ? 'other-user' : userId;
  let committedPending = options.pending ?? true;
  let transactionAppValue = committedAppValue;
  let transactionPending = committedPending;
  const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
    const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'begin') {
      transactionAppValue = committedAppValue;
      transactionPending = committedPending;
      return { rows: [] };
    }
    if (
      normalized === 'set local role bap_owner' ||
      normalized === 'set local role bap_eraser'
    ) {
      return { rows: [] };
    }
    if (normalized.startsWith('select user_id')) {
      return {
        rows:
          transactionPending && parameters?.[0] === userId
            ? [{ user_id: userId }]
            : [],
      };
    }
    if (normalized.startsWith('select exists')) {
      return { rows: [{ live: options.live ?? false }] };
    }
    if (normalized.startsWith('select app.erase_user')) {
      if (options.failOnErasure) {
        throw options.failOnErasure;
      }
      if (transactionAppValue === parameters?.[0]) {
        transactionAppValue = opaqueTombstone;
        return { rows: [{ tombstone: opaqueTombstone }] };
      }
      return { rows: [{ tombstone: null }] };
    }
    if (normalized.startsWith('delete from auth.user_erasure_request')) {
      if (options.failOnConsume) {
        throw options.failOnConsume;
      }
      if (!transactionPending || parameters?.[0] !== userId) {
        return { rows: [] };
      }
      transactionPending = false;
      return { rows: [{ user_id: userId }] };
    }
    if (normalized === 'commit') {
      committedAppValue = transactionAppValue;
      committedPending = transactionPending;
      return { rows: [] };
    }
    if (normalized === 'rollback') {
      transactionAppValue = committedAppValue;
      transactionPending = committedPending;
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
    get appValue() {
      return committedAppValue;
    },
    end,
    get pending() {
      return committedPending;
    },
    opaqueTombstone,
    pool,
    query,
    release,
    userId,
  };
}

function createOrganizationQuotaHarness(
  options: Readonly<{ failOnWrite?: Error; userExists?: boolean }> = {},
) {
  const grantedAt = new Date('2026-08-31T15:00:00.000Z');
  let committedTotal: number | null = null;
  let transactionTotal: number | null = committedTotal;
  const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
    const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'begin') {
      transactionTotal = committedTotal;
      return { rows: [] };
    }
    if (normalized === 'set local role bap_owner') {
      return { rows: [] };
    }
    if (normalized.startsWith('select id')) {
      return options.userExists === false
        ? { rows: [] }
        : { rows: [{ id: 'quota-user' }] };
    }
    if (normalized.startsWith('insert into auth.organization_quota')) {
      if (options.failOnWrite) {
        throw options.failOnWrite;
      }
      transactionTotal = Number(parameters?.[1]);
      return {
        rows: [
          {
            granted_at: grantedAt,
            granted_by: null,
            granted_total: transactionTotal,
            note: parameters?.[2],
            user_id: 'quota-user',
          },
        ],
      };
    }
    if (normalized === 'commit') {
      committedTotal = transactionTotal;
      return { rows: [] };
    }
    if (normalized === 'rollback') {
      transactionTotal = committedTotal;
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
    get committedTotal() {
      return committedTotal;
    },
    end,
    grantedAt,
    pool,
    query,
    release,
  };
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

describe('user erasure database CLI', () => {
  it('requires exactly one explicit user id', () => {
    expect(parseEraseUserId(['user-1'])).toBe('user-1');
    for (const arguments_ of [
      [],
      ['', ''],
      [' user-1'],
      ['user-1', 'user-2'],
    ]) {
      expect(() => parseEraseUserId(arguments_)).toThrow('explicit user id');
    }
  });

  it('changes roles, erases the explicit subject, and consumes its request in one transaction', async () => {
    const harness = createEraseUserHarness();
    const stdout = output();
    const stderr = output();

    await expect(
      runEraseUserCli([harness.userId], {
        loadPool: async () => harness.pool,
        stderr,
        stdout,
      }),
    ).resolves.toBe(0);

    expect(harness.appValue).toBe(harness.opaqueTombstone);
    expect(harness.pending).toBe(false);
    expect(
      harness.query.mock.calls.map(([statement]) =>
        String(statement).replaceAll(/\s+/g, ' ').trim().toLowerCase(),
      ),
    ).toEqual([
      'begin',
      'set local role bap_owner',
      expect.stringMatching(/^select user_id/),
      expect.stringMatching(/^select exists/),
      'set local role bap_eraser',
      'select app.erase_user($1) as tombstone',
      'set local role bap_owner',
      expect.stringMatching(/^delete from auth\.user_erasure_request/),
      'commit',
    ]);
    expect(stdout.write).toHaveBeenCalledWith(
      `${JSON.stringify({ status: 'erased', tombstone: harness.opaqueTombstone })}\n`,
    );
    expect(stderr.write).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.end).toHaveBeenCalledOnce();
  });

  it('rejects a live user before entering the eraser role', async () => {
    const harness = createEraseUserHarness({ live: true });
    const stderr = output();

    await expect(
      runEraseUserCli([harness.userId], {
        loadPool: async () => harness.pool,
        stderr,
        stdout: output(),
      }),
    ).resolves.toBe(1);

    expect(harness.pending).toBe(true);
    expect(harness.appValue).toBe(harness.userId);
    expect(harness.query).toHaveBeenCalledWith('rollback');
    expect(harness.query).not.toHaveBeenCalledWith('set local role bap_eraser');
    expect(stderr.write).toHaveBeenCalledWith(
      '{"code":"USER_ERASURE_COMMAND_FAILED","status":"error"}\n',
    );
  });

  it('rejects an unrequested id before erasure', async () => {
    const harness = createEraseUserHarness({ pending: false });

    await expect(
      runEraseUserCli([harness.userId], {
        loadPool: async () => harness.pool,
        stderr: output(),
        stdout: output(),
      }),
    ).resolves.toBe(1);

    expect(harness.appValue).toBe(harness.userId);
    expect(harness.query).not.toHaveBeenCalledWith('set local role bap_eraser');
  });

  it('rolls back completed app erasure when request consumption fails', async () => {
    const sensitiveDetail = 'private-erasure-detail';
    const harness = createEraseUserHarness({
      failOnConsume: new Error(sensitiveDetail),
    });
    const stdout = output();
    const stderr = output();

    await expect(
      runEraseUserCli([harness.userId], {
        loadPool: async () => harness.pool,
        stderr,
        stdout,
      }),
    ).resolves.toBe(1);

    expect(harness.pending).toBe(true);
    expect(harness.appValue).toBe(harness.userId);
    expect(harness.query).toHaveBeenCalledWith('rollback');
    expect(stdout.write).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(
      sensitiveDetail,
    );
  });

  it('rejects missing input before opening a pool', async () => {
    const loadPool = vi.fn<() => Promise<DatabasePool>>();

    await expect(
      runEraseUserCli([], {
        loadPool,
        stderr: output(),
        stdout: output(),
      }),
    ).resolves.toBe(1);

    expect(loadPool).not.toHaveBeenCalled();
  });
});

describe('organization quota database CLI', () => {
  it('parses exactly one of each named argument', () => {
    expect(
      parseOrganizationQuotaArguments([
        '--note',
        ' approved capacity ',
        '--email',
        'Member@Example.Test',
        '--total',
        '4',
      ]),
    ).toEqual({
      email: 'member@example.test',
      note: 'approved capacity',
      total: 4,
    });

    for (const arguments_ of [
      [],
      ['--email', 'member@example.test', '--total', '1'],
      ['--email', 'member@example.test', '--total', '-1', '--note', 'approved'],
      [
        '--email',
        'member@example.test',
        '--email',
        'other@example.test',
        '--note',
        'approved',
      ],
    ]) {
      expect(() => parseOrganizationQuotaArguments(arguments_)).toThrow();
    }
  });

  it('sets the resulting row in one owner transaction and emits JSON', async () => {
    const harness = createOrganizationQuotaHarness();
    const stdout = output();
    const stderr = output();

    await expect(
      runOrganizationQuotaCli(
        [
          '--email',
          'member@example.test',
          '--total',
          '4',
          '--note',
          'approved capacity',
        ],
        {
          loadPool: async () => harness.pool,
          stderr,
          stdout,
        },
      ),
    ).resolves.toBe(0);

    expect(harness.committedTotal).toBe(4);
    expect(
      harness.query.mock.calls.map(([statement]) =>
        String(statement).replaceAll(/\s+/g, ' ').trim().toLowerCase(),
      ),
    ).toEqual([
      'begin',
      'set local role bap_owner',
      expect.stringMatching(/^select id/),
      expect.stringMatching(/^insert into auth\.organization_quota/),
      'commit',
    ]);
    expect(harness.query.mock.calls[2]?.[1]).toEqual(['member@example.test']);
    expect(harness.query.mock.calls[3]?.[1]).toEqual([
      'quota-user',
      4,
      'approved capacity',
    ]);
    expect(stdout.write).toHaveBeenCalledWith(
      `${JSON.stringify({
        grantedAt: harness.grantedAt,
        grantedBy: null,
        grantedTotal: 4,
        note: 'approved capacity',
        userId: 'quota-user',
      })}\n`,
    );
    expect(stderr.write).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.end).toHaveBeenCalledOnce();
  });

  it('rolls back and redacts a quota failure', async () => {
    const sensitiveDetail = 'private-quota-provider-detail';
    const harness = createOrganizationQuotaHarness({
      failOnWrite: new Error(sensitiveDetail),
    });
    const stdout = output();
    const stderr = output();

    await expect(
      runOrganizationQuotaCli(
        [
          '--email',
          'member@example.test',
          '--total',
          '4',
          '--note',
          'approved capacity',
        ],
        { loadPool: async () => harness.pool, stderr, stdout },
      ),
    ).resolves.toBe(1);

    expect(harness.committedTotal).toBeNull();
    expect(harness.query).toHaveBeenCalledWith('rollback');
    expect(stdout.write).not.toHaveBeenCalled();
    expect(stderr.write).toHaveBeenCalledWith(
      '{"code":"ORGANIZATION_QUOTA_COMMAND_FAILED","status":"error"}\n',
    );
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(
      sensitiveDetail,
    );
    expect(harness.end).toHaveBeenCalledOnce();
  });

  it('rejects malformed arguments before opening a pool', async () => {
    const loadPool = vi.fn<() => Promise<DatabasePool>>();

    await expect(
      runOrganizationQuotaCli([], {
        loadPool,
        stderr: output(),
        stdout: output(),
      }),
    ).resolves.toBe(1);
    expect(loadPool).not.toHaveBeenCalled();
  });
});

describe('database CLI entrypoint', () => {
  it('recognizes invocation through a symlink', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'bap-db-cli-'));
    const modulePath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const invokedPath = join(temporaryDirectory, 'cli.ts');

    try {
      await symlink(modulePath, invokedPath);

      expect(
        isDirectInvocation(pathToFileURL(modulePath).href, invokedPath),
      ).toBe(true);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
