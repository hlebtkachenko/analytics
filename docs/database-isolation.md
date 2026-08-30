# Database Ownership and Tenant Isolation

`@bap/db` is the only application database boundary. It loads individual
host/port/database/user values and a protected password file. Password-bearing
connection URLs are not accepted.

## Roles

| Role            | Purpose                                  | Owner membership | RLS bypass |
| --------------- | ---------------------------------------- | ---------------- | ---------- |
| `bap_owner`     | Own schemas and reviewed objects         | Not a login      | No         |
| `bap_migrator`  | Run reviewed migrations after `SET ROLE` | SET only         | No         |
| `bap_auth`      | Better Auth tables and rate limits       | None             | No         |
| `bap_api`       | Application membership resolver          | None             | No         |
| `bap_reporting` | Reporting membership resolver            | None             | No         |
| `bap_backup`    | Full read-only logical dump              | None             | Yes        |

Every login role is `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
and `NOREPLICATION`. Runtime roles cannot select auth base tables. The backup
role has no DML, DDL, schema creation, or `SET ROLE` ability.

## Migrations

Reviewed migrations live only in `packages/db/drizzle`. The runner takes a
PostgreSQL advisory lock, checks immutable SHA-256 checksums, begins one
transaction, sets the owner role locally, and records the migration version.
Application startup never migrates.

Fresh local and CI databases run role bootstrap first, then the migrator.
Production repeats those idempotent commands with administrator and migrator
credential files mounted only to their one-shot services.

## Adding a migration

Only one branch at a time may add a migration file. Two branches that pick the
same id merge cleanly in git and then break at runtime, because the runner
applies the first file, records that id, and treats the second file as already
applied. Land the open migration branch first, then rebase and rename the later
file to the next free id.

`DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` is compared
for exact equality against the recorded version. Bump it to the newest migration
id in the same pull request that adds the migration. Rolling application code
back after that migration is applied leaves the constant behind the database,
and `/ready` returns 503 on every service until the constant is bumped again.

Every new schema must grant `USAGE` on the schema and `SELECT` on its tables and
sequences to `bap_backup`, and must set matching default privileges for later
objects. Without those grants the whole-database dump breaks.

## Tenant policy contract

Every future tenant table must include:

- a non-null `organization_id`;
- an index beginning with `organization_id`;
- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`;
- a `USING` policy for reads and changes;
- a matching `WITH CHECK` policy for inserted or changed rows.

Tenant context is set with `SET LOCAL` inside one transaction. It cannot persist
through pooled connections after commit or rollback. Missing context fails
closed. Production migrations never enumerate disposable RLS test fixtures.

## Verification

The PostgreSQL 18.6 integration suite proves concurrent migration locking,
checksum behavior, exact grants, membership resolution, missing context,
cross-organization forced RLS, transaction reset, Better Auth rate-limit access,
pgvector availability, full `pg_dump` as `bap_backup`, and denial of backup
writes, schema changes, and owner role changes.

It also proves the phase 1 authorization tables: `app.data_grants` is readable
only inside its own tenant context and rejects a cross-tenant write, and
`app.audit_log` is append only, since no service role holds `INSERT`, `UPDATE`,
or `DELETE` on it. `app.record_audit` is asserted to be `SECURITY DEFINER` with
a fixed `search_path` and to take no organization or subject argument at all, so
a caller cannot name the tenant it writes to; attribution comes from
`current_setting`, and a payload claiming another organization still lands in
the caller's own tenant.
