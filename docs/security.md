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

The separately selected development and CI overlay replaces external delivery
with Mailpit. Its cleartext unauthenticated SMTP listener remains on the Docker
`app` network with no host SMTP port. A non-root, read-only companion exposes
only GET `/readyz` and GET `/api/v1/search` on host loopback. Root, the UI, all
other API paths, and every non-GET method return 404. The companion drops every
capability, adds none, and runs the mounted config with Caddy's admin API and
automatic HTTPS disabled. The public Caddy configuration has no Mailpit route.
Mailpit itself runs non-root with a read-only filesystem and ephemeral storage.
The web transport accepts only exact `mailpit:1025`, disables file and URL
access, and applies small independent DNS, connection, greeting, and socket
timeouts as fail-fast settings. Verification through that sink is awaited at the
public auth request boundary; a failed delivery becomes a generic 503 even
though Better Auth catches the callback error. It never logs SMTP recipients,
bodies, links, tokens, or provider errors. Compose verification rejects the
overlay in bootstrap, production, and operations; production continues to use
non-blocking Resend delivery.

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
returned to browser code. The operational-proof synthetic-account CLI is
explicitly gated by `BAP_E2E_SETUP=true`; do not set that variable in a normal
runtime.

## Public sign-up boundary

Email/password sign-up is enabled at the framework endpoint but admitted by a
default-off runtime switch. A pending, unexpired organization invitation for a
case-insensitive address match bypasses the switch. Before parsing the body or
reading that policy, the Next.js route atomically consumes a 3-per-60-second
edge bucket. It accepts only a valid IP from Caddy's replaced `x-bap-client-ip`;
scoped IPv6, absent, and malformed values use one shared fallback bucket. IPv4
remains /32 and IPv6 is canonicalized to /64 before hashing. The edge namespace
is separate from Better Auth's limiter. A full bucket returns 429 with retry
metadata, caps its count, and performs no conflict update until its window
expires. Every consume prunes expired rows from only that edge namespace through
a partial `last_request` index. Unsupported media types and malformed JSON
consume an attempt and fail closed.

Caddy overwrites the header for public requests. Direct internal service access
can still supply a valid spoofed prefix, so network isolation remains part of
the trust boundary.

After the edge check, the Next.js route checks policy before framework dispatch,
and a Better Auth before-hook checks it again on exactly `/sign-up/email`. A
malformed request or any rate-limit, invitation, or setting read failure is
denied with `PUBLIC_SIGN_UP_DISABLED`; policy code uses query parameters and
never logs the submitted address.

The switch table is deliberately outside Better Auth's runtime authority. Tables
created in `auth` inherit SELECT, INSERT, UPDATE, and DELETE for `bap_auth`, so
the migration explicitly revokes that default grant on `auth.platform_setting`.
`bap_auth` can execute only the stable, security-definer
`auth.public_signup_enabled()` function, which returns false when the row is
absent. `bap_api` and `bap_reporting` can neither call the function nor read the
table. `bap_backup` keeps SELECT for complete dumps.

Only a host-shell operator with the migrator credential may run the database CLI
that reads or changes the switch. Writes use a transaction and
`SET LOCAL ROLE bap_owner`; no application endpoint can change admission policy.
The command emits JSON only, and failures use a generic code without database
details. Better Auth returns a complete synthetic user shape for duplicate
addresses, including Admin and Two Factor fields, so plugin fields do not weaken
its anti-enumeration response.

The operational proof uses only unique `example.test` identities and the public
Caddy path. It compares fresh and duplicate status, exact `Set-Cookie` headers,
and bodies after removing only generated identity ids and timestamps. It never
reads or prints a verification body, link, or token. Mailpit is queried by the
unique recipient, and only message ids are retained long enough to prove 1 fresh
delivery after the awaited fresh response. Immediate and final recipient-id
checks over a short Mailpit API-consistency window prove the duplicate and
fourth responses do not change their recipient sets; this is not an SMTP work
timeout. The proof also confirms the account remains unverified and sessionless,
attempt 4 in the same public client bucket is limited, and public sign-up is
restored OFF.

The `/sign-up` page reads the admission switch only in a Server Component and
fails closed to a state with no form. Client code receives only the resulting
boolean, never a database handle or setting-table access. Sign-up and recovery
callbacks are fixed relative paths. Fresh and duplicate sign-up responses, and
existing and nonexistent password-reset requests, collapse to identical visible
success states without consuming framework messages.

Reset and activation callbacks are canonicalized before any page render. The
proxy accepts exactly 1 reset token in Better Auth's installed shape, stores it
for at most 30 minutes in an `HttpOnly`, `SameSite=Lax`, `/reset-password`
cookie that is `Secure` in production, and redirects to the clean path. An
error, malformed token, or duplicate token clears the capability. A clean
request without a valid capability fails closed. Raw activation errors redirect
to the fixed `/activate?state=invalid` state. These responses and the clean
reset page use `Referrer-Policy: no-referrer`. Exact proxy matchers keep both
callbacks inside this boundary even when `Purpose: prefetch` or
`Next-Router-Prefetch` is present.

