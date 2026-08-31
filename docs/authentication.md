# Authentication and Organization Access

## Browser identity

Better Auth owns host-only opaque session cookies in the Next.js application.
Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`. The configured
origin and trusted origin are exact values, never wildcards. Email/password
sign-up is available behind a default-off runtime switch. A pending, unexpired
organization invitation for the submitted address bypasses that switch.

Nine authentication paths are disabled:

- `/api/auth/token`, because resource JWTs exist only inside a BFF call
- `/api/auth/change-email`, because email changes use BAP-owned flows
- `/api/auth/delete-user/callback`, because deletion has no email-verification
  callback
- `/api/auth/admin/remove-user`, because Better Auth 1.7.2 bypasses the BAP
  deletion hook and erasure request on that Admin-plugin path
- `/api/auth/admin/impersonate-user`, because BAP has no approved
  session-minting impersonation workflow
- `/api/auth/admin/stop-impersonating`, because its paired impersonation entry
  point is disabled
- `/api/auth/organization/delete`, because BAP has no cross-schema purge
  workflow and deleting only auth rows would strand application data
- `/api/auth/organization/get-active-member`, because the installed endpoint has
  no bindable organization-id input and reads ambient session state only
- `/api/auth/organization/set-active`, because organization scope must be an
  explicit request input instead of mutable session state

BAP has no UI or HTTP consumer for any Admin-plugin path. The public route gate
and Better Auth reject all 3 disabled admin paths, including trailing-slash
variants, before endpoint dispatch.

Password reset, verification mail, and organization invitations are enabled and
deliver through the single mail module. Password reset and invitation delivery,
plus verification through production Resend or the explicit log transport,
remain non-blocking. Verification through the exact development SMTP sink waits
for SMTP acceptance before the auth response resolves. Invitation mail links to
`/invitation/:invitationId`, where an authenticated recipient reviews and
accepts the invitation.

Production delivery uses Resend. Development and CI select a narrowly fixed
Nodemailer transport to the internal `mailpit:1025` sink; no other SMTP endpoint
is accepted. The explicit Mailpit overlay is absent from bootstrap and
production. Its development-only companion exposes only GET `/readyz` and GET
`/api/v1/search` on host loopback for operational tests. SMTP failures are
generic and make the awaited public auth request return a generic 503. File and
URL access are disabled, and the transport logs no recipient, body, link, token,
or provider error.

## Browser identity routes

The bare Carbon identity layout covers these public URLs without a product
header or UI shell:

- `/sign-in` for email and password sign-in, with a link to password recovery
- `/sign-in/two-factor` for the pending TOTP challenge
- `/sign-up` for server-gated account creation
- `/forgot-password` for a generic password-reset request
- `/reset-password` for a valid Better Auth reset callback
- `/activate` for the email-verification callback result
- `/welcome` for the authenticated post-activation handoff

The sign-up page reads the switch through the server-only database boundary. A
false value or failed read replaces the whole form with the closed state. The
form sends name, email, and a 14-128 character password with the relative
`/activate` callback. Both a new address and an existing address produce the
same visible check-email result.

Password recovery uses the relative `/reset-password` callback and gives the
same check-email result whether the address exists or not. Before rendering, the
proxy moves exactly 1 valid-shape callback token into a 30-minute `HttpOnly`,
`SameSite=Lax` cookie scoped to `/reset-password`, sets `Secure` in production,
and redirects to the clean path. A callback error, malformed token, or duplicate
token clears that capability. A clean request without a valid capability
produces one generic reset-link failure with no form. Callback redirects and the
clean reset page use `Referrer-Policy: no-referrer`. Exact matcher entries apply
this canonicalization even to `Purpose: prefetch` and `Next-Router-Prefetch`
requests, while other routes keep the generic prefetch exclusion.

The page passes only a capability-present boolean to its Client Component. Its
Server Action reads the cookie, validates password bounds and confirmation, and
dispatches a `Request` to Better Auth's in-process HTTP handler at a fixed
non-routable URL. This executes the normal router limiter and hooks without an
outbound request. Only JSON content type and the Caddy-established client-IP
header are forwarded; incoming Host, origin, and cookies are not. Password
mismatch keeps the capability so the user can correct the form. Success or
terminal invalidity clears it. The token is never a client prop, form field,
action argument, log value, visible message, HTML value, or RSC payload, and
every framework rejection becomes the same generic visible failure.

Activation callback error codes are canonicalized before render to the fixed
`/activate?state=invalid` URL with `Referrer-Policy: no-referrer` and are never
rendered. A live session redirects from `/activate` to `/welcome`. With no
session, the page explains generically that an email scanner may have consumed
the link and offers sign-in. `/welcome` redirects an unauthenticated request to
`/sign-in` and links an authenticated account to `/access`.

All identity forms use standard Carbon form controls through
`@bap/design-system`. Auth failures use a non-dismissible, low-contrast error
`InlineNotification` with an alert role. The pages never render or log raw
tokens, framework error bodies, or database errors.

`/account` is a separate authenticated, deliberately temporary plain-HTML page.
It has no Carbon components, style sheet, product header, or UI shell. It shows
the session email and exposes sign-out, password change, and account deletion.
Its Server Component redirects failed or absent session reads to `/sign-in` and
passes only the email into the interactive client boundary.

## Admin HTTP inventory

Installed Better Auth 1.7.2 registers exactly 15 Admin-plugin endpoints. In the
table below, paths are relative to `/api/auth`. A reachable HTTP endpoint still
requires the named authoritative browser session and, where listed, permission.
Requests are JSON unless a query is shown. There is no BAP admin UI or BAP HTTP
consumer for any of them.

| Method and path                    | Phase 5 exposure     | HTTP input                                                    | Installed HTTP authorization                                                                                                          |
| ---------------------------------- | -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/set-role`             | Reachable, 3/60      | `{ userId, role }`                                            | Session plus `user:set-role`                                                                                                          |
| `GET /admin/get-user`              | Reachable, read-only | `?id=USER_ID`                                                 | Session plus `user:get`                                                                                                               |
| `POST /admin/create-user`          | Reachable, 3/60      | `{ email, name, password?, role?, data? }`                    | Session plus `user:create`; a requested role also needs `user:set-role`, and ban fields in `data` need `user:ban`                     |
| `POST /admin/update-user`          | Reachable, 3/60      | `{ userId, data }`                                            | Session plus `user:update`; role fields also need `user:set-role`, ban fields need `user:ban`, and email fields need `user:set-email` |
| `GET /admin/list-users`            | Reachable, read-only | Optional search, filter, sort, limit, and offset query fields | Session plus `user:list`                                                                                                              |
| `POST /admin/list-user-sessions`   | Reachable, read-only | `{ userId }`                                                  | Session plus `session:list`                                                                                                           |
| `POST /admin/unban-user`           | Reachable, 3/60      | `{ userId }`                                                  | Session plus `user:ban`                                                                                                               |
| `POST /admin/ban-user`             | Reachable, 3/60      | `{ userId, banReason?, banExpiresIn? }`                       | Session plus `user:ban`; self-ban is rejected                                                                                         |
| `POST /admin/impersonate-user`     | Disabled             | `{ userId }`                                                  | If enabled: session plus `user:impersonate`; an admin target additionally needs `user:impersonate-admins` unless explicitly allowed   |
| `POST /admin/stop-impersonating`   | Disabled             | No body                                                       | If enabled: a live impersonated session and the signed original-admin session cookie; no separate role permission                     |
| `POST /admin/revoke-user-session`  | Reachable, 3/60      | `{ sessionToken }`                                            | Session plus `session:revoke`                                                                                                         |
| `POST /admin/revoke-user-sessions` | Reachable, 3/60      | `{ userId }`                                                  | Session plus `session:revoke`                                                                                                         |
| `POST /admin/remove-user`          | Disabled by Phase 4  | `{ userId }`                                                  | If enabled: session plus `user:delete`; self-removal is rejected, but the BAP deletion hook is bypassed                               |
| `POST /admin/set-user-password`    | Reachable, 3/60      | `{ userId, newPassword }`                                     | Session plus `user:set-password`                                                                                                      |
| `POST /admin/has-permission`       | Reachable, read-only | `{ permissions }`                                             | Authoritative session; evaluates the current user's requested permissions and requires no additional permission                       |

