# Authentication and Organization Access

## Browser identity

Better Auth owns host-only opaque session cookies in the Next.js application.
Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`. The configured
origin and trusted origin are exact values, never wildcards. Email/password
sign-up is available behind a default-off runtime switch. A pending, unexpired
organization invitation for the submitted address bypasses that switch.

Two authentication paths are disabled:

- `/api/auth/token`, because resource JWTs exist only inside a BFF call
- `/api/auth/change-email`, because email changes use BAP-owned flows

Password reset, verification mail, and organization invitations are enabled and
deliver through the single mail module without waiting for the mail provider.
Invitation mail links to `/invitation/:invitationId`, where an authenticated
recipient reviews and accepts the invitation.

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

## First owner

The initial owner is created with the image-local `bootstrap-owner` command. It
requires a TTY, confirms the exact identity out of band, hides the 14-128
character password during input, and holds a PostgreSQL advisory lock. It uses
the supported Better Auth Admin and Organization server APIs.

The command resumes only one safe partial state: a verified global admin with no
membership and no existing organization owner. All other partial states abort
with a recovery instruction. The command reports only generated IDs and status.

The separate `create-synthetic-account` CLI exists only for disposable
operational proof. It requires `BAP_E2E_SETUP=true`, accepts one validated JSON
object from standard input, and emits only status and generated IDs. It does not
replace the interactive owner bootstrap.

## Rate limiting and client identity

Caddy replaces the dedicated `X-BAP-Client-IP` header. Better Auth reads only
that single-value header, keeps proxy-origin inference disabled, and stores rate
limit state in PostgreSQL. The baseline is 100 auth requests per minute. Custom
rules layer over Better Auth built-ins on their named paths; built-in rules for
other paths continue to apply. Password reset requests, sign-in, sign-up,
verification-mail requests, and two-factor credential submissions are pinned at
three requests per minute. Verification and password reset completion, including
token-bearing reset paths, are five per minute. Member invitation stays at five
per minute. Sign-up also consumes the independent 3-per-minute edge bucket
before Better Auth runs, so an allowed request must pass both limits.

## Future identity work

Passkeys, social login, SSO/SAML, SCIM, API keys, and service identities require
separate policy and provider decisions. A human session JWT must never be reused
as service identity.
