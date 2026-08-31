import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  loadDatabaseConfiguration,
  loadRoleBootstrapPasswords,
  runMigrations,
} from './index.js';
import type { DatabasePool } from './pool.js';

export type SignupAction = 'disable' | 'enable' | 'status';

type CliOutput = Readonly<{ write: (value: string) => unknown }>;

export interface SignupCliDependencies {
  loadPool: () => Promise<DatabasePool>;
  stderr: CliOutput;
  stdout: CliOutput;
}

export function parseSignupAction(value: string | undefined): SignupAction {
  if (value === 'disable' || value === 'enable' || value === 'status') {
    return value;
  }

  throw new Error('Expected signup enable, signup disable, or signup status.');
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

async function loadSignupPool(): Promise<DatabasePool> {
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
  } else {
    throw new Error(
      'Expected bootstrap-roles, migrate, or signup enable|disable|status.',
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
