# Database Ownership and Tenant Isolation

`@bap/db` is the only application database boundary. It loads individual
host/port/database/user values and a protected password file. Password-bearing
connection URLs are not accepted.

## Roles

| Role            | Purpose                                  | Owner membership | RLS bypass |
| --------------- | ---------------------------------------- | ---------------- | ---------- |
| `bap_owner`     | Own schemas and reviewed objects         | Not a login      | No         |
| `bap_eraser`    | Anonymize 8 approved subject columns     | SET from owner   | Yes        |
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

The Phase 10 quota-display accessor uses the same SELECT-only role and join. It
returns granted, attributed, and non-negative remaining totals. An absent row is
NULL and the web page converts NULL, malformed state, and query errors to zero.
It adds no quota write path.

The web organization-route accessor also stays behind `@bap/db`. Through the
existing `bap_auth` pool it performs 1 parameterized join of `auth.organization`
and `auth.member`, keyed by validated slug and authenticated subject id. It
returns only organization id, name, slug, and a safely parsed membership role. A
missing membership or invalid legacy role returns no route. API and reporting
roles continue to use only the fixed
`auth.resolve_membership(subject_id, organization_id)` function and gain no slug
lookup.

Migration `20260831.0004` reserves the newly published literal `/organizations`
route. It checks for an existing colliding organization before dropping the
previous stable named constraint, then recreates that constraint with all 16
literals. A collision raises a named check violation and rolls back the
migration. There is no down migration. Rolling code back after this schema
change leaves readiness at 503 until code expecting exact compatibility
`20260831.0004` is deployed or the expected version is deliberately advanced.

`auth.organization.created_by` is a nullable user foreign key with
`ON DELETE SET NULL`. NULL denotes an unattributed legacy or system organization
and consumes no user's quota. For an attributed INSERT, the invoker-rights
BEFORE trigger takes `pg_advisory_xact_lock(hashtext(created_by))`, reads the
quota, and counts organizations attributed to that creator. The advisory lock
serializes concurrent creates without requiring `bap_auth` to update the quota
row. Its function is owned by `bap_owner`, has a fixed search path, and grants
no direct execution to runtime roles.

`app.erase_user(text)` is an invoker-rights, fixed-search-path function. The
eraser role has schema usage, function execution, SELECT/UPDATE on only
`audit_log.user_id`, `dataset.created_by`, `legal_entity.created_by`,
`member_entity_scope.updated_by`, `legal_entity_access.created_by`,
`document.created_by`, `partner.created_by`, and `document_link.created_by`,
plus SELECT on the two scope tables' `user_id` and DELETE on those two tables so
a subject's own scope rows disappear. `data_grants.user_id` was removed with
that table under ADR 0011. It has no other table-wide grant. The database CLI
connects as `bap_migrator`, sets owner to lock and validate the pending request,
sets eraser for the app function, returns to owner to consume the request, and
commits once. A live or unrequested id is refused before eraser role entry.
`bap_auth` retains zero access to schema `app`, and `bap_api` retains no UPDATE
on `app.audit_log`.

The public sign-up edge limiter also stays behind `@bap/db`. One statement
inserts or atomically advances a hashed, namespaced `auth.rate_limit` key before
the web route parses the request. IPv4 identities remain /32 and IPv6 identities
are canonicalized to /64 before hashing. Its conflict update runs only while the
count is below 3 or the 60-second window has expired. Once full, the statement
returns no row and performs no write until expiry. The same data-modifying CTE
prunes expired rows from only the edge namespace on every consume. A partial
`last_request` index supports that cleanup; Better Auth's own keys are retained.

Migration `20260910.0001` implements ADR 0011's two-level tenancy.
`DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` is now
`20260910.0001`; rolling application code back after this migration leaves
readiness at 503 until code expecting that exact version is deployed or the
expected version is deliberately advanced.

