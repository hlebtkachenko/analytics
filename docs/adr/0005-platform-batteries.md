# ADR 0005: Platform Batteries

- Status: accepted
- Date: 2026-08-30

## Context

The foundation delivered identity, tenant isolation, and a hardened deployment
topology, but none of the commodity capabilities a product needs: background
work, transactional mail, exports, and model access. Choosing each of those
separately and late would spread infrastructure decisions across feature work.
This decision fixes the whole set once, before the first product table exists.

The existing constraints are strict. `bap_api` holds no `CREATE` privilege
anywhere, every credential arrives as a mounted file, the application and data
networks are internal, and production containers run read-only with all Linux
capabilities dropped.

## Decision

Queue and scheduler: use pg-boss inside PostgreSQL. Its schema is pinned in a
checksummed migration generated from the pg-boss construction plans, and
self-migration is disabled, because a self-migrating client would bypass the
checksummed runner and needs privileges `bap_api` does not have. Queue
statistics persistence is disabled because it issues partition DDL at runtime.
Recurring work uses pg-boss cron. There is no Redis, no broker, and no second
scheduler.

Worker runtime: a second entrypoint in the application API image, running as
`bap_api`, which is `NOBYPASSRLS`. No new database role is introduced. The
worker cannot mint resource JWTs, reads tenant data only through
`withTenantContext`, and re-resolves membership at dequeue.

Transactional mail: use Resend, with the API key mounted as a credential file
and a log-only transport whenever no key is configured.

Model access: keep the provider choice out of the deployment topology. One
`ai_provider_config` JSON credential file carries provider name, key, base URL,
and model defaults, validated by zod inside `@bap/ai`. Adding or swapping a
provider changes the content of one secret, not the compose secret set.

Vector search: the database image is the digest-pinned pgvector build of
PostgreSQL 18.6, and the extension is created during role bootstrap, which is
the only path that runs as the superuser.

Exports: streaming CSV and XLSX only. PDF is explicitly deferred. Rendering PDF
in-process would require a headless Chromium inside a container that runs
read-only, with `cap_drop: ALL` and `no-new-privileges`, which the browser
sandbox cannot satisfy. Revisit with a dedicated ADR if PDF becomes a
requirement.

OpenTelemetry: deferred. Pino structured logs and Prometheus metrics stay the
observability surface.

Authorization libraries: CASL is rejected. The access contract in
`@bap/security` gains capability flags derived from the generic role, and the
database remains the enforcement layer.

## Consequences

The whole battery set lives in PostgreSQL and one process image, so the
operational surface does not grow: no broker to run, no search service, no cache
tier. Upgrading pg-boss becomes a migration with a compatibility bump rather
than an automatic schema change, which is deliberate friction.

The worker inherits row-level-security confinement for free, at the cost of a
strict payload rule: `pgboss.job` has no row level security and is cross-tenant
readable by `bap_api`, so payloads carry identifiers only.

Provider credentials stay uniform, so `@bap/ai` can stay provider-agnostic
without compose churn. The cost is one more parsing boundary, since the JSON
document must be validated before use.

Deferring PDF keeps the container hardening intact but means any future
print-quality output needs its own isolated service and its own decision.
