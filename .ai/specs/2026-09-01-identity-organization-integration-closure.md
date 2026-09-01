# Identity and Organization Integration Closure

**Date:** 2026-09-01

## Problem

Identity and organization protections were implemented and tested alongside
their earlier phases, but the final milestone needs one explicit closure pass.
The repository must prove the database quota race, every reserved route,
runtime-role isolation, the id-only service boundary, inherited auth-table
privileges, and the existing row-level security suite without relying on prose
or a production environment.

## Scope

Consolidate and strengthen the existing automated evidence only. The shared slug
corpus will enumerate every reserved top-level route, the PostgreSQL suite will
execute the inherited DML on a newly created disposable `auth.*` table, and the
BFF test will pin the authenticated slug-shaped forwarding and redacted 403
response. Existing deterministic quota-lock, quota ACL, app-schema denial, and
RLS assertions remain authoritative and run together through
`pnpm test:integration`.

This phase adds no migration, production code, route, role, privilege, quota
behavior, UI, Compose topology, or live-data operation. It does not close the
documented organization-deletion or Better Auth last-owner gaps.

## Design

`tests/fixtures/organization-slugs.json` remains the single parity corpus read
by both the web validator test and the PostgreSQL integration suite. It will
contain all 16 currently reserved route literals as rejected cases.

`packages/db/src/postgres.integration.test.ts` keeps one PostgreSQL 18 container
and real service-role pools. Its existing quota race deliberately holds the
advisory lock in one transaction, observes a second backend waiting, commits the
winner, and proves exactly one attributed organization. The closure strengthens
the default-privilege probe by performing SELECT, INSERT, UPDATE, and DELETE as
`bap_auth`, while the quota exception and schema `app` tests keep proving those
powers do not cross their explicit boundaries.

The web BFF assertion uses a valid slug-shaped selector because that shape is
accepted by its syntactic selector contract. It proves the selector is forwarded
only to the fixed application service with an in-memory resource token, the
id-only service denial remains 403, and private upstream detail is replaced by
the fixed browser response. The real PostgreSQL resolver assertion separately
proves that the stored slug does not resolve as an organization id.

## Security

All database state is synthetic and exists only inside Testcontainers. Tests use
fixed test-only credentials and log no runtime secrets, session cookies,
resource tokens, personal data, or database URLs. No default development stack,
named volume, migration state, or external service is touched.

## Verification

Run the focused web slug and BFF tests, the PostgreSQL integration file, full
`pnpm test:integration`, exact `pnpm check`, Compose model verification, scoped
formatting, stale-text scans, security scans, and `git diff --check`. Passing
the unchanged RLS assertions is part of the Phase 11 exit, not incidental
coverage.

## Open questions

None.
