# Database Ownership and Tenant Isolation

`@bap/db` is the only application database boundary. It loads individual
host/port/database/user values and a protected password file. Password-bearing
connection URLs are not accepted.

## Roles

| Role            | Purpose                                  | Owner membership | RLS bypass |
| --------------- | ---------------------------------------- | ---------------- | ---------- |
| `bap_owner`     | Own schemas and reviewed objects         | Not a login      | No         |
| `bap_eraser`    | Anonymize 3 approved subject columns     | SET from owner   | Yes        |
| `bap_migrator`  | Run reviewed migrations after `SET ROLE` | SET only         | No         |
| `bap_auth`      | Better Auth tables and rate limits       | None             | No         |
| `bap_api`       | Application membership resolver          | None             | No         |
| `bap_reporting` | Reporting membership resolver            | None             | No         |
| `bap_backup`    | Full read-only logical dump              | None             | Yes        |

Every login role is `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
and `NOREPLICATION`. Runtime roles cannot select auth base tables. The backup
role has no DML, DDL, schema creation, or `SET ROLE` ability.

`bap_eraser` is also `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
and `NOREPLICATION`, but it is not a login, has no password or database CONNECT,
and holds BYPASSRLS. `bap_owner` may SET it with inheritance disabled. Role
bootstrap removes every other incoming or outgoing membership on each run before
restoring that exact edge. Neither `bap_auth` nor `bap_api` can assume it.

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

The `auth` schema has a separate default privilege for Better Auth: a table
created by `bap_owner` inherits SELECT, INSERT, UPDATE, and DELETE for
`bap_auth`. `auth.platform_setting` is an intentional exception. Its migration
revokes the inherited grant, leaves dump-only SELECT with `bap_backup`, and
exposes the default-off public sign-up value to `bap_auth` only through
`auth.public_signup_enabled()`. A missing setting row returns false. Only a
host-shell operator with the `bap_migrator` credential can use the database
CLI's `signup enable|disable|status` commands; switch writes assume `bap_owner`
with `SET LOCAL` inside a transaction.

`auth.user_erasure_request` is the second intentional auth-table exception. It
contains pending explicit user ids only and has no foreign key, so a request
survives deletion of `auth.user`. `bap_auth` has no table privilege and may only
execute `auth.request_user_erasure(text)`, which records a currently live user.
`bap_backup` keeps SELECT for complete dumps. Successful operator processing
deletes the request in the same transaction as app anonymization, so no
completed raw-id mapping is retained.

`auth.organization_quota` is another intentional exception to the inherited
auth-table DML. An absent row means zero allowance. Its migration revokes every
direct `bap_auth` privilege and returns SELECT only; `bap_backup` retains SELECT
for dumps, and API and reporting roles have no access. No runtime-executable
function can write it. The setup-only `@bap/db` accessor connects separately as
`bap_migrator`, opens 1 transaction, sets `bap_owner` locally, and changes only
an absent or zero row to the minimum 1. Existing positive grants and their
provenance remain untouched.

The web-accessible `@bap/db` reader joins that SELECT-only quota row to a count
of `auth.organization.created_by` and returns a nullable limit decision. The
auth configuration converts NULL, malformed state, and query errors to "limit
reached". General grants use a separate database CLI accessor through
`bap_migrator`; it opens 1 transaction, sets `bap_owner` locally, resolves the
user by a parameterized email, and upserts `granted_total`, a NULL `granted_by`,
the grant time, and the required operator note. No quota-write function or DML
grant is added to `bap_auth`.

`auth.organization.created_by` is a nullable user foreign key with
`ON DELETE SET NULL`. NULL denotes an unattributed legacy or system organization
and consumes no user's quota. For an attributed INSERT, the invoker-rights
BEFORE trigger takes `pg_advisory_xact_lock(hashtext(created_by))`, reads the
quota, and counts organizations attributed to that creator. The advisory lock
serializes concurrent creates without requiring `bap_auth` to update the quota
row. Its function is owned by `bap_owner`, has a fixed search path, and grants
no direct execution to runtime roles.

`app.erase_user(text)` is an invoker-rights, fixed-search-path function. The
eraser role has schema usage, function execution, and SELECT/UPDATE on only
`audit_log.user_id`, `data_grants.user_id`, and `dataset.created_by`. It has no
table-wide grant. The database CLI connects as `bap_migrator`, sets owner to
lock and validate the pending request, sets eraser for the app function, returns
to owner to consume the request, and commits once. A live or unrequested id is
refused before eraser role entry. `bap_auth` retains zero access to schema
`app`, and `bap_api` retains no UPDATE on `app.audit_log`.