It adds
`app.legal_entity(id, organization_id, name, kind, registration_number, created_by, created_at, updated_at)`,
unique on `(id, organization_id)` and on `(organization_id, name)`, with `kind`
constrained to `company` or `sole_trader`. `app.member_entity_scope` is keyed
`(organization_id, user_id)` and records `mode` as `all` or `restricted`.
`app.legal_entity_access` names the individual entities a restricted member or
admin may see, with a composite foreign key to `app.legal_entity` that cascades
on delete. `app.dataset.legal_entity_id` and `app.upload.legal_entity_id` are
`NOT NULL` composite foreign keys to the entity, also `ON DELETE CASCADE`; a
development database holding datasets must be reset before this migration runs.
`app.data_grants` is dropped: dataset visibility no longer depends on the
creator or a per-dataset grant, only on organization membership and, at the
application layer, entity scope.

The tenant transaction gains a third setting, `bap.role`, alongside
`bap.organization_id` and `bap.user_id`; `withTenantContext` in `@bap/db` sets
all three together. Two `SECURITY INVOKER` helpers read it:
`app.role_can_write()` is true for `owner` and `admin`, and
`app.role_is_owner()` is true only for `owner`. Every write policy on the new
tables calls one of them, so the database itself refuses a write from a
read-only member and an entity deletion from an admin, independently of whatever
the application layer already checked.

The new tables' policies follow one shape: `SELECT` stays organization-wide,
matching the existing tenant policy contract below; entity `INSERT` and `UPDATE`
require `role_can_write()`; entity `DELETE`, and every write to
`app.member_entity_scope` and `app.legal_entity_access`, require
`role_is_owner()`. Row level security does not filter by entity: the "all
entities" view is the absence of an application-level filter, never a
database-level one. Entity selection and the restricted scope are computed by
one resolver in `@bap/db`,
`readEntityScope(transaction, { organizationId, role, userId })`, which returns
`{ mode: 'all' }` for an owner or an unscoped admin or member, or
`{ mode: 'restricted', legalEntityIds }` otherwise; every new data path that
reads a dataset or an upload must go through it, because the database will not
apply that filter on its own.

Migration `20260914.0001` drops `auth.account.issuer` and its
`account_issuer_account_id_key` unique index: Better Auth 1.7.3 removed the
`issuer` field from its account model and validates the schema at init, so the
stale column made every account insert fail.
`account_provider_id_account_id_key`, unique on `(provider_id, account_id)`,
replaces it, matching the pair Better Auth 1.7.3 now uses to identify an
account.

Migration `20260914.0002` adds the documents register.

It adds one shared reference table and 9 tenant tables. `app.directive_account`
holds the Czech synthetic chart of accounts keyed by a 3 digit `code`, seeded
with 218 rows from decree 500/2002 Sb., appendix 1. It carries no
`organization_id` and no row level security, because the same chart is correct
for every tenant; it is readable by `bap_api`, `bap_reporting`, and `bap_backup`
and writable by none of them.

The tenant tables are `app.partner` (organization wide, optionally naming one of
our own legal entities to make an intercompany document detectable),
`app.document` (the uniform register, per legal entity, with `kind`, `status`, a
version chain through `supersedes_document_id` and `is_current`, and free
`app.document_attribute` key and value pairs for kinds with no dedicated
content), `app.invoice` and `app.invoice_line` (content for the two invoice
kinds), `app.economic_event` and `app.economic_event_line` (derived, one current
event per document, rebuildable), `app.document_link` (directed links of any
kind between two documents), and `app.data_issue` (what derivation found, so an
imbalance is reported instead of blocking a write). `app.upload` gains
`upload_id_organization_key` so a document can pin an upload's `organization_id`
to its own.

