import type { PoolClient } from 'pg';

import type { LoginDatabaseRole } from './config.js';

const loginRoles = [
  'bap_migrator',
  'bap_auth',
  'bap_api',
  'bap_reporting',
  'bap_backup',
] as const;

type LoginRole = (typeof loginRoles)[number];

export type RolePasswords = Record<LoginRole, string>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function bootstrapDatabaseRoles(
  client: PoolClient,
  passwords: RolePasswords,
): Promise<void> {
  await client.query('begin');

  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_owner') THEN
          CREATE ROLE bap_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_eraser') THEN
          CREATE ROLE bap_eraser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_migrator') THEN
          CREATE ROLE bap_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_auth') THEN
          CREATE ROLE bap_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_api') THEN
          CREATE ROLE bap_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_reporting') THEN
          CREATE ROLE bap_reporting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bap_backup') THEN
          CREATE ROLE bap_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;
        END IF;
      END
      $$;
    `);
    await client.query(`
      ALTER ROLE bap_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE bap_eraser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT PASSWORD NULL;
      ALTER ROLE bap_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE bap_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE bap_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE bap_reporting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      ALTER ROLE bap_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;
    `);
    await client.query(`
      DO $$
      DECLARE
        membership record;
      BEGIN
        FOR membership IN
          SELECT member_role.rolname AS member_name
          FROM pg_auth_members
          INNER JOIN pg_roles AS granted_role ON granted_role.oid = roleid
          INNER JOIN pg_roles AS member_role ON member_role.oid = member
          WHERE granted_role.rolname = 'bap_eraser'
        LOOP
          EXECUTE format('REVOKE bap_eraser FROM %I', membership.member_name);
        END LOOP;

        FOR membership IN
          SELECT granted_role.rolname AS granted_name
          FROM pg_auth_members
          INNER JOIN pg_roles AS granted_role ON granted_role.oid = roleid
          INNER JOIN pg_roles AS member_role ON member_role.oid = member
          WHERE member_role.rolname = 'bap_eraser'
        LOOP
          EXECUTE format('REVOKE %I FROM bap_eraser', membership.granted_name);
        END LOOP;
      END
      $$;

      GRANT bap_owner TO bap_migrator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
      GRANT bap_eraser TO bap_owner WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
    `);

    for (const role of loginRoles) {
      await client.query(
        `ALTER ROLE ${quoteIdentifier(role)} PASSWORD ${quoteLiteral(passwords[role])}`,
      );
    }

    const database = await client.query<{ current_database: string }>(
      'select current_database()',
    );
    const name = database.rows[0]?.current_database;

    if (name === undefined) {
      throw new Error('Database name is unavailable.');
    }

    await client.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdentifier(name)} FROM PUBLIC`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(name)} TO bap_owner, bap_migrator, bap_auth, bap_api, bap_reporting, bap_backup`,
    );
    await client.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdentifier(name)} FROM bap_eraser`,
    );
    await client.query(
      `GRANT CREATE ON DATABASE ${quoteIdentifier(name)} TO bap_owner`,
    );
    // Only the superuser may install pgvector, so migrations cannot do it.
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export function getLoginRoles(): readonly LoginDatabaseRole[] {
  return loginRoles;
}