The reset Server Action reads the cookie directly and dispatches a `Request` to
Better Auth's in-process HTTP handler at a fixed `.invalid` URL. This invokes
the installed router limiter and hooks without network access. The action copies
only JSON content type and the Caddy-established client-IP header, never the
incoming Host, origin, or cookies. No reset token is passed through a client
prop, RSC value, action argument, form field, visible content, or log. It clears
the capability on success or terminal invalidity and reduces all framework
failures to one generic result. Activation error codes are never echoed, and
Better Auth failures are neither rendered nor logged. Session reads for
activation and welcome stay on the server and fail closed. Every visible auth
failure uses the same Carbon alert semantics.

## Organization creation boundary

Creation allowance is stored separately from membership in
`auth.organization_quota`, so joining another organization never consumes a
user's create quota. An absent row means zero. Although new tables in `auth`
normally inherit Better Auth DML, this table explicitly revokes all direct
`bap_auth` privileges and returns SELECT only. API and reporting roles receive
no access, and no `bap_auth`-executable quota writer exists.

Creator-attributed inserts are enforced inside PostgreSQL, not by an application
count followed by a write. A BEFORE trigger takes a transaction-scoped advisory
lock derived from the exact `created_by` user id, reads the grant, counts rows
with that creator, and rejects the insert at quota. The fixed-search-path
trigger function is invoker-rights and not directly executable by runtime roles.
A NULL creator is explicitly an unattributed legacy or system organization and
consumes no user's quota. The enabled Better Auth creation path declares
`createdBy` as `input: false`; its create hook validates the normalized slug and
injects the authenticated user id, so a client cannot forge attribution.

The web precheck counts rows with that creator against the SELECT-only quota
row. Better Auth interprets `organizationLimit` as "limit reached", and the
function returns `true` for exhausted quota. An absent row, invalid result, or
query failure also denies. This check is not atomic with insertion: concurrent
requests can both pass, and the PostgreSQL trigger remains authoritative. A
trigger-rejected race may return a generic server failure rather than 403.

The interactive bootstrap and gated operational synthetic-account command need
one initial grant. They validate the normalized slug before any user or quota
write, then use a distinct `bap_migrator` pool to raise only an absent or zero
row to 1 under `SET LOCAL ROLE bap_owner`. Existing positive grant provenance is
preserved, and the migrator pool closes before organization creation. Both
commands run in the profiled one-shot bootstrap service. That service alone has
the auth and migrator mounts together; long-lived web has no migrator path or
secret. Errors disclose no credential, provider, or database detail.

General quota changes use the existing one-shot `bap_migrator` service and the
database CLI's exact `organization-quota --email --total --note` arguments. The
accessor starts 1 transaction, sets `bap_owner` locally, resolves the subject
with a parameterized email, and upserts the total with a required provenance
note. It records `granted_by` as NULL because the host operator is not an auth
identity. Success is the resulting row as JSON; all failures are 1 generic JSON
code. No web process, HTTP endpoint, or `bap_auth`-executable function can write
quota.

Slugs are constrained identically in TypeScript and PostgreSQL: 3 through 20
lowercase ASCII letters or digits with single internal hyphens, not all digits,
and not any of the 16 literal route reservations. Migration `20260831.0004`
checks for an existing `organizations` collision before it replaces the stable
named CHECK; any collision aborts the migration. New member and invitation
writes accept only scalar `owner`, `admin`, or `member`. Historical invalid role
values are denied as no membership rather than throwing.

Organization creation explicitly makes the creator an `owner` and caps
membership at 100. The auth before-hook requires `organizationId` on the 10
installed 1.7.2 fallback endpoints that can bind it. The eleventh,
`get-active-member`, has no id input and is rejected unconditionally by the hook
and disabled at the public router. The source inventory is larger than the
plan's earlier count of 8. Better Auth creation and invitation acceptance may
update stored `activeOrganizationId`, but no supported BAP operation consumes
that state as an implicit selector. Public `/organization/set-active` is
disabled, and `/organization/delete` is disabled because auth-only deletion
would strand cross-schema data. With the sole-owner account deletion guard, this
means a sole owner cannot delete either object until ownership is delegated. A
later operator purge workflow must solve that gap.

## Organization routing boundary

The mutable organization slug is a web routing key, never a service
authorization key. The `[orgSlug]` layout validates it before session or
database work. A verified session then reaches a single parameterized join of
`auth.organization` and `auth.member` through the existing `bap_auth` pool,
keyed by the slug and exact session user id. The query returns a route only when
the membership exists and its role parses as an approved scalar value.

Malformed, unknown, unauthenticated, unverified, nonmember, invalid-role, and
lookup-error states share one 404 response. This avoids an organization
existence oracle. React `cache` covers the entire operation inside one server
request; no mutable slug-to-id result crosses request boundaries. Better Auth's
ambient `activeOrganizationId` is not consulted even though creation and
invitation acceptance may update it.

