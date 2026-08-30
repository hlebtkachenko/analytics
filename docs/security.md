# Security Baseline

This repository is public. Source, tests, documentation, issues, and build
artifacts must contain no real personal, customer, company, financial,
credential, or analytics data.

## Repository rules

- Commit only synthetic, clearly non-production examples.
- Keep environment files, credentials, certificates, keys, dumps, exports, local
  databases, logs, and test artifacts ignored.
- Never copy environment files into container build contexts.
- Keep PostgreSQL off the public edge and on the internal data network.
- Run applications as non-root container users with dropped capabilities.
- Pin toolchain and container patch versions.
- Validate external input at its first trusted boundary.
- Do not enable wildcard production CORS.

CI runs focused formatting, lint, type, test, build, secret, dependency, and
static-analysis checks. The scheduled operational proof adds a disposable
browser and backup/restore exercise. Automated scans do not replace manual
review of configuration, workflows, fixtures, container files, and generated
artifacts before every push.

The one-shot operations image has one narrow exception: its fixed entry wrapper
starts as root with only `CHOWN`, `DAC_READ_SEARCH`, `SETGID`, and `SETUID` so
it can stage host-owned mode `0600` Compose secrets into a protected tmpfs. It
then drops to UID/GID `999:999`; the backup backend refuses to run unless its
effective capability mask is zero. Password values are never placed in process
environments.

## Runtime boundary

Caddy is the sole public entry point. It blocks `/ready` and `/metrics` before
proxying, replaces the dedicated client-IP header, and forwards only intended
application traffic. The web service, both APIs, and PostgreSQL communicate on
internal Compose networks. Health is intentionally public; readiness and
Prometheus metrics are operational-only routes.

Outbound access is a separate boundary. Only services on the non-internal
`internet-egress` network can reach external providers, and its member allowlist
is exactly the web service, which owns mail and AI provider calls, and the
worker, which runs background jobs against the same providers. The application
API, the reporting API, and PostgreSQL stay internal-only and have no outbound
path. `scripts/verify-compose.mjs` fails when any other service joins that
network, and the container smoke job proves the web service still resolves and
connects outward.

## Background worker boundary

The worker is a second entrypoint in the application API image and connects as
`bap_api`, which is `NOBYPASSRLS`, so row level security confines it exactly as
it confines the API. It holds no new database role and cannot mint resource
JWTs, because the signing key is readable only by `bap_auth`; it reaches tenant
data directly through `withTenantContext` and calls no other service.

`pgboss.job` has no row level security and is cross-tenant readable by
`bap_api`, so job payloads carry identifiers only: an organization id, a user
id, and resource ids. Payloads never carry personal data, file contents, or
secrets.

At dequeue the worker validates the payload with zod, re-resolves membership
through `resolveMembership`, and only then opens a short tenant transaction.
Revoked membership aborts the job. Model, provider, and network calls happen
outside the transaction, never while it is open.

pg-boss runs with self-migration disabled. Its schema is owned by the
checksummed migration runner, `bap_api` holds no `CREATE` privilege anywhere,
and queue statistics persistence is off because it would otherwise issue
partition DDL at runtime. Recurring work uses pg-boss cron; there is no second
scheduler.

Better Auth uses opaque secure cookies for browser identity. Resource JWTs are
signed only inside the server-side BFF, expire after five minutes, and are never
returned to browser code. The test-only synthetic-account CLI is explicitly
gated by `BAP_E2E_SETUP=true`; do not set that variable in a normal runtime.

Do not publish a vulnerability report containing secrets or personal data. Use
GitHub's enabled private vulnerability reporting channel.