Every one of those 9 tables carries `organization_id`, `ENABLE` and `FORCE` row
level security, and the same 4 per command policies the tenant policy contract
below describes: `SELECT` is organization-wide and every write requires
`app.role_can_write()`, plus `created_by = current_setting('bap.user_id', true)`
on the 3 tables that record authorship. Entity-scoped tables pin
`legal_entity_id` through a composite foreign key to
`app.legal_entity(id, organization_id)`, and every child pins its parent the
same way, so a row can never reference another organization's entity, partner,
upload, or document. `bap_api` gets full DML, `bap_reporting` and `bap_backup`
get SELECT. The eraser gains `created_by` column grants on `app.document`,
`app.partner`, and `app.document_link`, and `app.erase_user` tombstones those 3
columns alongside the existing ones. The migration also reserves the `documents`
organization slug with the `20260831.0004` guard-then-replace pattern, bringing
`organization_slug_reserved_check` to 17 literals.

Three constraints exist because the application boundary is not the only writer.
`document_current_reference_key` is unique on
`(legal_entity_id, kind, reference)` only
`WHERE reference IS NOT NULL AND is_current`, so a superseded version keeps its
old reference and only the live row claims it. `invoice_line_vat_zero_check`
refuses VAT on a line that is not `standard`, and
`invoice_line_vat_tolerance_check` refuses a `standard` line whose `vat_amount`
differs from `round(base_amount * vat_rate / 100, 2)` by more than half a unit,
which tolerates per line or per rate rounding in a source system without
tolerating a wrong number. `data_issue_open_key` is unique on
`(document_id, code)` only while `resolved_at` is null, so one issue per code
stays open while resolved history may repeat.

Migration `20260915.0001` makes one invoice able to describe several months.
`app.invoice_line` gains `line_kind` (`item` or `advance_deduction`, default
`item`), `tax_point_date`, `period_start`, `period_end`, and `activity_code`;
`category` becomes nullable, gains the `labour` and `transport` values, and is
tied to the kind by `invoice_line_category_kind_check`, so a supply always names
a category and an advance deduction never does. `app.invoice` gains the signed
`rounding_amount` bounded to under one unit, `advance_total`, and `amount_due`,
a stored generated column equal to
`gross_total + rounding_amount - advance_total` that the application can never
write, with `invoice_amount_due_check` keeping the advance at or below the
printed total. `app.economic_event_line` gains `effective_date` and
`activity_code`, so a monthly report groups legs by their own tax point while
the event header keeps the document date; existing legs are backfilled from
`coalesce(app.invoice.tax_point_date, app.economic_event.event_date)` before
`effective_date` becomes non-null, and `economic_event_line_effective_date_idx`
on `(organization_id, effective_date, account_code)` serves that read. Because
`bap_owner` is `NOBYPASSRLS` and a migration sets no tenant, that backfill drops
`FORCE ROW LEVEL SECURITY` on `app.economic_event`, `app.economic_event_line`,
and `app.invoice` and restores it in the same migration transaction, so the
update sees every existing leg and no table is ever left unforced; it also
replaces `economic_event_line_account_idx` with
`economic_event_line_account_date_idx` on
`(organization_id, account_code, effective_date)`, because the account
drill-down now reads one account over a period. Row level security, policies,
and grants are otherwise table level and unchanged.
`DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` was
`20260915.0001` after this migration.

Migration `20260916.0001` adds the Inbox intake tables of ADR 0014 and ADR 0015:
`app.blob` (content addressed per organization, unique on
`(organization_id, sha256)`), `app.inbox_item` (the intake envelope, with a
nullable `legal_entity_id`, typed destination columns `document_id`,
`dataset_id` and `partner_id` each pinned by a composite foreign key with
`ON DELETE RESTRICT`, `inbox_item_one_destination_check` and
`inbox_item_routed_check`), `app.inbox_item_file`, `app.inbox_item_extraction`,
`app.inbox_event` and `app.document_file`. `app.document` gains `inbox_item_id`
and loses `upload_id`, `content_hash`, `document_upload_fkey`,
`document_content_hash_check` and `document_upload_idx`; `document_kind_check`
accepts `advance_request` and `document_link_kind_check` accepts `advance_of`.
All 6 tables carry the same per command policies as the documents tables, with
`created_by = current_setting('bap.user_id', true)` on the 4 that record
authorship; `bap_api` gets full DML, `bap_reporting` and `bap_backup` get
SELECT. The eraser gains column grants on `blob.created_by`,
`inbox_item.created_by`, `inbox_item.assignee_id`,
`inbox_item.decided_by_user_id`, `inbox_item_extraction.created_by`,
`inbox_event.actor_user_id` and `document_file.created_by`, and `app.erase_user`
tombstones all 7. The migration reserves the `inbox` organization slug with the
guard-then-replace pattern, bringing `organization_slug_reserved_check` to 18
literals. `DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` was
`20260916.0001` after this migration.