The Admin plugin configuration contains only BAP's schema mapping. It never sets
`adminUserIds`, so no user id bypasses role permissions. Disabled paths are an
HTTP-router control, not removal of the corresponding `auth.api` methods.

One installed server-API edge is intentional and narrow. When
`auth.api.createUser` is called without request or headers, Better Auth skips
the HTTP session and permission checks. The interactive `bootstrap-owner` CLI
uses that form to create the first admin, and the gated
`create-synthetic-account` operational-proof CLI uses it for a disposable user.
Both are trusted, server-side commands and intentionally pass neither request
nor headers. An HTTP `/admin/create-user` request always has request context and
cannot use this bypass; it requires the session and permissions in the table.

## Sign-up admission

`auth.platform_setting` stores the `public_signup` switch and seeds it to
`false`. `bap_auth` cannot read or write that table. It may execute only
`auth.public_signup_enabled()`, which returns false if the setting row is
missing. The public route and the Better Auth before-hook each check the policy
independently. Both accept a case-insensitive pending, unexpired invitation
before consulting the switch, and both fail closed if a database read fails. The
route returns HTTP 403 with code `PUBLIC_SIGN_UP_DISABLED`; the hook throws the
equivalent Better Auth API error. Submitted addresses are parameterized and
never logged by BAP policy code.

