# Tenant Data Foundation Plan

This plan covers the generic tenant data layer that has to exist before any
analytics behavior. It specifies the phase 2 migration and the ingestion path
that fills it. It inherits the decisions in
[ADR 0005](../adr/0005-platform-batteries.md) and continues
[the platform batteries plan](platform-batteries.md) and
[the SaaS foundation plan](saas-foundation.md).

The layer is deliberately domain-free. A dataset here is a tabular container
with named columns and numbered rows. It carries no business meaning, no entity
model, and no seeded content.

## Goal

Give every organization a place to put tabular data that the platform can
ingest, isolate, list, and search, without introducing a single business-domain
table and without weakening any isolation guarantee the foundation already
proves.

## Scope

1. Add `app.dataset`, `app.dataset_column`, `app.dataset_row`, and `app.upload`
   in one reviewed migration.
2. Apply the tenant policy contract to every new tenant table.
3. Extend row visibility from tenant-wide to per user, using the
   `app.data_grants` table delivered in phase 1.
4. Add PostgreSQL-native full-text search over dataset name and description.
5. Specify the ingestion path: web BFF, application API, pg-boss job, worker
   parse, batched insert, audit entry, status update.
6. Fix which phase owns the `vector` columns, so two branches never add a
   migration at the same time.
7. Grant the new tables to the roles that need them, including the reporting
   read path and the backup dump.

## Constraints that shaped the design

- Tenant context is transaction-local. `withTenantContext` in
  [`packages/db/src/tenant.ts`](../../packages/db/src/tenant.ts) sets
  `bap.organization_id` and `bap.user_id` with the local flag inside one
  transaction, so context cannot survive a commit on a pooled connection. Every
  read and write of a tenant table happens inside such a transaction, and
  missing context fails closed.
- `pgboss.job` has no row level security and is cross-tenant readable by
  `bap_api`, so job payloads carry identifiers only. A filename or a parsed
  value in a payload would be a cross-tenant read primitive.
- `bap_api` holds no `CREATE` privilege anywhere, so nothing in the ingestion
  path may create a table, a partition, or a schema object at runtime. That
  rules out per-dataset physical tables and per-upload staging tables.
- Only one branch at a time may add a migration file. Two branches that pick the
  same id merge cleanly in git and then break at runtime, because the runner
  applies the first file, records that id, and treats the second as already
  applied.
- Production containers run read-only with all capabilities dropped. The
  worker's only writable path is the `tmpfs` mounted at `/tmp`, which is
  memory-backed, so any file it buffers is resident memory. Upload size limits
  are a correctness concern here, not a courtesy.
- Every new table must be readable by `bap_backup`, or the whole-database dump
  in the backup drill fails.
- pgvector is excluded from the dump on purpose and role bootstrap installs the
  extension on the restore database, so a `vector` column is neutral for
  [backup and restore](../backup-and-restore.md) whichever phase adds it.

## Schema

All four tables live in the existing `app` schema and are created in one
migration.

`app.dataset` is the container: `id`, `organization_id`, `name`, `description`,
`status`, `created_by`, `created_at`, `updated_at`. `created_by` holds the
Better Auth subject id, which is the same value as `app.data_grants.user_id` and
the `bap.user_id` transaction setting. `status` tracks ingestion progress, so a
dataset is never read as complete while rows are still arriving. This document
names the vocabulary `importing`, `ready`, and `failed`.

`app.dataset_column` describes the shape: `dataset_id`, `name`, `position`,
`inferred_type`. `position` preserves source column order. `inferred_type` is a
parse and display hint recorded by the parser, drawn from `text`, `number`,
`boolean`, and `timestamp`. Storage stays JSONB, so the hint is a description of
what the parser saw and not a guarantee about any individual value.

`app.dataset_row` holds the data: `dataset_id`, `organization_id`, `row_number`,
and `data jsonb`. `row_number` is the position of the row in its source, kept
for stable ordering and for pointing at a bad row in an error message. It is not
a surrogate key. `organization_id` is denormalized onto the row rather than
derived through `dataset_id`, because the tenant policy has to be an
index-backed equality test on the row itself. A policy that joined back to
`app.dataset` would run per row.