Migration `20260917.0001` adds the channel principal of ADR 0016. `bap.role`
gains the value `channel`, which is not a membership role: a channel runs as
`bap.user_id = 'channel_<uuid>'` with no `auth."user"` row and no new database
role, and `app.role_is_channel()` (STABLE, SECURITY INVOKER, EXECUTE to
`bap_api` and `bap_reporting`) is the only predicate that names it.
`app.inbox_channel` is the channel register (`kind` `email` or `api`, `enabled`,
`deleted_at`, a composite `legal_entity_id` pin, `config` for non-secret
settings only); reads are organization wide for people and limited to the
channel's own row for a channel, INSERT and DELETE need `app.role_is_owner()`,
UPDATE needs `app.role_can_write()`, and `inbox_channel_maintenance_select`
admits `bap_owner` so the credential resolver can run outside a tenant
transaction. `app.inbox_item` gains `channel_id` (composite foreign key,
`ON DELETE RESTRICT`) and `origin`, with `inbox_item_channel_check` requiring a
channel for every kind except `upload`. `auth.inbox_channel_credential` keeps
`secret_sha256` (unique) and an 8 character `display_prefix`, never the plain
secret; the inherited `bap_auth` DML is revoked after the CREATE, `bap_api`
holds nothing, and three `SECURITY DEFINER` functions owned by `bap_owner` are
the whole surface: `auth.issue_channel_credential(channel_id, kind)` and
`auth.revoke_channel_credential(credential_id)` (EXECUTE to `bap_api`, tenant
and subject from the transaction settings, `bap.role = 'owner'` asserted, at
most two unrevoked credentials per channel) and
`auth.resolve_channel_credential(sha256)` (EXECUTE to `bap_auth`, returns the
binding for one unrevoked credential of an enabled, undeleted channel and stamps
`last_used_at`). The five inbox INSERT policies (`blob_insert`,
`inbox_item_insert`, `inbox_item_file_insert`, `inbox_item_extraction_insert`,
`inbox_event_insert`) become
`... AND (app.role_can_write() OR app.role_is_channel())` with the `created_by`
check outside the parentheses; `inbox_item_channel_update` lets a channel move
an unrouted item that no person decided and never set a destination column;
`blob_update` is unchanged. Every non-inbox tenant SELECT policy gains
`AND NOT app.role_is_channel()` (`legal_entity`, `member_entity_scope`,
`legal_entity_access`, `dataset`, `dataset_column`, `dataset_row`,
`dataset_embedding`, `upload`, `partner`, `document`, `document_attribute`,
`invoice`, `invoice_line`, `economic_event`, `economic_event_line`,
`document_link`, `data_issue`), while `blob`, `document_file` and the inbox
tables stay readable by a channel. `audit_log_isolation` is split into
`audit_log_select` (excludes the channel), `audit_log_insert`,
`audit_log_update` and `audit_log_delete`; because `INSERT ... RETURNING` reads
the new row through the SELECT policy, `app.record_audit` now generates the id
before the insert instead of reading it back. `auth."user"` gains
`user_id_not_channel_check` (`id NOT LIKE 'channel\_%'`), `app.erase_user`
raises on a `channel_` subject and tombstones `inbox_channel.created_by`, for
which the eraser gains column grants. The migration installs the trusted
`pgcrypto` extension for `gen_random_bytes`. `DATABASE_MIGRATION_COMPATIBILITY`
in `packages/db/src/access.ts` is now `20260917.0001`; rolling application code
back after this migration leaves readiness at 503 until code expecting that
exact version is deployed or the expected version is deliberately advanced.

