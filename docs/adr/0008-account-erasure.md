# ADR 0008: Operator-tier Account Erasure

- Status: accepted
- Date: 2026-08-31

## Context

Better Auth can hard-delete browser identities, but tenant tables deliberately
have no foreign keys to `auth.user`. Their subject columns therefore survive an
identity deletion. Every `app` table uses forced row level security, `bap_owner`
cannot bypass it, and the public `bap_auth` process must not gain the ability to
rewrite the append-only audit log.

The installed Better Auth 1.7.2 delete endpoint calls `beforeDelete` and then
performs its identity deletes as separate adapter operations. It does not wrap
that sequence in one transaction. Recording an erasure request after deletion
could therefore lose the explicit subject if the recording write failed.

## Decision

Add a pending-only `auth.user_erasure_request` table containing `user_id` and
`requested_at`. It has no foreign key because it must survive the identity row.
The inherited Better Auth table grants are revoked. `bap_auth` can only execute
the fixed-search-path security-definer function
`auth.request_user_erasure(text)`, which accepts a live identity and records the
id idempotently.

Better Auth's `beforeDelete` hook refuses a user who is the only owner of at
least 1 organization. Ownership follows Better Auth's composed-role semantics:
`owner` must be an exact comma-separated token for both the subject and any
other owner. Co-owned organizations do not block deletion. The hook then records
the request before Better Auth deletes the identity. A database error fails
closed. A later deletion failure may leave a stale pending request, but that is
safe: the operator command rechecks that `auth.user` is absent and refuses a
live subject.

Disable `/admin/remove-user` in Better Auth and the public route gate. Installed
Better Auth 1.7.2 implements that Admin-plugin endpoint as a direct target-user
delete and does not call `user.deleteUser.beforeDelete`. BAP has no consumer for
it. Phase 5's inventory preserves this disable and separately disables both
impersonation paths; this decision does not add an admin flow or duplicate admin
permission logic in a global hook.

Create `bap_eraser` as NOLOGIN, passwordless, NOINHERIT, and BYPASSRLS, with no
database CONNECT. `bap_owner` may SET the role but does not inherit it. No
application role is a member. The role receives only `app` schema usage,
execution of `app.erase_user(text)`, and column-scoped SELECT and UPDATE for
`audit_log.user_id`, `data_grants.user_id`, and `dataset.created_by`.

`app.erase_user(text)` runs with invoker rights and a fixed search path. If a
target row exists, it generates 1 opaque `erased_<uuid>` unrelated to the user
id and applies it to all 3 columns. If no row remains, it returns null without
changing stored state. Tombstoning `dataset.created_by` does not remove existing
read visibility, but `dataset_is_writable` no longer recognizes a live creator.
Retained or granted datasets therefore remain unwritable until later ownership
or delegation work.

`erase-user <user-id>` runs only through the migrator credential. In 1
transaction it sets `bap_owner`, locks the exact pending request, rejects a live
identity, sets `bap_eraser`, invokes the app function, returns to owner, deletes
the request, and commits. Failure rolls back both app updates and request
consumption. Output is JSON and failures do not include database details. No
orphan sweep exists.

Better Auth deletion is enabled with a 5-minute session freshness window. The
endpoint still accepts a sufficiently fresh session without a password, so it is
not described as password-protected. The `/account` UI always submits the
current password. Password change uses Better Auth's existing endpoint and its
built-in 3-per-10-second rule, including the existing `revokeOtherSessions`
option.

## Consequences

The web process can request erasure but can neither access the `app` schema nor
perform it. The operator cannot erase a live, unrequested, or different id.
Successful completion leaves no request row or raw-id-to-tombstone mapping. Sole
owners must delete or delegate their organizations first; organization deletion
itself remains outside this phase.

This is GDPR-shaped erasure, not complete GDPR compliance. User ids can remain
inside `app.audit_log.metadata`, `auth.rate_limit`, `auth.verification`, and
pg-boss job payloads. Access and portability workflows are also absent.

This decision introduced migration `20260831.0002`; the current compatibility
identifier is `20260831.0004` after the organization-route reservation. There is
no down migration. Rolling application code back while leaving a newer migration
applied makes every service readiness route return 503 until code expecting that
exact version is deployed again or the expected version is deliberately updated.
