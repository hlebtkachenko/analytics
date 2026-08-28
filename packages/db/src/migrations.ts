import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import type { DatabasePool } from './pool.js';

export interface MigrationRunResult {
  applied: string[];
  currentVersion: string | null;
}

export interface RunMigrationsOptions {
  directory?: URL;
}

interface MigrationFile {
  checksum: string;
  id: string;
  sql: string;
}

const migrationLock = 7_036_289_102n;

async function loadMigrationFiles(directory: URL): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const id = file.split('_')[0];

      if (id === undefined || !/^\d{8}\.\d{4}$/.test(id)) {
        throw new Error(`Invalid migration name: ${file}`);
      }

      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        id,
        sql,
      };
    }),
  );
}

export async function runMigrations(
  pool: DatabasePool,
  options: RunMigrationsOptions = {},
): Promise<MigrationRunResult> {
  const directory =
    options.directory ?? new URL('../drizzle/', import.meta.url);
  const migrations = await loadMigrationFiles(directory);
  const client = await pool.connect();

  try {
    await client.query('select pg_advisory_lock($1)', [migrationLock]);
    await client.query('begin');
    await client.query('set local role bap_owner');
    await client.query('create schema if not exists bap_migrations');
    await client.query(`
      create table if not exists bap_migrations.schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const existing = await client.query<{ checksum: string; id: string }>(
      'select id, checksum from bap_migrations.schema_migrations',
    );
    const checksums = new Map(
      existing.rows.map((migration) => [migration.id, migration.checksum]),
    );
    const applied: string[] = [];

    for (const migration of migrations) {
      const previousChecksum = checksums.get(migration.id);

      if (previousChecksum !== undefined) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(`Migration checksum changed: ${migration.id}`);
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        'insert into bap_migrations.schema_migrations (id, checksum) values ($1, $2)',
        [migration.id, migration.checksum],
      );
      applied.push(migration.id);
    }

    await client.query('commit');
    return {
      applied,
      currentVersion: migrations.at(-1)?.id ?? null,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [migrationLock]);
    client.release();
  }
}
