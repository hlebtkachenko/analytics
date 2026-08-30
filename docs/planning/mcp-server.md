# MCP Server Plan

This plan specifies a Model Context Protocol server for BAP, so an external AI
client can reach the tenant data the product already exposes without a second
authorization system behind it.

It is a design document. No code, dependency, migration, or Compose change is
part of it. Implementation is a separate change, and this plan is the thing that
change has to satisfy. It inherits
[the platform batteries plan](platform-batteries.md),
[the tenant data foundation plan](tenant-data-foundation.md), and the boundaries
already stated in [security](../security.md) and
[authentication and organization access](../authentication.md).

## Goal

Let an MCP client outside the deployment call a bounded set of tools against one
organization's data, without adding a second authorization system, a second
scheduler, a second database role, or a second path into the tenant tables.

## Scope

1. Choose the transport, and say what it costs a deployment that has exactly one
   public surface.
2. Specify identity for external clients as Better Auth API keys, and say why
   resource JWTs are the wrong credential.
3. State the topology question plainly and hand it to its own ADR.
4. Specify the tool surface as a mirror of the `@bap/ai` typed tool registry.
5. State the invariants an implementation must not break.
6. State what an implementation has to prove before it can merge.

## Constraints that shaped the design

- Caddy proxies exactly one upstream. `web:3000` is the only `reverse_proxy`
  target in
  [`infrastructure/caddy/Caddyfile`](../../infrastructure/caddy/Caddyfile), and
  [`scripts/verify-compose.mjs`](../../scripts/verify-compose.mjs) asserts that
  Caddy joins exactly the `app` and `edge` networks. A new public surface
  therefore fails the contract check by name until the same change amends it.
- Resource JWTs are minted only inside the server-side BFF in
  [`apps/web/src/lib/auth/bff.ts`](../../apps/web/src/lib/auth/bff.ts), one per
  outbound call, held in memory, never returned to a browser. `/api/auth/token`
  is permanently disabled in
  [`apps/web/src/lib/auth/contract.ts`](../../apps/web/src/lib/auth/contract.ts)
  so no caller can ask for one.
- The signing key lives in `auth.jwks` and only `bap_auth` is granted DML on the
  `auth` schema. Any runtime that holds a `bap_auth` login can mint resource
  JWTs, which is why the worker deliberately does not hold one.
- `bap_api` holds `USAGE` on `auth` and `EXECUTE` on `auth.resolve_membership`
  and nothing else, per
  [the phase 1 migration](../../packages/db/drizzle/20260828.0001_auth_and_roles.sql).
  No service other than web can read a stored credential in that schema.
- Tenant context is transaction-local. `withTenantContext` in
  [`packages/db/src/tenant.ts`](../../packages/db/src/tenant.ts) sets
  `bap.organization_id` and `bap.user_id` with the local flag inside one
  transaction, so context cannot survive a commit on a pooled connection.
  Missing context fails closed.
- `bap_api` holds no `CREATE` privilege anywhere, so nothing on an MCP request
  path may create a table, a partition, or a schema object at runtime.
- Only one branch at a time may add a migration file, so the API key table
  competes for the same lane as every other schema change.
- Every credential arrives as a mounted file validated for regular-file status
  and mode `0400`, `0444`, or `0600`. No credential is read from a plain
  environment variable.
- Production containers are read-only with all capabilities dropped, and the
  only writable path is a memory-backed `tmpfs`. There is no local disk and no
  shared store for session state.
- The pinned `better-auth` version in `pnpm-workspace.yaml` exports no API key
  plugin. That plugin moved into its own package, so adopting it is a catalog
  and lockfile change plus a reviewed migration for its table, not a
  configuration flag. See the open questions.

## Transport

Streamable HTTP, through the official Model Context Protocol TypeScript SDK.