Before parsing the sign-up body or reading invitation state, the route consumes
one atomic 3-per-60-second edge rate-limit attempt. It reads only Caddy's
single-value `x-bap-client-ip` header and accepts it only when Node recognizes a
valid IPv4 or IPv6 address. Scoped IPv6, missing, and malformed values share one
fallback bucket. IPv4 identities remain /32; IPv6 identities are canonicalized
to /64 before hashing. Its `bap-edge:public-sign-up` key cannot spend Better
Auth's independent `/sign-up/email` bucket. An exhausted edge bucket returns
HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
JSON retry seconds. Its count stays capped at 3, and denied attempts do not
update the row until the window expires. Each consume also prunes expired rows
from only the edge namespace through a partial `last_request` index. Unsupported
media types and malformed JSON consume an attempt and then return the normal 403
policy code. A rate-limit database failure does the same without exposing its
cause.

Caddy overwrites `x-bap-client-ip` on public traffic. Direct internal access to
the web service is outside that trust boundary and can still submit a valid
spoofed prefix, so the Compose network boundary remains required.

Better Auth's generic duplicate response stays enabled because sign-up does not
create a session and requires verification. Its synthetic user carries the core
fields plus `role`, ban state, and two-factor state, so plugin fields do not
make an existing address distinguishable by response shape.

Only a host-shell operator with the Compose environment and `bap_migrator`
credential may inspect or change the switch. Run one of these against an
already-running stack, substituting the production Compose files and environment
path when applicable:

```sh
docker compose --env-file .env -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js signup status
docker compose --env-file .env -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js signup enable
docker compose --env-file .env -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js signup disable
```

The command emits only JSON state. Failures emit one generic JSON error and
never include the underlying database message. There is no browser, HTTP, or
long-running service control surface for this setting.

