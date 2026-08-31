import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  loadDatabaseConfiguration,
  loadRoleBootstrapPasswords,
  runMigrations,
  setOrganizationQuota,
} from './index.js';
import type { DatabasePool } from './pool.js';

export type SignupAction = 'disable' | 'enable' | 'status';

type CliOutput = Readonly<{ write: (value: string) => unknown }>;

export interface SignupCliDependencies {
  loadPool: () => Promise<DatabasePool>;
  stderr: CliOutput;
  stdout: CliOutput;
}

export interface EraseUserCliDependencies {
  loadPool: () => Promise<DatabasePool>;
  stderr: CliOutput;
  stdout: CliOutput;
}

export interface EraseUserResult {
  tombstone: string | null;
}

export interface OrganizationQuotaCliDependencies {
  loadPool: () => Promise<DatabasePool>;
  stderr: CliOutput;
  stdout: CliOutput;
}

export interface OrganizationQuotaArguments {
  email: string;
  note: string;
  total: number;
}

const organizationQuotaArgumentsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  note: z.string().trim().min(1),
  total: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(z.int().min(0).max(2_147_483_647)),
});

export function parseSignupAction(value: string | undefined): SignupAction {
  if (value === 'disable' || value === 'enable' || value === 'status') {
    return value;
  }

  throw new Error('Expected signup enable, signup disable, or signup status.');
}

export function parseEraseUserId(arguments_: readonly string[]): string {
  const userId = arguments_[0];

  if (
    arguments_.length !== 1 ||
    userId === undefined ||
    userId.length === 0 ||
    userId.length > 255 ||
    userId.trim() !== userId
  ) {
    throw new Error('Expected erase-user followed by one explicit user id.');
  }

  return userId;
}

export function parseOrganizationQuotaArguments(
  arguments_: readonly string[],
): OrganizationQuotaArguments {
  if (arguments_.length !== 6) {
    throw new Error(
      'Expected organization-quota --email <email> --total <total> --note <note>.',
    );
  }

  const values: Partial<Record<'email' | 'note' | 'total', string>> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    const key =
      flag === '--email'
        ? 'email'
        : flag === '--total'
          ? 'total'
          : flag === '--note'
            ? 'note'
            : undefined;
    if (key === undefined || value === undefined || values[key] !== undefined) {
      throw new Error(
        'Expected organization-quota --email <email> --total <total> --note <note>.',
      );
    }
    values[key] = value;
  }

  return organizationQuotaArgumentsSchema.parse(values);
}

async function bootstrapRoles(): Promise<void> {
  const env = process.env;
  const admin = createDatabasePool(
    await loadDatabaseConfiguration(env, { role: 'postgres' }),
  );

  try {
    const passwords = await loadRoleBootstrapPasswords(env);
    const client = await admin.connect();

    try {
      await bootstrapDatabaseRoles(client, passwords);
    } finally {
      client.release();
    }
  } finally {
    await admin.end();
  }
}