It is the transport current MCP clients target for a remote server. The
alternatives do not fit this deployment. A stdio server has to run as a local
child process on the client's machine, which means shipping and updating a
binary rather than serving an endpoint. The older HTTP and SSE pair is
superseded and needs two coordinated routes instead of one.

Streamable HTTP is one endpoint. A client POSTs a JSON-RPC message and the
server answers with either a JSON body or a stream on the same route. That maps
onto the ingress this deployment already has: one HTTPS listener, one reverse
proxy, one upstream. The streaming half is already proven in production shape,
because the chat route in `apps/web` returns a streamed response through the
same proxy today.

Run the server without server-side session state. Session state would need
somewhere to live, and there is nowhere: production containers are read-only
with a memory-backed `/tmp`, and nothing is shared between replicas. A stateless
server treats each request as complete on its own, which is the property the BFF
already has. If a later feature genuinely needs resumable streams, that is a
state store decision and gets its own change.

The SDK ships the transport in two shapes. One is built on the Web `Request` and
`Response` types, which is exactly what a Next.js App Router route handler
already receives. The other is built on Node's request and response objects,
which is what a standalone Node process would use. Which shape applies follows
from the topology decision below, not the other way round.

Origin and host validation belongs to one value, not two. The SDK offers DNS
rebinding protection but leaves it off by default. This deployment already pins
an exact public origin in `BAP_PUBLIC_ORIGIN`, never a wildcard, and Better Auth
uses that same exact value as its trusted origin. The MCP surface reuses it
rather than introducing a second notion of an allowed origin that can drift from
the first.

The edge rules apply unchanged. `/ready` and `/metrics` stay blocked before
proxying, the 25 MB request body cap covers an MCP POST as it covers any other,
and Caddy still replaces the client IP header, so per-key rate limit accounting
sees the caller and not the proxy.

## Authentication for external AI clients

External clients authenticate with Better Auth API keys. They do not
authenticate with resource JWTs, and no implementation may make them do so.

### Why a resource JWT is the wrong credential

A resource JWT is not a client identity. It is a one-hop service credential that
says which signed-in human an internal call acts for, and it is shaped so it can
be nothing else.

It is minted only inside the BFF, per outbound call, in memory, and returned to
nobody. There is no endpoint that issues one, because `/api/auth/token` is
disabled permanently and for exactly this reason. Handing one to an external
client would mean re-enabling that endpoint, which is a documented never.

It lives five minutes and has no refresh path. An external client would need
somewhere to fetch a new one every few minutes, and that place is the disabled
endpoint again.

Its claims are `sub`, `iat`, and `exp`, with no custom claims and the audience
`bap-internal-services`. It carries nothing that identifies a client, so it
cannot be revoked, scoped, or attributed at client granularity. Revoking one
would mean revoking the human.

[Authentication](../authentication.md) already states the rule this follows: a
human session JWT must never be reused as service identity. An MCP client is a
service.

### What an API key gives instead

Revocation is a row, not a signature. Disabling or deleting the key stops the
next call. A JWT cannot be withdrawn before it expires without a revocation
list, and a revocation list is new state this deployment would have to store,
replicate, and prove.

Scoping is to exactly one organization. The plugin supports organization-owned
keys, so a key names one organization and that is the organization every tool
call resolves. A key never spans organizations; an operator who belongs to two
holds two keys. The key is authentication only. Membership is still re-resolved
per call through `auth.resolve_membership`, exactly as the BFF and the worker
do, so a revoked member is refused while their key is still enabled, and the
capability contract in
[`packages/security/src/access-contract.ts`](../../packages/security/src/access-contract.ts)
still decides what the resolved role may do.

Storage is hashed and the value is never recoverable. The plugin hashes keys by
default and keeps only a short leading fragment so an operator can tell two keys
apart in a list. The full value is shown once at creation and never again.
Hashing must stay on. The flag that disables it exists for lookup performance,
and turning it off would put a bearer credential in the database in clear, where
`bap_auth` can read it and every backup snapshot carries it.