The scheduled operational proof uses that same CLI and the real public Caddy
path. Its first POST is denied while OFF and still consumes edge attempt 1. With
the switch ON, attempts 2 and 3 submit identical fresh and duplicate requests;
their statuses, exact `Set-Cookie` headers, and response bodies match after only
generated ids and timestamps are removed, both tokens are null, and neither
creates a session. Correct-password sign-in remains 403 for the unverified
account, and attempt 4 returns 429. A recipient-filtered Mailpit query proves
the fresh request sends exactly 1 verification message after its awaited auth
response. The duplicate and fourth response boundaries are followed by immediate
and final recipient-id comparisons over a short Mailpit API-consistency window.
That window does not bound SMTP work. Cleanup always restores the default-off
state.

## Password and email verification

Password sign-in is enabled and requires verified email. Passwords must contain
14-128 characters, and a completed reset revokes the user's existing sessions.
Verification mail is sent at sign-up and expires after 30 minutes. Successful
verification activates the account and automatically creates a browser session.
Sign-up itself creates no session, organization, or membership. An invited user
accepts the invitation after authentication to gain the offered membership.

Two factor is opt-in TOTP. Sign-in returns a two-factor redirect instead of a
session, and `/sign-in/two-factor` verifies the code before the real session
cookie is issued.

`autoSignInAfterVerification` creates a session without a two-factor challenge.
`/two-factor/enable` is live but requires an authenticated session and password;
there is no supported enrollment UI. Ordinary unverified users cannot get that
session because email/password sign-up does not sign them in and password
sign-in requires verified email. Already-verified users return early from email
verification. Before any flow can leave an authenticated, two-factor-enabled
account unverified, set `autoSignInAfterVerification` to `false` or enforce two
factor during verification.

The JWKS read endpoint remains public because private Nest services validate
resource-token signatures against it.

## Password change and account deletion

Password change uses Better Auth's installed `/change-password` endpoint. It
requires `currentPassword`, enforces the configured 14-128 character bounds, and
accepts `revokeOtherSessions`. The account page exposes that option. No custom
rate rule is added: Better Auth 1.7.2 already applies its special
3-per-10-second rule to the endpoint.

Account deletion is enabled. Better Auth 1.7.2 accepts either the submitted
password or a session younger than `session.freshAge`; the endpoint is therefore
not password-protected. BAP sets freshness to 5 minutes to keep passwordless
acceptance short, and the account page always submits the current password.

The deletion hook counts organizations where the deleting user has `owner` as an
exact comma-separated role token and no different member has that same token.
This matches Better Auth's composed roles such as `owner,admin` and
`admin,owner`, without substring matching. A count above 0 refuses deletion with
generic UI feedback. Co-owned organizations do not block it. Any database read
or request write failure fails closed.

Before Better Auth deletes identity rows, the hook calls the narrow `@bap/db`
request accessor with the explicit session user id. Better Auth does not wrap
its hook and identity deletes in 1 transaction, so this order is intentional. A
failed later delete can leave a stale pending request, but the operator CLI
locks the row and refuses it while `auth.user` is still live. The database's
`ON DELETE CASCADE` constraints remove that user's sessions, accounts,
memberships, invitations they created, and two-factor row with the identity.

After a successful browser deletion, an authorized host-shell operator runs:

```sh
docker compose --env-file .env -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js erase-user USER_ID
```

The command requires exactly 1 explicit pending id. In 1 transaction it locks
that request, proves the auth identity is absent, assumes the RLS-bypassing
eraser role only for the 3 app-column updates, returns to owner, consumes the
request, and commits. It emits JSON only. A missing request, live identity, or
database failure produces the same redacted JSON failure. There is no orphan
sweep.

One opaque `erased_<uuid>` replaces the subject in `app.audit_log.user_id`,
`app.data_grants.user_id`, and `app.dataset.created_by`. It is generated
independently of the user id and used consistently for that invocation. A repeat
direct function call changes no stored state, and a repeat CLI call fails
because the request was consumed.

A retained or granted dataset can remain readable after `created_by` is
tombstoned. `app.dataset_is_writable` then recognizes no live creator, so that
dataset remains unwritable until later ownership or delegation work. This phase
does not implement that later workflow.

