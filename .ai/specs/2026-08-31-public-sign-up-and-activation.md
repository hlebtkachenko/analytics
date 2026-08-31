# Public Sign-up and Activation

## Problem

Email/password registration is hard-disabled even for an invited address. The
platform needs a runtime, default-off public sign-up control without giving the
web runtime authority to change it, while invitation onboarding must continue
when the switch is off.

## Scope

Add the operator-owned switch, enable the Better Auth email sign-up endpoint,
and allow either an enabled switch or a pending, unexpired invitation. Keep
email verification as account activation and keep duplicate responses
indistinguishable. This phase does not add a sign-up page, organization
self-service, membership creation, social login, or two-factor enrolment.

## Design

Migration `20260831.0001` adds `auth.platform_setting` and seeds
`public_signup=false`. `auth.public_signup_enabled()` returns false for a
missing row and is the only read granted to `bap_auth`; inherited auth-table DML
is revoked. The database CLI supports `signup enable|disable|status` through the
existing migrator credential and emits JSON.

The Next.js route first consumes an atomic 3-per-60-second edge bucket in
`auth.rate_limit`. It uses only Caddy's `x-bap-client-ip`, validates that value
as an IP address, rejects scoped IPv6 identities, and shares one fallback bucket
for an absent or malformed value. IPv4 stays /32; IPv6 is canonicalized to /64
before hashing. The edge key namespace is separate from Better Auth's
independent rate limit. An exhausted bucket returns 429 with retry metadata,
remains capped at 3, and receives no conflict update until its window expires.
The same atomic statement prunes expired keys only from the edge namespace,
using a partial `last_request` index. Otherwise the route rejects non-JSON
content types, clones and validates JSON, and checks admission before dispatch.
Malformed and unsupported bodies consume the edge attempt and fail closed with
`PUBLIC_SIGN_UP_DISABLED`.

Better Auth repeats admission in its exact `/sign-up/email` before-hook. Both
policy layers query a case-insensitive pending, unexpired invitation first, then
the switch. Either layer fails closed. Better Auth remains responsible for
password validation, duplicate anti-enumeration, user creation, verification
mail, and its own second rate-limit bucket. A custom synthetic user includes the
Admin and Two Factor plugin fields.

## Security

Only `bap_migrator` may assume `bap_owner` and change the switch. No runtime
role may read or write its table directly. Submitted addresses are query
parameters and are never logged. A policy or rate-limit database error returns
`PUBLIC_SIGN_UP_DISABLED` without reflecting its cause. Verification activates
the account and automatically creates a session; sign-up itself creates neither
a session nor an organization membership. The existing accepted two-factor
caveat for automatic sign-in after verification remains. Caddy overwrites the
client header publicly, but direct internal web-service access can still spoof a
valid prefix and must remain excluded by the deployment topology.

## Verification

Focused web tests drive the exported POST route and a direct Better Auth API
dispatch. They cover switch-off, switch-on, invitation bypass, failed reads,
edge exhaustion, cloned JSON, malformed and unsupported bodies, exact rates, and
the synthetic response. Database CLI tests cover enable, disable, status,
commit, rollback, and redacted JSON errors. PostgreSQL integration tests prove
invitation states, concurrent atomic consumption, exact function and table
grants, expired edge-key cleanup without touching fresh or Better Auth keys,
missing-row behavior, backup visibility, and the auth-schema default-privilege
trap. Run focused tests, workspace typecheck, PostgreSQL Testcontainers
integration, scoped Prettier, and `git diff --check`.

## Open questions

None.
