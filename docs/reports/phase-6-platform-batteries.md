# Phase 6 Platform Batteries Report

## Delivered

The foundation now carries the commodity platform capabilities a product needs,
without introducing product or business logic and without weakening any existing
isolation guarantee.

- The application API adopted the reporting API pattern for database pool
  statistics, so both services and the new worker share one shape: the
  membership resolver exposes pool statistics, the metrics service reads them on
  scrape, and the readiness route records migration compatibility.
- Migration version expectations are derived rather than pinned. The operational
  proof compares the restored database against the live stack instead of a
  literal identifier, and the PostgreSQL integration test derives expected
  identifiers from the migration directory. The operational proof also runs on
  pull requests that touch migrations, Compose, container, or script paths.
- Container images collect workspace manifests with a single `COPY --parents`
  glob and copy the packages directory whole, so adding a workspace package
  needs no Dockerfile edit.
- The database and restore database run the digest-pinned pgvector build of
  PostgreSQL 18.6. The extension is created during role bootstrap, the only path
  that runs as the superuser, and an integration test proves `bap_api` can use
  the `vector` type.
- A non-internal `internet-egress` network carries outbound traffic for the web
  service and the worker only. The Compose contract check enforces the member
  allowlist, the non-internal flag, the explicit exclusion of both APIs, and the
  attachment and gateway priorities that decide the default route.
- pg-boss provides the queue and the scheduler inside PostgreSQL. Its schema is
  pinned in a checksummed migration generated from the pg-boss construction
  plans, with least-privilege grants for `bap_api` and read-only grants for
  `bap_backup`.
- The worker is a second entrypoint in the application API image. It connects as
  `bap_api`, serves health, readiness, and metrics on its own internal port, and
  runs every job through a gate that validates the payload, re-resolves
  membership, and only then opens a short tenant transaction.
- A Resend-backed mail module reads its key from a mounted credential file and
  falls back to a log-only transport when no key is configured.
- One provider-agnostic `ai_provider_config` credential file is mounted into the
  web service and the worker, so changing model provider changes secret content
  rather than deployment topology.
- The Compose contract check gained a production privilege-boundary assertion
  covering every application service: read-only root filesystem, all
  capabilities dropped, no new privileges, a restart policy, and ephemeral
  writable storage.

## Decisions

The full set is recorded in
[ADR 0004](../adr/0004-controlled-internet-egress.md) and
[ADR 0005](../adr/0005-platform-batteries.md), with the dependency comparisons
in [tool decisions](../tooling/tool-decisions.md).

Two constraints shaped the implementation more than anything else. First,
`bap_api` holds no `CREATE` privilege anywhere, so pg-boss runs with
self-migration, schema creation, and queue statistics persistence disabled, and
queues are never partitioned; those are the only pg-boss code paths that issue
DDL at runtime. Second, attachment order alone does not decide a container's
default route, so every egress member declares both an attachment priority and a
gateway priority, and the container smoke job proves outbound reachability from
inside the web container.

PDF export was rejected rather than deferred quietly: rendering it in-process
needs a headless browser sandbox that a read-only container with all
capabilities dropped cannot provide. Exports stay streaming CSV and XLSX.

## Verification

- `pnpm check`: formatting, linting, type checking, unit tests, and builds.
- `pnpm test:integration`: role separation, idempotent migrations, tenant
  isolation, backup-role dump access, pgvector availability, and the worker
  queue boundary, including a job confined to its payload's organization, a
  rejected cross-tenant write, an aborted job for revoked membership, and
  refused object creation in the `pgboss` schema.
- `pnpm compose:verify`: development, production, operations, and bootstrap
  contracts.
- Local stack proof: every service reports healthy including the worker; the
  worker readiness, metrics, and outbound reachability were exercised directly,
  and Caddy still refuses the operational routes.
- Local backup, check, and restore drill: the restored database reports the same
  migration version as the live stack, and both the `pgboss` schema and the
  `vector` extension survive the round trip.

## Not delivered

No product schema, ingestion pipeline, AI package, chat surface, or user
interface. No queue handler is registered yet; the worker supervises pg-boss and
Phase 2 adds the first job. Mail is not wired into Better Auth until Phase 1.
The AI credential file is mounted but not yet parsed, because its schema belongs
to `@bap/ai` in Phase 3.