This lifecycle is not complete GDPR compliance. BAP has no access or portability
workflow, and identifiers can remain in `app.audit_log.metadata`,
`auth.rate_limit`, `auth.verification`, and pg-boss job payloads.

## Resource-token boundary

The browser never receives or stores a resource JWT. The only resource-token
flows are:

```text
GET /api/bff/application/organizations/:organizationId/access
  -> GET http://api:3001/v1/organizations/:organizationId/access

GET /api/bff/reporting/organizations/:organizationId/access
  -> GET http://reporting-api:3002/v1/organizations/:organizationId/access
```

Each BFF handler validates the opaque session and verified-email state, signs a
five-minute Ed25519 JWT in memory, calls its fixed upstream with a three-second
timeout, validates the upstream response, and returns only `service`,
`organizationId`, and `role`.

Nest validation requires:

- algorithm EdDSA with an Ed25519 key;
- the exact public issuer;
- audience `bap-internal-services`;
- `sub`, `iat`, and `exp` with no custom claims;
- a lifetime no greater than 300 seconds.

The authentication guard runs before the bounded subject limiter. Invalid JWTs
return 401 without allocating limiter state. The limiter is per-process defense
in depth, not a distributed quota or authorization system.

## Authorization

Both APIs call `auth.resolve_membership(subject_id, organization_id)`. The
function returns only verified-email state and one of `owner`, `admin`, or
`member`. It is owned by `bap_owner`, uses a fixed safe search path, and is the
only auth read surface granted to the API roles.

New or changed member and invitation rows accept only the scalar roles `owner`,
`admin`, and `member`. The migration leaves its role checks `NOT VALID` so a
historical composed or otherwise invalid value does not block deployment. The
resolver treats such a legacy value as no membership instead of throwing.

## Organization creation

`auth.organization.created_by` attributes a created organization independently
of membership. It references the user with `ON DELETE SET NULL`. NULL means an
unattributed legacy or system-created organization and counts against no user's
quota. The approved creation path injects the authenticated user id as
authoritative creator data. `createdBy` is not a client input, so a forged value
is discarded.

`auth.organization_quota` stores a non-negative total per user; no row means
zero. `bap_auth` may SELECT the table for Better Auth policy checks but cannot
insert, update, or delete a grant. A BEFORE INSERT trigger is the atomic
enforcement point for non-NULL creators. It serializes each creator with
`pg_advisory_xact_lock(hashtext(created_by))`, counts only organizations
attributed to that creator, and rejects an insert at or above quota. Joining or
accepting invitations does not consume creation quota.

Better Auth creation is enabled with an explicit `owner` creator role and a
100-member organization limit. Before Better Auth performs its quota and slug
uniqueness queries, the global auth hook normalizes the submitted slug through
the shared contract and rejects an invalid result. The plugin hook validates it
again and supplies `created_by`. The function-form `organizationLimit` reads the
creator's quota and attributed count through `@bap/db`; `true` means the limit
is reached. A missing row, malformed result, or read error fails closed.
Ordinary exhaustion returns 403.

That precheck is advisory only. Two concurrent requests may both observe spare
capacity, so the PostgreSQL trigger remains the enforcement point. The losing
race can surface as a generic server failure after the trigger rejects it; the
application does not misreport that case as a deterministic precheck denial.

Organization slugs are 3 through 20 lowercase ASCII letters or digits separated
by single hyphens, cannot be all digits, and cannot be one of `access`, `api`,
`datasets`, `design-system`, `health`, `invitation`, `metrics`, `ready`,
`sign-in`, `sign-up`, `forgot-password`, `reset-password`, `activate`,
`welcome`, or `account`. The shared web validator and database constraints use
the same literal contract. The normalizer is deterministic and never silently
renames a reserved, numeric, empty, or too-short result. Organization routing
and creation UI remain Phase 9 work.