Audit covers creation, use, and revocation. A tool call records through
`app.record_audit`, which takes no organization or subject argument and derives
both from `current_setting`, so a key cannot claim another tenant's attribution
even if its payload says otherwise. What is recorded is the action, the
resource, and bounded metadata. Never the key, never a prompt, never a tool
result, because audit rows are readable by everyone in the organization.

Rate limiting is per key. Keys carry their own request counters and window,
which is the right granularity here: the Better Auth global rules replace the
built-ins entirely and are written for interactive auth paths, not for a machine
client polling a tool.

### Where key verification is allowed to run

`bap_auth` is the only runtime role granted DML on the `auth` schema, so
whatever verifies an API key needs a `bap_auth` connection. `bap_auth` also
holds `auth.jwks`. Giving a new service that login therefore gives it the
ability to mint resource JWTs, creating a second minter outside the BFF and
breaking the boundary this plan exists to keep.

That leaves two acceptable answers. Either the MCP surface runs inside the web
service, which already connects as `bap_auth` and already owns the only minting
path, or it verifies keys by calling the web service over the internal `app`
network and never holds the credential itself. There is no third answer that
keeps the boundary intact.

### What the plugin costs the schema and the public surface

The key table is a reviewed migration, not a framework-managed one. Better Auth
tables in this repository are created by files in `packages/db/drizzle`;
`auth.two_factor` is the precedent. The API key table follows the same lane,
takes the next free migration id, bumps `DATABASE_MIGRATION_COMPATIBILITY` in
the same pull request, maps to snake_case columns like every other auth model,
and grants `SELECT` to `bap_backup` or the backup drill fails.

The plugin's routes are public the moment it loads. It mounts paths under the
existing `/api/auth` prefix, and Caddy proxies that prefix already. The change
therefore decides explicitly which of those paths are reachable and adds the
rest to `disabledPaths` beside `/token` and `/sign-up/email`, rather than
inheriting whatever the plugin ships. Adding a plugin is adding public surface.

## Caddy and topology

Caddy proxies `web:3000` and nothing else, and the Compose contract check
asserts Caddy's network membership by name. Publishing an MCP endpoint is
therefore an architecture decision, not a configuration tweak, and it needs its
own ADR taking the next free id after [ADR 0006](../adr/0006-upload-staging.md).
That ADR has to decide four things.

**Whether MCP is a new container or a route on an existing one.** A route in
`apps/web` reuses the BFF, the `bap_auth` connection, the origin and session
rules, and the upstream Caddy already has. A separate container needs its own
image, health check, readiness route, metrics route, restart policy, and Compose
contract assertions, and it still has to solve key verification without holding
`bap_auth`. The route is the smaller change. A container is justified only if
MCP has to scale or fail independently of the web application, which nothing
measured says yet.

**Which networks it joins.** `app`, so Caddy can reach it. `data` only if it
talks to PostgreSQL directly, which it should not need to do if it reaches
tenant data through the same BFF and API path the product already uses. Every
attachment is an assertion in `scripts/verify-compose.mjs`, added in the same
change.

**Whether it joins `internet-egress`. It should not.** That network exists for
outbound provider calls, its membership is an enforced allowlist of exactly
`web` and `worker` under [ADR 0004](../adr/0004-controlled-internet-egress.md),
and MCP is an inbound surface: the client calls in, the server answers, and no
model provider sits on the other end of a tool call. A tool that causes a model
call does not change this either, because that call already happens in the web
service, which is already a member. Attaching MCP to `internet-egress` would
widen the allowlist for a runtime with no outbound dependency, and the contract
check would fail by name, which is the check working correctly.

**Whether Caddy's own assertion changes.** It only changes if the answer to the
first question is a new container that Caddy has to reach on a network other
than `app`. Keeping the new service on `app` leaves the existing assertion true,
which is one more reason to prefer it.