`app.upload` is metadata only: `organization_id`, `dataset_id`, `filename`,
`byte_size`, `status`, `error`. `dataset_id` is nullable because the dataset
does not exist until parsing has determined its columns. `status` is `pending`,
`processing`, `completed`, or `failed`. `error` holds a bounded diagnostic
message and never file content. The raw bytes are not a column and are not in
object storage: they transit the worker's local temporary area, are parsed, and
are deleted. S3 stays deferred, because adding it would introduce a new
credential contract, a new egress path, and an object lifecycle policy, and this
phase needs none of the three.

## Row storage and DuckDB

JSONB rows to start. One physical shape serves every dataset, no runtime DDL is
needed, and a value predicate can be indexed with GIN if one ever appears. The
cost is per-row key storage and per-value casting at read time, which is
acceptable while no query profile exists to argue against it.

Columnar optimisation waits for measurement. DuckDB is noted as a possible
future option and is explicitly not adopted now: it would put tenant data in a
second engine and a second storage format outside PostgreSQL row level security,
so isolation would have to be re-implemented in application code and the backup
drill would have to cover a second artifact. Revisit with its own ADR, and only
against a measured query profile.

## Tenant and visibility contract

Every new tenant table follows the tenant policy contract in
[database isolation](../database-isolation.md): a non-null `organization_id`, an
index beginning with `organization_id`, `ENABLE ROW LEVEL SECURITY` and
`FORCE ROW LEVEL SECURITY`, a `USING` policy for reads and changes, and a
matching `WITH CHECK` policy for inserted or changed rows. Both compare against
`current_setting('bap.organization_id', true)`, which is null outside a tenant
transaction, so missing context returns nothing and rejects every write.

Tenant isolation alone is not sufficient here. Datasets are per user by default,
so `app.dataset` and `app.dataset_row` carry a second condition on top of the
tenant test: the current subject either created the dataset or holds a matching
row in `app.data_grants` with `resource_type = 'dataset'` and a `resource_id`
equal to the dataset id. `app.data_grants.resource_id` is `text` while dataset
ids are `uuid`, so the policy compares the cast form.

The creator test reads `current_setting('bap.user_id', true)`, which
`withTenantContext` sets in the same statement as the organization. Both service
roles that read datasets must therefore open a full tenant context and not an
organization-only one. `app.data_grants` is itself tenant-scoped and forced, so
the grant lookup inside the policy is already confined to the same organization
and cannot be widened by the policy that reads it.

`app.data_grants` is polymorphic by design and carries no foreign key to
`app.dataset`. That was deliberate in
[the phase 1 migration](../../packages/db/drizzle/20260830.0003_data_grants_and_audit.sql),
so authorization did not depend on phase 2 schema. The cost lands here: deleting
a dataset does not remove its grants, and the deletion path owns that cleanup.

## Full-text search

Dataset discovery is PostgreSQL-native. `app.dataset` carries a generated
`tsvector` column over name and description, with a GIN index on it. There is no
search service, no external index, and nothing that can fall out of sync with a
transaction.

A stored generated column requires an immutable expression, which has two
consequences the migration must respect. The text search configuration is a
literal, so it cannot follow a runtime locale, and whichever configuration is
chosen is frozen into stored data; changing it later is a migration and a
rewrite. `description` is nullable, so the expression coalesces before
concatenating, or the whole vector is null for every dataset that has no
description.

Use the `simple` configuration. Dataset names are user-supplied labels rather
than prose, and stemming them under one language would be a guess about content
this phase deliberately knows nothing about.

## Embedding columns

`vector` columns belong in exactly one migration, either this phase's or phase
3's, never both. This is not a style preference. Only one branch at a time may
add a migration file, so a column added on both sides produces two files that
merge cleanly and then break the runner.

The recommendation is phase 3. Phase 2 has no writer and no reader for an
embedding, so adding the column now ships dead schema. More importantly `vector`
is dimensioned, and the dimension is decided by the model named in the
`ai_provider_config` credential that phase 3 selects; committing to a number
first risks a column type change and a table rewrite on populated data. The
index choice has the same problem, because HNSW and IVFFlat parameters can only
be tuned against real vectors. Adding a nullable column later is a metadata-only
operation in PostgreSQL, so deferring costs almost nothing while guessing early
costs a rewrite. Backup is neutral either way, since the dump excludes the
extension and role bootstrap installs it on the restore database.

## Ingestion contract