Installed Better Auth 1.7.2 has 11 endpoints that otherwise fall back to
`session.activeOrganizationId`. BAP's before-hook requires a non-empty explicit
`organizationId` in the body for `has-permission`, `update`, `invite-member`,
`remove-member`, and `update-member-role`; and in the query for
`get-organization`, `get-full-organization`, `list-invitations`, `list-members`,
and `get-active-member-role`. Those 10 endpoints can bind the supplied id.
`get-active-member` has no installed organization-id input and is always
rejected by the hook, including server-side `auth.api` calls; its public path is
also disabled before dispatch. Creation, slug checking, organization listing,
user-invitation listing, and invitation-id routes remain legitimately unscoped.
Public delete and set-active are disabled at both the BAP route contract and
Better Auth router.

Better Auth creation and invitation acceptance may update the session's stored
`activeOrganizationId`. BAP does not treat that value as authoritative: no
supported operation may use it as an implicit organization selector.

Only a host-shell operator with the migrator credential can set quota:

```sh
docker compose -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js organization-quota --email member@example.test --total 2 --note 'operator-approved capacity'
```

The command requires exactly `--email`, `--total`, and `--note`, resolves the
subject by email, and upserts the resulting total and note in 1 transaction
after `SET LOCAL ROLE bap_owner`. `granted_by` is NULL because the operator is
not represented by an auth user; the required note is the durable operator
provenance. It prints only the resulting row as JSON and reduces failures to 1
generic JSON code. No application or HTTP quota writer exists.

Organization deletion remains intentionally unavailable. Combined with the
account-deletion sole-owner guard, a sole owner can delete neither the
organization nor their account until ownership is delegated. Cross-schema
operator purge is a later milestone, not part of this phase.

## First owner

The initial owner is created with the image-local `bootstrap-owner` command. It
requires a TTY, confirms the exact identity out of band, hides the 14-128
character password during input, and holds a PostgreSQL advisory lock. It uses
the supported Better Auth Admin and Organization server APIs.

Before any user write, the command normalizes the organization name into the
shared slug contract and refuses an invalid result. After the user exists, it
uses a separate one-shot `bap_migrator` pool to establish only the minimum
initial quota of 1 under `SET LOCAL ROLE bap_owner`. An absent or zero row gains
`system-bootstrap` provenance; an existing quota of 1 or more and its provenance
are preserved. The migrator pool closes before the organization API call. The
long-lived web service never receives that migrator credential.

The command resumes only one safe partial state: a verified global admin with no
membership and no existing organization owner. All other partial states abort
with a recovery instruction. Existing-owner detection remains comma-token-aware
for historical composed roles even though new writes are scalar. The command
reports only generated IDs and status.

The separate `create-synthetic-account` CLI exists only for disposable
operational proof. It requires `BAP_E2E_SETUP=true`, accepts one validated JSON
object from standard input, and emits only status and generated IDs. It does not
replace the interactive owner bootstrap. Operational proof invokes it as a
command override of the same profiled one-shot service so it can follow the same
validate, user, initial-quota, close-migrator-pool, organization order.

## Rate limiting and client identity

Caddy replaces the dedicated `X-BAP-Client-IP` header. Better Auth reads only
that single-value header, keeps proxy-origin inference disabled, and stores rate
limit state in PostgreSQL. The baseline is 100 auth requests per minute. Custom
rules layer over Better Auth built-ins on their named paths; built-in rules for
other paths continue to apply. Password reset requests, sign-in, sign-up,
verification-mail requests, and two-factor credential submissions are pinned at
three requests per minute. Verification and password reset completion, including
token-bearing reset paths, are five per minute. Member invitation stays at five
per minute, and authenticated slug checking is ten per minute. Every reachable
mutating admin path is pinned at three per minute; read-only and disabled admin
paths have no custom rule. Sign-up also consumes the independent 3-per-minute
edge bucket before Better Auth runs, so an allowed request must pass both
limits.

## Future identity work

Passkeys, social login, SSO/SAML, SCIM, API keys, and service identities require
separate policy and provider decisions. A human session JWT must never be reused
as service identity.
