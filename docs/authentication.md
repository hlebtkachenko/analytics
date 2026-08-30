# Authentication and Organization Access

## Browser identity

Better Auth owns host-only opaque session cookies in the Next.js application.
Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`. The configured
origin and trusted origin are exact values, never wildcards. Public email
sign-up is disabled.

Two public surfaces stay unavailable permanently:

- `/api/auth/token`, because resource JWTs exist only inside a BFF call
- email sign-up, because membership is invite-only

Password reset, verification mail, and organization invitations are enabled and
deliver through the single mail module. Invitation mail links to
`/invitation/:invitationId`, where an authenticated recipient reviews and
accepts the invitation.

## Magic link and two factor

Magic-link sign-in resolves the account before sending. Better Auth generates
the token and calls the send hook without looking the user up, so an unguarded
hook would mail any address a caller supplied. The hook therefore queries
`auth."user"` first and returns without sending when the address is unknown, and
it returns the same way in both cases so the endpoint cannot be used to
enumerate accounts.

The same hook refuses to send when the account has two factor enabled, because
Better Auth challenges the second factor only on `/sign-in/email`,
`/sign-in/username`, and `/sign-in/phone-number`. A magic link that reached a
two-factor account would mint a full session and defeat the factor.

Known limitation: that guard is on the send side. A link delivered while two
factor was disabled stays usable for its five-minute lifetime even if the owner
enables two factor in that window, and any future code path that mints a
magic-link token without the send hook would reopen the bypass. Closing it
properly needs a verification-side hook on `/magic-link/verify`.

Two factor is opt-in TOTP. Sign-in returns a two-factor redirect instead of a
session, and `/sign-in/two-factor` verifies the code before the real session
cookie is issued.

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
rules replace the Better Auth built-ins entirely rather than layering on them,
so each credential, magic-link, two-factor, and password-reset path is pinned at
three requests per minute, which is never weaker than the built-in it replaces
on either the ten-second or the sixty-second horizon. Member invitation stays at
five per minute, well below the global default it replaces.

## Future identity work

Passkeys, social login, SSO/SAML, SCIM, API keys, and service identities require
separate policy and provider decisions. A human session JWT must never be reused
as service identity.