1. The browser posts the file to a BFF route in `apps/web`. The BFF verifies the
   opaque Better Auth session, mints one in-memory five-minute Ed25519 resource
   JWT, calls one compile-time application API URL, and returns an allow-listed
   response. The browser never receives a resource JWT and never reaches the API
   directly.
2. The application API verifies the token, resolves membership for the named
   organization, and opens `withTenantContext`. Inside that transaction it
   inserts one `app.upload` row with status `received`, records an audit entry
   through `app.record_audit`, and commits. Metadata only.
3. The API enqueues one pg-boss job. The payload carries the organization id,
   the subject id, and the upload id, and nothing else. Not the filename, not a
   byte, not a parsed value, because `pgboss.job` has no row level security and
   `bap_api` can read every tenant's jobs.
4. The worker dequeues, validates the payload with zod, and re-resolves
   membership before touching data. Revoked membership aborts the job. This is
   the existing worker gate, not a new mechanism.
5. The worker stream-parses the file from its local temporary area. It never
   loads the whole file into memory and never holds a database transaction open
   across the parse.
6. Column discovery comes first. In one short tenant transaction the worker
   inserts `app.dataset` with status `importing` and its `app.dataset_column`
   rows, then links the dataset to the upload and sets the upload to `parsing`.
7. Rows are inserted in batches, each batch in its own short `withTenantContext`
   transaction. Batching is forced by the context contract rather than chosen
   for throughput: transaction-local context cannot outlive its transaction, and
   one transaction spanning a large file would pin a pooled connection, hold an
   old snapshot against vacuum, and lose all work on a single bad row.
8. Because rows arrive in batches, a dataset exists before it is complete.
   `app.dataset.status` is the gate. Readers treat anything short of `ready` as
   not yet readable, and the ingestion path is the only writer of that column.
9. On success the worker sets the dataset to `ready`, the upload to `completed`,
   and records an audit entry. On failure it sets the upload to `failed` with a
   bounded `error` message, marks any created dataset `failed`, and records an
   audit entry. Attribution is never passed as an argument: `app.record_audit`
   takes no organization or subject parameter and derives both from
   `current_setting`, so the worker must already be in the right tenant context
   for the entry to be accurate.
10. The temporary file is deleted on every exit path, success or failure.
    Nothing retains the raw bytes after the job ends.

A retried job re-runs from step 5, so the ingestion path must not double-insert.
The rule is that a retry discards the partially built dataset and starts over.
That is cheap while status is `importing` and it is the only option that does
not depend on a uniqueness constraint the specified schema does not have.

## Upload size limits

[`infrastructure/caddy/Caddyfile`](../../infrastructure/caddy/Caddyfile)
currently sets no `request_body` limit, so a body of any size is proxied into
the web service. That is acceptable while no route accepts a file and
unacceptable the moment one does.

The limit belongs at the edge for three reasons. Caddy is the only public
service, so it is the one place that can refuse a body before any application
process allocates for it, and a request rejected there costs a status code and
nothing else. The web service and the API would otherwise buffer or stream a
body they are contractually going to reject anyway. And the worker's writable
area in production is a memory-backed `tmpfs`, so an oversized file becomes
resident memory in a container that is not even the one that accepted the
request.

Edge enforcement is infrastructure configuration and can drift, so it is a first
line and not the only one. The API validates `byte_size` at its own boundary,
which is where this codebase validates user input, and the ingestion job fails
closed when the parsed size disagrees with the recorded one.

## Grants

No new schema is created, so the existing `USAGE` grants on `app` are enough.
Every identifier is a `uuid` defaulted by `gen_random_uuid()`, and `row_number`
and `position` are supplied by the parser, so the migration adds no sequence and
needs no sequence grant.