The Compose model in [ADR 0003](../adr/0003-compose-deployment-model.md) stays
the frame for all four: whatever is decided is one service definition shared by
development and production, with the production overlay supplying the read-only
and restart policy, and no hidden environment-specific behavior.

## Tool surface

The MCP tool surface mirrors the typed registry in
[`packages/ai/src/tools.ts`](../../packages/ai/src/tools.ts). That registry
deliberately ships empty, because every tool carries product knowledge. MCP does
not change that. It publishes the same registry over a different transport.

One definition per tool, registered in one place. The MCP server exposes the
registry rather than declaring a parallel list of tool descriptors. Two lists
drift, and the one that drifts is always the one with the weaker tests.

Every tool takes identifiers in and lets row level security decide what comes
out. A tool accepts an organization id and resource ids. It never accepts a
filter it is trusted to apply, and it never accepts a flag that widens what it
returns. This is the worker's contract for the same reason: `withTenantContext`
sets both settings with `SET LOCAL` inside one transaction, the table policies
compare against those settings, and so visibility is decided by the database
rather than by an argument. A tool that offered to list everything would be
asking the application to become the authorization layer.

Tool arguments are external input and are validated at that boundary with zod
before anything else happens, exactly as the worker validates a job payload at
dequeue and the BFF validates every upstream response.

A tool that reaches tenant data inherits the authorization the chat route
already had to satisfy. That route resolves membership for the named
organization through the same helper the BFF access route uses, refuses a
non-member and a member whose contract withholds `useAi` before the provider
credential is read, and resolves a named dataset through the BFF helpers so that
a dataset row level security hides is answered as missing rather than answered
ungrounded. [Security](../security.md) records why that gate exists at all: the
chat route registers no tools, and the capability check is there so the first
tool that reaches tenant data inherits a boundary instead of needing one
invented alongside it. This plan is that first tool. An MCP tool that reads a
dataset makes the same checks in the same order: membership, then capability,
then resource, and only then data.

The model provider boundary is unchanged by this plan. The limits in
[security](../security.md) on what leaves the deployment describe prompt
content, and a tool result returned to an MCP client is not a prompt: it is
tenant data going to a client its own API key authorizes to have it. What must
not happen is quiet widening in the other direction. If a tool result is later
assembled into a prompt inside the deployment, it is subject to the
metadata-only rule like anything else, and the test that asserts the
summarization profile never selects `app.dataset_row.data` stays the model for
how that is proven.

## What it must not do

- No bypass of `withTenantContext`. Every read and write of a tenant table
  happens inside one transaction that set both settings. Missing context
  returning nothing is the correct failure, not a bug to work around.
- No `SECURITY DEFINER` helper added to make a tool convenient.
  `app.record_audit` is the only definer function, it takes no tenant argument,
  and forced row level security binds it too. A definer function that returned
  rows for a caller-supplied organization would be a cross-tenant read primitive
  with a friendly name on it.
- No second scheduler. Recurring work is pg-boss cron. An MCP tool may enqueue a
  job; it does not own a timer, a polling loop, or a cron of its own.
- No new credential shape. Every credential is a mounted file validated for
  regular-file status and mode `0400`, `0444`, or `0600`. An MCP-related secret
  arrives the same way, or it does not arrive.
- No second database role. `bap_api` for tenant data and `bap_auth` for identity
  are the two runtime roles that exist, and MCP adds neither a third nor a
  second holder of `bap_auth` outside web.
- No resource JWT minted outside the BFF, and none returned to any client.
- No widening of a queue payload. `pgboss.job` has no row level security and is
  cross-tenant readable by `bap_api`, so a job an MCP tool enqueues carries
  identifiers only, exactly like the ingestion jobs.
- No new schema object created at runtime. `bap_api` has no `CREATE` privilege
  and the implementation must not want one.

## Verification

An implementation cannot merge until these hold.