async function migrate(): Promise<void> {
  const pool = createDatabasePool(
    await loadDatabaseConfiguration(process.env, { role: 'bap_migrator' }),
  );

  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

export async function executeSignupAction(
  pool: DatabasePool,
  action: SignupAction,
): Promise<boolean> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('begin');
    transactionOpen = true;
    await client.query('set local role bap_owner');

    if (action !== 'status') {
      await client.query(
        `insert into auth.platform_setting ("key", enabled, updated_at)
         values ('public_signup', $1, now())
         on conflict ("key") do update
         set enabled = excluded.enabled, updated_at = excluded.updated_at`,
        [action === 'enable'],
      );
    }

    const result = await client.query<{ enabled: boolean }>(
      `select enabled
       from auth.platform_setting
       where "key" = 'public_signup'`,
    );
    await client.query('commit');
    transactionOpen = false;
    return result.rows[0]?.enabled ?? false;
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runSignupCli(
  actionValue: string | undefined,
  dependencies: SignupCliDependencies,
): Promise<number> {
  try {
    const action = parseSignupAction(actionValue);
    const pool = await dependencies.loadPool();
    let enabled: boolean;

    try {
      enabled = await executeSignupAction(pool, action);
    } finally {
      await pool.end();
    }
    dependencies.stdout.write(
      `${JSON.stringify({ publicSignupEnabled: enabled })}\n`,
    );

    return 0;
  } catch {
    dependencies.stderr.write(
      `${JSON.stringify({ code: 'PUBLIC_SIGNUP_COMMAND_FAILED', status: 'error' })}\n`,
    );
    return 1;
  }
}

export async function executeEraseUser(
  pool: DatabasePool,
  userId: string,
): Promise<EraseUserResult> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('begin');
    transactionOpen = true;
    await client.query('set local role bap_owner');

    const request = await client.query<{ user_id: string }>(
      `select user_id
       from auth.user_erasure_request
       where user_id = $1
       for update`,
      [userId],
    );
    if (request.rows[0]?.user_id !== userId) {
      throw new Error('Pending user erasure request not found.');
    }

    const identity = await client.query<{ live: boolean }>(
      `select exists (
         select 1 from auth."user" where id = $1
       ) as live`,
      [userId],
    );
    if (identity.rows[0]?.live !== false) {
      throw new Error('Live users cannot be erased.');
    }

    await client.query('set local role bap_eraser');
    const erasure = await client.query<{ tombstone: string | null }>(
      'select app.erase_user($1) as tombstone',
      [userId],
    );
    const tombstone = erasure.rows[0]?.tombstone ?? null;
    if (
      tombstone !== null &&
      !/^erased_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        tombstone,
      )
    ) {
      throw new Error('Invalid user erasure result.');
    }

    await client.query('set local role bap_owner');
    const consumed = await client.query<{ user_id: string }>(
      `delete from auth.user_erasure_request
       where user_id = $1
       returning user_id`,
      [userId],
    );
    if (consumed.rows[0]?.user_id !== userId) {
      throw new Error('Pending user erasure request was not consumed.');
    }

    await client.query('commit');
    transactionOpen = false;
    return { tombstone };
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runEraseUserCli(
  arguments_: readonly string[],
  dependencies: EraseUserCliDependencies,
): Promise<number> {
  try {
    const userId = parseEraseUserId(arguments_);
    const pool = await dependencies.loadPool();
    let result: EraseUserResult;

    try {
      result = await executeEraseUser(pool, userId);
    } finally {
      await pool.end();
    }
    dependencies.stdout.write(
      `${JSON.stringify({ status: 'erased', tombstone: result.tombstone })}\n`,
    );

    return 0;
  } catch {
    dependencies.stderr.write(
      `${JSON.stringify({ code: 'USER_ERASURE_COMMAND_FAILED', status: 'error' })}\n`,
    );
    return 1;
  }
}

export async function runOrganizationQuotaCli(
  arguments_: readonly string[],
  dependencies: OrganizationQuotaCliDependencies,
): Promise<number> {
  try {
    const input = parseOrganizationQuotaArguments(arguments_);
    const pool = await dependencies.loadPool();
    let result: Awaited<ReturnType<typeof setOrganizationQuota>>;

    try {
      result = await setOrganizationQuota(pool, input);
    } finally {
      await pool.end();
    }
    dependencies.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    dependencies.stderr.write(
      `${JSON.stringify({ code: 'ORGANIZATION_QUOTA_COMMAND_FAILED', status: 'error' })}\n`,
    );
    return 1;
  }
}

async function loadSignupPool(): Promise<DatabasePool> {
  return createDatabasePool(
    await loadDatabaseConfiguration(process.env, { role: 'bap_migrator' }),
  );
}

async function loadEraseUserPool(): Promise<DatabasePool> {
  return createDatabasePool(
    await loadDatabaseConfiguration(process.env, { role: 'bap_migrator' }),
  );
}

async function loadOrganizationQuotaPool(): Promise<DatabasePool> {
  return createDatabasePool(
    await loadDatabaseConfiguration(process.env, { role: 'bap_migrator' }),
  );
}

export async function runDatabaseCli(
  arguments_: readonly string[],
): Promise<void> {
  const command = arguments_[0];

  if (command === 'bootstrap-roles') {
    await bootstrapRoles();
  } else if (command === 'migrate') {
    await migrate();
  } else if (command === 'signup') {
    process.exitCode = await runSignupCli(arguments_[1], {
      loadPool: loadSignupPool,
      stderr: process.stderr,
      stdout: process.stdout,
    });
  } else if (command === 'erase-user') {
    process.exitCode = await runEraseUserCli(arguments_.slice(1), {
      loadPool: loadEraseUserPool,
      stderr: process.stderr,
      stdout: process.stdout,
    });
  } else if (command === 'organization-quota') {
    process.exitCode = await runOrganizationQuotaCli(arguments_.slice(1), {
      loadPool: loadOrganizationQuotaPool,
      stderr: process.stderr,
      stdout: process.stdout,
    });
  } else {
    throw new Error(
      'Expected bootstrap-roles, migrate, signup enable|disable|status, erase-user <user-id>, or organization-quota --email <email> --total <total> --note <note>.',
    );
  }
}

export function isDirectInvocation(
  moduleUrl: string,
  invokedPath: string | undefined,
): boolean {
  if (!invokedPath) {
    return false;
  }

  if (moduleUrl === pathToFileURL(invokedPath).href) {
    return true;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(invokedPath)).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  void runDatabaseCli(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      `${JSON.stringify({ code: 'DATABASE_COMMAND_FAILED', status: 'error' })}\n`,
    );
    process.exitCode = 1;
  });
}