- `bap_api` receives `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on all four
  tables. It is the only writer, and the worker runs as `bap_api` as well.
- `bap_reporting` receives `SELECT` on `app.dataset`, `app.dataset_column`, and
  `app.dataset_row`. It is not granted `app.upload`, which is operational
  ingestion metadata with no reporting consumer.
- `bap_backup` receives `SELECT` on all four tables, so the whole-database dump
  keeps working. Default privileges under `bap_owner` already cover this, and
  the migration states the grants anyway, matching the phase 1 migration, so the
  backup drill does not depend on them.
- `bap_auth` receives nothing.

Both service roles read these tables only inside a full tenant context, because
the visibility policy tests `bap.user_id` as well as `bap.organization_id`.

## Migration lane

This phase adds exactly one migration file, taking the next free id after
`20260830.0003_data_grants_and_audit.sql`. `DATABASE_MIGRATION_COMPATIBILITY` in
[`packages/db/src/access.ts`](../../packages/db/src/access.ts) is bumped to that
id in the same pull request. Rolling application code back after the migration
is applied leaves the constant behind the database, and `/ready` returns 503 on
every service until it is bumped again.

While that file is open, no other branch may add a migration. That is the whole
reason the `vector` columns need a decision rather than a preference.

## Verification

- `pnpm check` proves the code around the migration: zod validation of the job
  payload at dequeue, parser behavior including malformed input, the BFF
  response boundary, and that the workspace still formats, lints, type checks,
  and builds.
- `pnpm test:integration` proves the database properties. Per new table, that
  row level security is enabled and forced, that both policies exist, that a
  query without tenant context returns nothing, and that a write naming another
  organization is rejected. For visibility, that a creator sees their dataset
  and its rows, that a second member of the same organization does not, and that
  the same member does once a matching `app.data_grants` row exists. For grants,
  the exact privilege sets for `bap_api` and `bap_reporting`, and a full
  `pg_dump` as `bap_backup` with the four new tables present. For search, that
  the generated column is stored and the GIN index exists.
- The `@bap/api` half of the same command covers the queue boundary the
  ingestion job inherits: a non-partitioned queue, a job confined to the
  organization in its payload, a rejected cross-tenant write, an aborted job for
  revoked membership, and refused object creation in the `pgboss` schema.
- `pnpm compose:verify` proves the topology did not drift. If the file transfer
  question below is answered with a shared volume, that mount becomes a Compose
  contract assertion rather than an undocumented change.
- The operational proof covers backup, restore, and migration-version agreement
  with the new tables present, which is what catches a missing `bap_backup`
  grant.
- The migration compatibility constant is proved by `/ready`, which returns 503
  on every service until the constant matches the recorded version.

Details of each gate are in [testing](../testing.md).

## Out of scope

- Any business-domain entity. No customer, employee, company, transaction, or
  analytics table, and no sample rows of any kind.
- Analytics semantics: aggregation, metric definitions, derived or transformed
  datasets, and joins between datasets.
- Embeddings, semantic search, chat, and model calls, which belong to phase 3.
- The dataset, sharing, and grant management screens. This phase specifies
  enforcement, not user interface.
- Row exports, dataset versioning, row-level editing, and soft delete.
- Columnar storage, object storage, quotas, and billing.

## Resolved decisions

The questions this plan raised are decided here so implementation has one answer
for each.

1. `app.dataset_column` carries no `organization_id`. A copy of the parent
   tenant would be a second source of truth that can drift. Its policy calls a
   `SECURITY INVOKER` function whose `SELECT` on `app.dataset` is itself
   filtered by that table's forced policy, so tenant scoping and per-user
   scoping are both inherited in one hop. `app.dataset_row` keeps its
   denormalized `organization_id` because the tenant predicate has to be
   indexable, and a composite foreign key to `UNIQUE (id, organization_id)` on
   `app.dataset` makes drift impossible.
2. The upload staging path is a named volume mounted into `api` and `worker`
   only. The plan's original wording assumed a worker-local temporary area the
   API could reach, which does not exist: the two services share no writable
   filesystem, and each production container has its own memory-backed `/tmp`.
   The staging file name is derived from the upload id and never from the
   uploaded filename, so an upload cannot steer a write outside the staging
   directory. See [ADR 0006](../adr/0006-upload-staging.md).
3. The visibility policy matches a grant on `resource_type` and `resource_id`
   and does not interpret `scope`. Scope is recorded for a later phase that
   needs to distinguish read from write sharing. A grant confers read visibility
   only; `WITH CHECK` still pins every write to the acting subject, so
   authorship cannot be transferred by granting.
4. Status and inferred type are enforced in both places. `status` carries a
   `CHECK` constraint on both tables, because an invalid state is a corruption
   the database should refuse. `inferred_type` deliberately does not, so the
   parser can learn a new label without a migration.
5. The edge body limit is 25 MB in the Caddyfile, and the API compares the
   received size against the same number rather than trusting the proxy.
6. `(dataset_id, row_number)` is unique, so a retried ingestion is idempotent.
   Dataset names are deliberately not unique per organization, because two
   uploads of the same file are a normal thing to do.
