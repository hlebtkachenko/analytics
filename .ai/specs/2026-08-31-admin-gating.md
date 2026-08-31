# Admin HTTP Gating

## Problem

Better Auth 1.7.2 installs 15 Admin-plugin HTTP endpoints. BAP has no admin UI
or HTTP consumer, but the public auth catch-all currently exposes most of that
surface at the framework defaults. Impersonation can mint or replace a browser
session, and reachable mutations otherwise share the broad default limiter.

## Scope

Disable both impersonation endpoints while preserving the Phase 4 disabled
user-removal endpoint. Inventory the installed admin routes and pin explicit
limits for every reachable mutation. Make the absence of `adminUserIds` a tested
configuration invariant. This does not add an admin UI, operational admin
workflow, organization management, or new database authorization.

## Design

`disabledAuthPaths` adds `/admin/impersonate-user` and
`/admin/stop-impersonating`. Better Auth receives the same set, and the public
Next route gate rejects the normalized path before loading or dispatching the
auth handler. This is an HTTP-router boundary only: server code can still call
`auth.api` methods directly.

The Admin plugin receives an exported, exact configuration object containing
only its schema mapping. It never receives `adminUserIds`. The 8 reachable
mutating paths receive custom limits of 3 attempts per 60 seconds. Read-only
routes and the 3 disabled mutations receive no custom rule, so unrelated Better
Auth built-ins, including change-password's stricter 3-per-10-second rule,
remain in force.

Installed `/admin/create-user` deliberately permits a direct
`auth.api.createUser` call without request or headers to skip the HTTP session
and permission checks. `bootstrap-owner` uses that server-only path. Public HTTP
dispatch still supplies a request and therefore requires an authoritative admin
session and permissions.

## Security

Public HTTP callers cannot dispatch user removal or either impersonation route,
including normalized trailing-slash forms. No BAP browser or application code
consumes any admin HTTP endpoint. The surviving routes continue to rely on
Better Auth's authoritative session and role permission checks. BAP does not add
id-based administrator bypasses.

## Verification

Focused tests assert the exact disabled set, exact Admin plugin options, all 8
custom rules, preservation of the installed change-password rule, and the
configured and public HTTP handlers' refusal of both impersonation paths. They
also prove those requests mint no session, and that direct server create-user
works while unauthenticated HTTP create-user does not. Run the web tests, lint,
typecheck, and build, then the full `pnpm check`, scoped Prettier,
stale-document scans, and `git diff --check`.

## Open questions

None.
