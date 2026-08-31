# ADR 0007: Public Sign-up

- Status: accepted
- Date: 2026-08-31

## Context

Email and password sign-up was disabled at the Better Auth endpoint. That made
invitation onboarding dependent on an operator-created account and left no
controlled way to open self-service registration. A deploy-time flag would tie
the policy to a restart, while an auth-table setting writable by `bap_auth`
would let the public web runtime change its own admission policy.

The `auth` schema has a deliberate default privilege: tables created by
`bap_owner` grant SELECT, INSERT, UPDATE, and DELETE to `bap_auth`, because
Better Auth owns most tables there. A platform policy table is an exception to
that default and must revoke the inherited grant explicitly.

## Decision

Store the default-off runtime switch in `auth.platform_setting`. Expose its
value to `bap_auth` only through the stable, security-definer
`auth.public_signup_enabled()` function. The function returns false when its row
is absent. `bap_auth` has no table privilege, while `bap_backup` retains SELECT.

A pending, unexpired organization invitation for the submitted address bypasses
the switch. Address matching is case-insensitive. Database failures fail closed,
and neither policy layer logs the address.

Before reading any request body or policy state, the Next.js route atomically
consumes a 3-per-60-second edge bucket in `auth.rate_limit`. The identity comes
only from Caddy's replaced `x-bap-client-ip` header. It must be a valid IP;
scoped IPv6 values and absent or malformed values use one shared fallback
bucket. IPv4 identities remain /32, while IPv6 identities are canonicalized to
/64 before hashing so ordinary address rotation shares a bucket. Edge keys use a
`bap-edge:public-sign-up` namespace separate from Better Auth's keys. Exhaustion
returns 429 with `Retry-After` and JSON retry metadata. The atomic conflict
update is skipped once the count reaches 3, so denied attempts neither increase
the count nor keep writing the hot row. Every consume also prunes expired keys
in only that edge namespace, using its partial `last_request` index; Better Auth
keys are never cleanup targets. A database failure returns the generic 403
policy denial without its cause.

Caddy overwrites the header at the public boundary. A caller with direct
internal access to the web service is outside that trust boundary and can still
supply valid spoofed prefixes, so the internal network topology remains a
required part of this control.

After consuming the edge attempt, reject non-JSON media types, clone and
validate the JSON body, then check the invitation and switch before dispatching
to Better Auth. Malformed or unsupported bodies therefore consume an attempt and
fail closed. Better Auth retains its independent rate limit and repeats the
admission checks in a before-hook scoped exactly to `/sign-up/email`. The layers
remain separate so direct server API dispatch cannot bypass the policy and a
framework integration change cannot silently remove the public edge check.

Better Auth keeps its generic duplicate response. A custom synthetic user adds
the Admin and Two Factor plugin fields so an existing address cannot be
distinguished by response shape. New accounts stay unverified until the
30-minute verification link is used; successful verification creates the browser
session. Sign-up does not create an organization or membership.

The `/sign-up` browser page reads the switch through the server-only accessor
and renders no form when it is false or unavailable. It discards Better Auth's
success payload so fresh and duplicate addresses have the same visible outcome,
and uses only the relative `/activate` callback. The remaining identity pages
apply the same generic-outcome rule to password recovery and activation errors.
The proxy removes raw reset tokens and activation error codes from callback URLs
before render. A valid reset capability is held only in a short-lived,
path-scoped `HttpOnly` cookie and consumed by a Server Action through Better
Auth's in-process HTTP handler so the router limiter executes. Exact callback
matchers include prefetch requests, and callback responses use
`Referrer-Policy: no-referrer`.

Only a host-shell operator who already has access to the `bap_migrator`
credential may run `signup enable`, `signup disable`, or `signup status` through
the database CLI. Writes run in a transaction under `SET LOCAL ROLE bap_owner`.
There is no HTTP, browser, or application-role mutation path. In Compose, this
means overriding the one-shot migrator command from an authorized host shell,
not exposing the command as a long-running service. Success and failure output
is JSON; failures use one generic code and never reflect a database error.

## Consequences

The switch changes without a web restart, and invitations keep working at the
framework boundary while public sign-up is closed. The public sign-up page shows
no registration form in that state. Every allowed sign-up passes 2 independent
policy checks and 2 independent 3-per-minute rate-limit buckets by design. A
database outage rejects registration, including invitation registration, until
the read boundary recovers.

The migration compatibility version advances with the new table and function.
Rolling application code back while leaving the migration applied creates the
accepted compatibility gap: readiness returns 503 until compatible code is
deployed again or its expected migration version is deliberately updated. The
schema migration is not reversed as part of an application rollback.

The operational workflow exercises the policy through Caddy with the switch both
OFF and ON. It proves the OFF request still consumes the first edge-rate
attempt, fresh and duplicate responses are equivalent and sessionless, an
unverified account cannot sign in, attempt 4 is limited, and only the fresh
request reaches the recipient-filtered development mail sink. Cleanup restores
the default-off switch even when the proof fails. Development SMTP acceptance is
part of the fresh auth response boundary. Recipient sets are checked immediately
and finally over a short Mailpit API-consistency window after the duplicate and
limited responses; that window does not bound SMTP work.
