# Organization creation path

Date: 2026-08-31

## Problem

The Phase 7 database accepts attributed organizations only when an operator has
granted quota, but the public authentication server still disables creation and
there is no narrow operator command for changing quota. Better Auth also falls
back to a session's active organization on several routes, which is too implicit
for BAP's tenancy boundary.

## Scope

Enable quota-gated organization creation, normalize and validate slugs before
Better Auth writes identity rows, and make `created_by` authoritative. Add an
operator-only quota command using the migrator credential and a transaction that
sets the owner role locally. Require an explicit organization id on every
installed fallback endpoint that can bind one, and reject the unbindable active
member endpoint unconditionally. Disable public organization deletion and
active-organization mutation, and rate-limit public slug checks.

This phase does not add organization UI, member-management UI, routing, an
operator purge workflow, or a web-accessible quota mutation surface.

## Design

- `@bap/db` exposes a read-only limit precheck for the web process and a
  separate owner-role quota writer for the operator CLI. The precheck returns
  `null` for absent or invalid state so the auth configuration can deny with
  `?? true`.
- `organization-quota --email --total --note` validates its complete argument
  set, resolves the user by email, and replaces that user's total and provenance
  in one owner-role transaction. Its output and failures contain no database or
  credential details.
- The auth before-hook normalizes and validates create slugs before Better Auth
  performs its quota or uniqueness queries. The plugin create hook validates the
  normalized value again and injects the authenticated user id as `created_by`.
  The field is declared `input: false`, so client-supplied values are discarded.
- Better Auth's function-form `organizationLimit` returns `true` when the limit
  is reached. It counts attributed organizations through `@bap/db` and denies on
  an absent quota row, malformed result, or database failure. The Phase 7
  trigger remains authoritative when concurrent requests pass the precheck.
- The installed 1.7.2 source has eleven active-organization fallback endpoints,
  despite the plan's earlier count of eight. Ten accept and require an explicit
  `organizationId`. `get-active-member` has no bindable id input, so the hook
  always rejects it and the public router also disables it. Creation, slug
  checking, listing, and invitation-id routes remain legitimately unscoped.
- Better Auth creation and invitation acceptance may update the stored
  `activeOrganizationId`. BAP treats that state as non-authoritative: no
  supported operation may use it as an implicit organization selector.

## Security

The long-lived web role retains SELECT-only access to organization quota. Only
the operator process has the migrator credential and can set `bap_owner`
locally. Quota arguments are parameterized, and neither CLI success nor failure
reveals credentials or provider details. Public deletion and set-active routes
are disabled at both the contract guard and Better Auth router. A race rejected
by the database trigger is returned as a generic server failure rather than
being misrepresented as a deterministic precheck denial.

Organization deletion remains an operator-only gap: a sole owner cannot delete
their account until an organization is delegated, while this phase supplies no
purge command.

## Verification

Unit and configured-handler tests cover quota polarity/fail-closed behavior,
slug normalization and side-effect-free rejection, authoritative creator data,
explicit-organization enforcement, disabled routes, and the slug rate rule. CLI
tests cover exact arguments, transaction/role order, rollback, parameterization,
redacted JSON, and import safety. Configured and public handler coverage proves
the unbindable endpoint cannot dispatch, while a bindable role lookup uses its
exact explicit id rather than ambient session state. PostgreSQL integration
covers quota reads and writes, provenance, ACLs, and the trigger's authoritative
concurrent rejection. Run focused DB/web tests, full integration, `pnpm check`,
scoped Prettier, stale documentation scans, and `git diff --check`.

## Open questions

None. Phase 9 owns organization routing, Phase 10 owns product UI, and a later
operational phase must define organization purge or ownership transfer.