- `pnpm check` proves the code around the surface: zod validation of tool
  arguments including malformed, oversized, and unknown-field input; the
  membership and capability gate refusing a non-member and a member without the
  capability before any credential is read; a tool naming a dataset that policy
  hides answered as missing rather than ungrounded; the response boundary
  allow-listing what a tool returns; and the registry exposing exactly the
  registered tools with no parallel descriptor list.
- `pnpm test:integration` proves the database properties: a tool path running
  only inside a full tenant context, a cross-tenant read returning nothing, a
  write naming another organization rejected, an aborted call for revoked
  membership, the exact privilege set on the API key table including
  `bap_backup` `SELECT`, and a stored key that is a hash rather than the issued
  value.
- `pnpm compose:verify` proves the topology in all four modes: the new service's
  network membership asserted by name if the ADR adds a service, Caddy's
  membership still asserted, and `internet-egress` membership still exactly
  `web` and `worker`.
- The container smoke job proves the public behavior: the endpoint reachable
  through Caddy with a valid key, refused without one and with a revoked one,
  and `/ready` and `/metrics` still blocked at the edge.
- The operational proof covers backup, restore, and migration-version agreement
  with the new table present, which is what catches a missing `bap_backup`
  grant.
- The migration compatibility constant is proved by `/ready`, which returns 503
  on every service until the constant matches the recorded version.

Details of each gate are in [testing](../testing.md).

## Out of scope

- The implementation itself. This plan specifies the contract; the server, its
  dependency, its migration, and its Compose entry are a separate change.
- MCP resources and prompts. Tools first, because a tool is the surface that has
  to carry the authorization argument. Resources and prompts can follow once
  tools are proven.
- OAuth-based MCP authorization. The specification describes an OAuth flow for
  HTTP servers, and adopting it means an authorization server, dynamic client
  registration, and a consent surface. That belongs on the same policy list as
  SSO and SCIM in [authentication](../authentication.md). API keys answer the
  immediate need with state this deployment already knows how to store, revoke,
  back up, and audit.
- Sampling, elicitation, and any server-initiated model call. The model provider
  boundary names exactly when a provider is reached, and a tool wanting one is
  not on that list.
- Any business-domain tool. The tools this plan describes read the generic
  dataset layer specified in
  [the tenant data foundation plan](tenant-data-foundation.md). No customer,
  employee, company, transaction, or analytics tool, and no sample data of any
  kind.
- Key sharing between users, per-tool billing, and a public server directory
  listing.

## Open questions

These need an owner decision before implementation starts. Each one changes what
gets built, not just how.

1. **Which package supplies the API key plugin, and at which version.** The
   pinned `better-auth` release in this workspace exports no API key plugin; it
   was moved into a dedicated package. Adopting it is a catalog entry, a
   lockfile change, and a new dependency to review under the policy in
   [configuration](../configuration.md), so the version and package are an owner
   decision rather than an implementation detail.
2. **Who mints a key, and where.** An organization owner minting keys from a
   product screen is the convenient answer and adds a public write path. An
   out-of-band command in the image, like the existing `bootstrap-owner`, is the
   conservative answer and adds an operator step. The choice decides whether a
   new UI surface is in the first implementation at all.
3. **A route on `apps/web` or a new container.** This plan recommends the route
   and gives the reasons, but the ADR owns the decision, and it is the input
   every other topology question depends on.
4. **Whether a tool result is capped, and by what.** Chat context is capped at
   40 listed columns with clipped names precisely because an unbounded context
   is a cost and exposure problem. A tool that returns rows has no equivalent
   ceiling yet. The owner should say whether an MCP client may page through a
   whole dataset, or whether a key carries a row budget.
5. **Whether MCP is gated on `useAi` or on a new capability.** The contract in
   `@bap/security` today exposes `manageGrants`, `manageMembers`, `uploadData`,
   and `useAi`, and `useAi` is `true` for every role, so gating MCP on it
   changes nothing for anyone. A separate capability would let an owner keep MCP
   off for members while chat stays on, at the cost of changing the capability
   schema and both of its consumers.
