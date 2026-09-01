# ADR 0010: Organization Route Resolution

- Status: accepted
- Date: 2026-08-31

## Context

Organization URLs need a human-readable slug, while application and reporting
authorization use immutable organization ids. Treating the slug as a service
selector would duplicate authorization logic and make a mutable name part of the
tenant boundary. Better Auth can resolve an organization by slug, but its
installed endpoint can also fall back to `session.activeOrganizationId` and
mutate that ambient state for a nonmember.

Route failures must not reveal whether an organization exists to a visitor or a
different organization's member. A slug can also change, so caching a slug-to-id
mapping beyond one request can route an old URL to the wrong tenant.

## Decision

The Next.js `[orgSlug]` layout is the single web route gate. A request-scoped
React `cache` operation validates the slug, reads the current opaque-cookie
session, requires verified email, and calls a narrow `@bap/db` accessor. That
accessor performs 1 parameterized `auth.organization INNER JOIN auth.member`
query keyed by slug and session user id through the existing `bap_auth` pool.
Malformed, unknown, unauthenticated, unverified, nonmember, invalid-role, and
lookup-error outcomes all become the same Next.js not-found result.

No slug-to-id value is cached across requests. The APIs, BFF resource calls,
tenant transactions, and `auth.resolve_membership` continue to accept
organization ids only. Better Auth creation and invitation acceptance may update
stored `activeOrganizationId`, but no supported BAP route consumes it as an
implicit selector.

The root route redirects unconditionally to `/organizations`, never to an
ambient or last-visited organization. A literal Next.js route wins over the
dynamic slug route. Every pull request that adds a top-level application route
must therefore add the same segment to the reserved organization-slug contract.

## Consequences

Organization existence and membership are decided together without exposing a
distinct forbidden response. A slug-shaped value can pass the BFF's syntactic
selector validation, but the id-only service membership resolver finds no row
and returns 403. The slug dies at the web routing boundary.

Phase 9 added only the dynamic layout. Phase 10 now publishes the deliberately
temporary `/organizations` index and the overview, members, and settings pages
beneath `[orgSlug]`. All of their scoped server actions resolve the slug through
this same member gate and call Better Auth with the resulting explicit id. The
new literal is reserved in TypeScript and PostgreSQL by migration
`20260831.0004` before the route becomes reachable.
