# Platform Batteries Plan

This plan covers the platform foundation that has to exist before any product
table. It is the specification behind
[ADR 0005](../adr/0005-platform-batteries.md) and
[ADR 0004](../adr/0004-controlled-internet-egress.md).

## Goal

Turn the delivered SaaS foundation into a platform that can run background work,
send mail, reach model providers, and store vectors, without weakening the
existing isolation guarantees.

## Scope

1. Align the application API with the reporting API so a worker copies one shape
   for pool statistics and readiness metrics.
2. Remove hardcoded migration ids from the operational proof and the PostgreSQL
   integration test, and document the migration lane rule.
3. Collapse the duplicated workspace manifest copies in the container images so
   adding a workspace package needs no Dockerfile edit.
4. Move the database to the digest-pinned pgvector build of PostgreSQL 18.6 and
   create the extension during role bootstrap.
5. Add a least-privilege `internet-egress` network with an enforced member
   allowlist.
6. Add the pg-boss queue, its pinned schema migration, and the worker service.
7. Add the Resend mail module.
8. Add the provider-agnostic AI credential file.
9. Synchronize the documentation set.

## Constraints that shaped the design

- `bap_api` has no `CREATE` privilege anywhere, so pg-boss must never issue DDL
  at runtime. That rules out self-migration, partitioned queues, and persisted
  queue statistics.
- Migration ids collide cleanly in git and break at runtime, so only one branch
  at a time may add a migration file.
- Every new schema must grant `USAGE` and `SELECT` to `bap_backup`, or the
  whole-database dump in the backup drill fails.
- Every credential arrives as a mounted file validated for regular-file status
  and mode `0400`, `0444`, or `0600`. No credential is read from a plain
  environment variable.
- Production containers are read-only with all capabilities dropped, which is
  why PDF rendering is out of scope.

## Queue contract

Jobs are enqueued and worked through pg-boss with `migrate: false`,
`createSchema: false`, `persistQueueStats: false`, and non-partitioned queues.

Payloads carry identifiers only: organization id, user id, and resource ids.
They never carry personal data, file contents, or secrets, because `pgboss.job`
has no row level security and is cross-tenant readable by `bap_api`.

At dequeue the worker validates the payload with zod, re-resolves membership,
and only then opens a short tenant transaction. Revoked membership aborts the
job. Model and network calls happen outside the transaction.

## Verification

- `pnpm check` for format, lint, types, unit tests, and builds.
- `pnpm test:integration` for roles, migrations, row level security, and the
  queue confinement proof.
- `pnpm compose:verify` for all four topology modes.
- The container smoke job for stack startup, blocked operational routes, and
  outbound reachability from the web container.
- The operational proof for backup, restore, and migration-version agreement.

## Out of scope

Product tables, ingestion, the AI package itself, chat streaming, and the
vertical slice UI. Those follow in their own phases and depend on this one.
