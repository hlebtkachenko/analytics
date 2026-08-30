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

## Dependency updates

Dependabot opens grouped weekly pull requests for the npm, GitHub Actions, and
Docker ecosystems, and CI audits the dependency tree on every push.

The npm updater runs real pnpm against this workspace, so it inherits
`strictPeerDependencies: true`. A bump whose peers the tree cannot satisfy
therefore fails the install rather than producing a tree that only looks
resolved, and the updater records it as `dependency_file_not_resolvable` and
skips that one dependency. Three catalog entries sit in that position today:
`eslint` and `@eslint/js`, because the plugins `eslint-config-next` brings in
still declare ESLint 9 peers, and `typescript`, because `typescript-eslint`
declares `>=4.8.4 <6.1.0`. Their major updates are ignored in
`.github/dependabot.yml`, so the job reports the tree honestly instead of
failing on an update that cannot land. TypeScript additionally ignores minor
updates, because `<6.1.0` is a minor boundary rather than a major one, so a 6.1
release would fail exactly the way a major would. That ignore covers version
updates only: patch releases, and every security update, still open pull
requests. Remove the entries once upstream widens those peer ranges.

The workspace `minimumReleaseAge` floor is not relaxed for automation.
Dependabot supplies its own cooldown of three days, which is longer than the
one-day workspace floor, and it bypasses that cooldown only for security
updates.

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

## Model provider boundary

Model calls are the one place where tenant-derived text deliberately leaves the
deployment. Only the web application and the worker can reach a provider at all,
because they are the only members of the `internet-egress` network.

What leaves is bounded. Dataset embedding and dataset summarization send dataset
metadata only: the name, the description, and column names. Neither reads
`app.dataset_row.data`, and a test asserts the summarization profile query never
selects that column, so no stored cell value reaches a provider. Chat sends what
the signed-in user typed, and, when the panel names the dataset it has open, the
same metadata only: the name, the description, and the column names with their
inferred types. It holds that line structurally. The route parses the row page
it reads into a column list alone, so the response body loses its rows before
anything assembles a prompt, and no stored cell has a path into the context. The
context is capped as well as filtered: at most 40 columns are listed, with the
remainder counted rather than named, and the name, the description, and every
column entry are clipped, so a dataset with hundreds of wide columns still
produces a prompt of a few thousand characters.

What is recorded is narrower still. Audit entries and metrics carry the model
id, token counts, and the outcome, never prompt or completion text, because
audit rows are readable by everyone in the organization.

When those calls happen is bounded too. A completed ingestion is the only
trigger: the worker chains `summarize_dataset` for the dataset it just made
ready, and that job in turn chains `backfill_dataset_embeddings` for the same
subject, so the embedded document quotes the description the summary wrote. When
no summary model is named, ingestion chains the backfill directly. Nothing else
enqueues either job, and neither runs on a schedule. Both chained payloads carry
identifiers only, and both jobs re-resolve membership at dequeue like every
other worker job.

An operator who treats dataset and column names as sensitive should enable the
embedding and summarization jobs deliberately rather than by default. Naming no
model for a role leaves that job off: the chain reads the credential first and
enqueues nothing for a role the credential does not name, so an absent or
placeholder credential produces no queued work at all rather than a failing job.

The chat route names an organization in its body and resolves membership through
the same helper the BFF access route uses, so a caller who is not a member of
that organization, and a member whose contract withholds `use_ai`, is refused
before the provider credential is read and before a model is called. That
capability is `true` for every role today, so the gate changes no behaviour yet.
It exists because the route registers no tools: the first tool that reaches
tenant data inherits an authorization boundary instead of needing one added
alongside it.

A named dataset is resolved at the same point, after membership and before the
credential. The route never queries the database. It calls the same BFF helpers
the dataset pages call, so each call mints its own resource credential and row
level security decides what the caller may see. A dataset that policy hides is
simply absent from the list the route reads, so naming one is refused with a
missing dataset rather than answered ungrounded, and the provider is never
reached at all.

A failed background job stores only a curated error name. `pgboss.job` has no
row level security and is readable across tenants by `bap_api`, while provider
errors carry the request body and database errors carry the offending row, so
the handler boundary replaces the error before pg-boss can serialize it.

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