The web BFF and both services remain id-only. A slug-shaped selector can satisfy
the BFF syntax check, but `auth.resolve_membership(subject_id, organization_id)`
finds no row and the service returns 403. Adding a literal top-level web route
must add the matching reserved slug in the same pull request so a future route
cannot silently shadow an existing organization URL.

## Temporary organization action boundary

Phase 10's 5 organization pages are deliberately plain and temporary, but their
server actions are untrusted public POST boundaries. They rederive the verified
session and member-gated organization resolution, validate `FormData`, ignore
any browser-supplied organization id, and call only installed Better Auth APIs
with the exact resolved id. Creation keeps the stored active organization
unchanged. Each scoped action validates its bound slug before constructing any
path or calling the resolver or provider. Malformed, protocol-relative-looking,
and encoded-looking values reach only `/organizations?result=error` with no side
effect. Valid scoped redirects use only the parsed or durable resolved slug;
provider and database failures become generic messages and are not logged.

The UI mirrors installed Better Auth permissions: owners may assign all three
roles and manage owner targets, while admins may assign only `admin` or `member`
and receive no change or removal controls for owner targets. Members are
read-only. Better Auth remains authoritative. Role and removal actions reread up
to the configured 100-member limit and refuse a final-owner change in the
temporary UI. That read followed by mutation is not atomic and does not repair
Better Auth 1.7.2's direct endpoint gaps: its last-owner role check applies only
to self-demotion and its removal check is bounded by `membershipLimit`. The
approved plan leaves a global, race-safe solution as follow-up work.

## Account erasure boundary

Account deletion uses Better Auth's hard-delete path with a 5-minute fresh
session window. That endpoint can accept a sufficiently fresh session without a
password, so it is not treated as password-protected; the BAP account form still
always supplies the current password. The `beforeDelete` hook fails closed on
database errors and blocks only users who are the sole owner of at least 1
organization. Owner checks use exact comma-separated tokens for both the subject
and possible co-owners, matching Better Auth's composed roles without substring
matching.

Installed Better Auth 1.7.2 implements `/admin/remove-user` as a direct delete
that does not call `user.deleteUser.beforeDelete`. BAP has no consumer, so both
the auth configuration and public route gate disable that path. The same gates
disable `/admin/impersonate-user` and `/admin/stop-impersonating`, because BAP
has no approved impersonation workflow. No global hook reproduces Admin-plugin
permission logic.

The hook records the explicit session user id in a pending-only auth-schema
request before the framework deletes the identity. The request table revokes
Better Auth's inherited table grants and exposes only a fixed-search-path
security-definer recorder to `bap_auth`. Because Better Auth 1.7.2 does not make
the hook and identity deletes 1 transaction, a failed delete can leave a stale
request. The operator command makes that state safe by refusing any id that
still exists in `auth.user`.

Only the one-shot migrator tier can process the request. It locks exactly the
named row, verifies identity absence as owner, sets the non-login `bap_eraser`
role for an invoker-rights app function, returns to owner, consumes the request,
and commits atomically. `bap_eraser` has BYPASSRLS but no password, CONNECT, or
inherited membership. Its app privileges are limited to schema usage, function
execution, and SELECT/UPDATE on the 3 subject columns. `bap_auth` retains no
app-schema access, and `bap_api` cannot execute erasure or UPDATE the audit log.
There is no blind orphan sweep.

The function generates 1 opaque `erased_<uuid>` only when a matching row exists,
never derives it from the user id, and applies it to audit attribution, data
grants, and dataset creators. A repeat leaves stored state unchanged. Retained
or granted datasets can remain readable after `dataset.created_by` is
tombstoned, but `dataset_is_writable` no longer recognizes a live creator. They
remain unwritable until later ownership or delegation work.
`app.audit_log.metadata` is deliberately not rewritten and can retain user ids.
Identifiers can also remain in `auth.rate_limit`, `auth.verification`, and
pg-boss job payloads. Access and portability are not implemented. This is a
narrow erasure mechanism, not a claim of complete GDPR compliance.

## Admin HTTP boundary

The installed Better Auth 1.7.2 Admin plugin registers 15 HTTP endpoints. BAP
has no admin UI or HTTP consumer. User removal and both impersonation endpoints
are disabled in Better Auth and at the public catch-all before dispatch;
trailing-slash variants are rejected too. The remaining 12 endpoints retain
Better Auth's authoritative-session checks and each route's installed
role-permission checks where defined. All 8 reachable mutations are explicitly
limited to 3 attempts per 60 seconds, while read-only routes and disabled
mutations add no custom rule. Other framework built-ins remain active.

The Admin plugin is configured without `adminUserIds`; no id can short-circuit
its role permissions. The disabled-path setting applies to HTTP routing only and
does not remove server-side `auth.api` calls. In Better Auth 1.7.2,
`auth.api.createUser` skips its session and permission checks only when invoked
without request or headers. The interactive owner bootstrap and gated synthetic
account operational-proof CLI intentionally use that trusted server-only form.
Public HTTP always supplies request context and therefore cannot use the bypass.

Do not publish a vulnerability report containing secrets or personal data. Use
GitHub's enabled private vulnerability reporting channel.