The public sign-up edge limiter also stays behind `@bap/db`. One statement
inserts or atomically advances a hashed, namespaced `auth.rate_limit` key before
the web route parses the request. IPv4 identities remain /32 and IPv6 identities
are canonicalized to /64 before hashing. Its conflict update runs only while the
count is below 3 or the 60-second window has expired. Once full, the statement
returns no row and performs no write until expiry. The same data-modifying CTE
prunes expired rows from only the edge namespace on every consume. A partial
`last_request` index supports that cleanup; Better Auth's own keys are retained.

## Tenant policy contract

Every future tenant table must include:

- a non-null `organization_id`;
- an index beginning with `organization_id`;
- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`;
- a `USING` policy for reads and changes;
- a matching `WITH CHECK` policy for inserted or changed rows.

Split the policies per command whenever a table is readable more widely than it
is writable. A single `ALL` policy applies its `USING` clause to `DELETE` and to
the row selection of `UPDATE`, so a read grant would silently confer deletion.
`app.dataset`, `app.dataset_column`, `app.dataset_row`, and
`app.dataset_embedding` therefore carry separate `SELECT`, `INSERT`, `UPDATE`,
and `DELETE` policies: reading follows the dataset, writing stays with its
creator.

Tenant context is set with `SET LOCAL` inside one transaction. It cannot persist
through pooled connections after commit or rollback. Missing context fails
closed. Production migrations never enumerate disposable RLS test fixtures.

## Verification

The PostgreSQL 18.6 integration suite proves concurrent migration locking,
checksum behavior, exact grants, membership resolution, missing context,
cross-organization forced RLS, transaction reset, Better Auth rate-limit access,
the public sign-up accessor and its default-privilege exception, invitation
states, exactly 3 successful concurrent edge-limit consumes, and cleanup that
removes expired edge identities while retaining fresh edge and non-edge rows. It
also proves pgvector availability, full `pg_dump` as `bap_backup`, and denial of
backup writes, schema changes, and owner role changes.

Account-lifecycle coverage additionally asserts exact eraser attributes,
membership options, CONNECT denial, request-table ACLs, both function owners and
search paths, and the 6 column privileges needed by the erasure function. It
proves sole-owned and co-owned counts, all identity cascades, live and
unrequested refusal, one opaque tombstone across all 3 app columns, request
consumption, and idempotent stored state.

Organization-creation coverage asserts the exact quota columns, named checks,
foreign-key delete actions, trigger and function catalog state, direct table ACL
and inherited default-privilege exception. It proves `bap_auth` has SELECT only,
cannot write quota or disable the trigger, absence means zero, NULL attribution
consumes no quota, positive quotas work, and two concurrent quota-1 inserts
produce exactly 1 organization. It also exercises the nullable web precheck and
the migrator-to-owner quota writer with its stored note and NULL auth grantor. A
shared corpus proves that PostgreSQL and the web Zod validator agree on valid,
malformed, overlong, numeric, and reserved slugs. It also verifies that invalid
legacy membership is returned as no access instead of a server error.

It also proves the phase 1 authorization tables: `app.data_grants` is readable
only inside its own tenant context and rejects a cross-tenant write, and
`app.audit_log` is append only, since no service role holds `INSERT`, `UPDATE`,
or `DELETE` on it. `app.record_audit` is asserted to be `SECURITY DEFINER` with
a fixed `search_path` and to take no organization or subject argument at all, so
a caller cannot name the tenant it writes to; attribution comes from
`current_setting`, and a payload claiming another organization still lands in
the caller's own tenant.

It also proves the phase 3 embedding table. `app.dataset_embedding` stores one
`vector(1536)` per dataset, keyed to its parent by a composite foreign key that
pins `organization_id` to the dataset's own value. The suite seeds a second
tenant with a byte-identical vector and asserts that a nearest-neighbour query
ordered by cosine distance still returns only the caller's rows, that a read
grant confers neither `DELETE`, `UPDATE`, nor a conflicting `INSERT`, that
`bap_reporting` may read but not write, that `bap_backup` sees every tenant's
vectors and may not delete them, and that `pg_dump` carries both the table and
its data. The dimension is fixed by the embedding model the AI credential names:
adopting a model of another width needs a new migration and a full re-backfill.
