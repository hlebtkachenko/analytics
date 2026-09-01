# Organization routing

**Date:** 2026-08-31

## Problem

Organization URLs need a stable human-readable slug without allowing a slug to
become a service authorization key. A route must also conceal whether an
organization exists from unauthenticated users and nonmembers.

## Scope

Add a member-gated `[orgSlug]` layout, a request-scoped resolver, and a narrow
database membership lookup. Redirect `/` to `/organizations`. Reject malformed,
unknown, unauthenticated, unverified, and nonmember routes with the same
not-found result. Keep internal APIs keyed by organization id and add the
repository rule that every new top-level route reserves its organization slug in
the same pull request.

This phase added no descendant organization page, organization switcher,
settings or member-management UI, API/reporting slug support, shared cache, or
ambient active-organization routing. Phase 10 subsequently published the
deliberately temporary descendant pages and `/organizations` target without
changing this routing boundary.

## Design

`@bap/db` exposes one parameterized lookup joining `auth.organization` to
`auth.member` by normalized slug and authenticated subject id. The web resolver
validates the slug, obtains the current request session, requires verified
email, and performs that lookup. React `cache` wraps the entire resolver for
same-request deduplication only. The dynamic layout calls the resolver and
invokes Next.js `notFound()` for every failed outcome.

The root page redirects unconditionally to `/organizations`. Organization ids
remain the only accepted selectors at the BFF and service boundaries. Installed
Better Auth may store an active organization during creation or invitation
acceptance, but no supported BAP route uses that value as an implicit selector.

## Security

Malformed slugs are rejected before session or database work. The join makes
existence and membership one database decision, and all negative outcomes share
the same public response. The resolver does not use Better Auth's
`get-organization` endpoint because that endpoint can fall back to ambient
session state. No slug, membership, session, or organization data is logged.

## Verification

Unit tests cover the exact parameterized join, role parsing, resolver
fail-closed behavior, not-found equivalence, request-scoped layout use, and the
root redirect. A paired BFF and PostgreSQL proof forwards a valid slug-shaped
selector with an in-memory resource token, preserves the id-only service's
redacted 403, and proves the same value resolves no membership when supplied as
an organization id. PostgreSQL integration exercises real membership rows. Run
focused package tests, full database integration, the exact `pnpm check`, scoped
Prettier, stale-document scans, and `git diff --check`; use live browser checks
only for routes that exist in this transitional phase.

## Open questions

None. Phase 10 added the first descendant pages and reserved `organizations` in
the shared and database contracts through a new forward migration.