Migration `20260917.0002` adds the fourth definer function of ADR 0016,
`auth.list_channel_credentials(channel_id)`: `bap_api` holds no SELECT on
`auth.inbox_channel_credential`, so the settings page lists a channel's active,
unrevoked credentials by `display_prefix` only, in creation order, through this
function instead. It asserts `bap.role = 'owner'` and reads the organization
from the transaction settings, the same checks as `issue_channel_credential` and
`revoke_channel_credential`, and never returns the hash.
`DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` is now
`20260917.0002`.

## Tenant policy contract

Every future tenant table must include:

- a non-null `organization_id`;
- an index beginning with `organization_id`;
- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`;
- a `USING` policy for reads and changes;
- a matching `WITH CHECK` policy for inserted or changed rows.

A table that attaches to a legal entity, such as `app.dataset`, `app.upload`,
`app.document`, and `app.economic_event`, also carries a non-null
`legal_entity_id` and a composite foreign key against
`app.legal_entity(id, organization_id)` rather than a bare reference to the
entity id. That composite key pins the entity to the row's own
`organization_id`, so an entity from another organization can never be attached
even before row level security is evaluated.

Split the policies per command whenever a table is readable more widely than it
is writable. A single `ALL` policy applies its `USING` clause to `DELETE` and to
the row selection of `UPDATE`, so a read grant would silently confer deletion.
`app.dataset`, `app.dataset_column`, `app.dataset_row`, `app.dataset_embedding`,
`app.partner`, `app.document`, `app.document_attribute`, `app.invoice`,
`app.invoice_line`, `app.economic_event`, `app.economic_event_line`,
`app.document_link`, and `app.data_issue` therefore carry separate `SELECT`,
`INSERT`, `UPDATE`, and `DELETE` policies: `SELECT` is organization-wide, and
writing requires `app.role_can_write()` rather than matching the creator, since
ADR 0011 made `member` read-only and dropped the per-dataset grant.

A stored entity scope must not outlive the membership it describes. Migration
`20260910.0001` therefore adds `app.clear_member_entity_scope()`, a
`SECURITY DEFINER` trigger function owned by `bap_owner` with a fixed
`search_path`, fired `AFTER DELETE` on `auth.member` and `AFTER UPDATE OF role`
when the new role is `owner`. It deletes the `app.member_entity_scope` and
`app.legal_entity_access` rows of that exact `(organization_id, user_id)` pair,
taken from the row itself rather than from an argument, so a re-invited subject
starts unrestricted and a promoted owner keeps no stale restriction. Because
`FORCE ROW LEVEL SECURITY` applies to the definer too, and a `DELETE` reads its
own `WHERE` clause through the `SELECT` policies, both tables carry a `SELECT`
and a `DELETE` maintenance policy granted to `bap_owner` alone; Better Auth
itself writes `auth.member` as `bap_auth`, which still holds nothing in schema
`app`.

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
search paths, and the column privileges needed by the erasure function. It
proves sole-owned and co-owned counts, all identity cascades, live and
unrequested refusal, one opaque tombstone across the 2 remaining app columns now
that `app.data_grants` is dropped, request consumption, and idempotent stored
state.

Organization-creation coverage asserts the exact quota columns, named checks,
foreign-key delete actions, trigger and function catalog state, direct table ACL
and inherited default-privilege exception. The default probe executes SELECT,
INSERT, UPDATE, and DELETE as `bap_auth` on a newly created disposable `auth.*`
table. The quota assertions then prove `bap_auth` has SELECT only, cannot write
quota or disable the trigger, and still has no schema `app` usage. Absence means
zero, NULL attribution consumes no quota, positive quotas work, and the
deterministic two-backend quota-1 test observes the advisory-lock waiter before
proving exactly 1 organization succeeds. It also exercises the nullable web
precheck and the migrator-to-owner quota writer with its stored note and NULL
auth grantor. A shared corpus proves that PostgreSQL and the web Zod validator
agree on valid, malformed, overlong, numeric, and every reserved slug. It also
verifies that invalid legacy membership is returned as no access instead of a
server error.

Organization-routing coverage performs the real join through `bap_auth` and
proves member success plus nonmember and unknown-slug absence. It separately
passes the valid stored slug as an `organization_id` to the API role's resolver
and proves no row is returned, preserving the id-only service boundary. The
paired BFF assertion proves that the same syntactically valid slug is forwarded
only to the fixed application target with an in-memory resource token, returns
the service's 403, and exposes only the fixed `access_denied` response.

It also proves the append-only phase 1 authorization table: `app.audit_log`
allows no service role `INSERT`, `UPDATE`, or `DELETE`. `app.record_audit` is
asserted to be `SECURITY DEFINER` with a fixed `search_path` and to take no
organization or subject argument at all, so a caller cannot name the tenant it
writes to; attribution comes from `current_setting`, and a payload claiming
another organization still lands in the caller's own tenant. `app.data_grants`
itself is dropped by migration `20260910.0001`; the suite instead proves that
`app.legal_entity`, `app.member_entity_scope`, and `app.legal_entity_access` are
each `ENABLE`/`FORCE` RLS, that `app.role_can_write()` and `app.role_is_owner()`
gate exactly the write policies described above, that an entity delete by an
admin is rejected, that an entity insert or dataset upload naming an entity from
another organization is rejected by the composite foreign key, and that a
restricted member's out-of-scope dataset read returns the same absence as a
nonmember's. It also proves the scope maintenance trigger end to end as
`bap_auth`: removing a membership and promoting one to `owner` each delete the
subject's scope and access rows, and a re-added member resolves as unrestricted.

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

`packages/db/src/documents.integration.test.ts` covers the documents register on
its own container. It proves that migration `20260915.0001` applies and records
exactly the version `DATABASE_MIGRATION_COMPATIBILITY` expects, that
`app.directive_account` holds all 218 seeded accounts, is readable by
`bap_reporting`, and carries no row level security, and that an owner writing
through `bap_api` can register a partner, a document, its attributes, its
invoice and lines, its derived event and lines, a link, and a data issue in one
tenant transaction. It then proves that another organization sees 0 rows in all
9 tables, that a `member` is refused a document insert and still reads, that a
document naming another organization's legal entity is refused by
`document_legal_entity_fkey`, that the 2 VAT check constraints refuse a
contradictory line while a half unit rounding difference passes, that a
self-directed link is refused, that a second current document cannot claim a
reference until the first stops being current, that deleting a document destroys
its content, event, links, and issues by cascade, that `app.erase_user`
tombstones `created_by` on documents, partners, and links while leaving another
subject's rows alone, that `bap_backup` reads every new table, that
`bap_reporting` may not insert a document, and that the reserved `documents`
slug is refused by `organization_slug_reserved_check`.

The same file covers the `20260915.0001` columns: an item line without a
category and an advance deduction line with one are both refused, `labour` and
`transport` are accepted, a period whose start is after its end is refused, the
activity code regex is enforced on both the invoice line and the event line, a
rounding of one unit is refused while `0.99` and `-0.99` pass, an advance above
the printed total is refused, `amount_due` is computed by the database and
refuses a direct write with `428C9`, and `effective_date` is non-null and
indexed by `economic_event_line_effective_date_idx`. One further test builds a
second database on the same container, migrates it to the state before
`20260915.0001`, writes an event line there, and then applies the migration, so
the backfill is proven against rows that already exist: the line takes the
invoice tax point, all 3 tables are forced again, and
`economic_event_line_account_date_idx` has replaced
`economic_event_line_account_idx`.
