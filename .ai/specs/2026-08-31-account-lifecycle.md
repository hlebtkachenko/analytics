# Account Lifecycle

## Problem

Signed-in users cannot change their password or delete their account from BAP.
Identity deletion also leaves subject identifiers in tenant tables, while the
web database role must never gain access to the `app` schema or the ability to
rewrite audit history.

## Scope

Enable Better Auth account deletion with a 5-minute fresh-session window, while
the account page always submits the current password. Refuse deletion for a sole
organization owner, expose password change with optional revocation of other
sessions, and add a deliberately plain account page. Record an explicit pending
user id before identity deletion and provide an operator-only CLI that
anonymizes its 3 documented app columns and consumes that request atomically.
Disable the unused Admin-plugin deletion path that bypasses this lifecycle. This
does not add organization deletion or delegation, an admin UI, broader
Admin-plugin inventory, data access or portability, or complete GDPR erasure.

## Design

Migration `20260831.0002` adds pending-only
`auth.user_erasure_request(user_id, requested_at)`. The table intentionally has
no foreign key, because the request must survive deletion of `auth.user`.
Inherited `bap_auth` table access is revoked. The only web write surface is the
fixed-search-path security-definer function
`auth.request_user_erasure(user_id)`, which accepts only a currently live
identity and records idempotently.

Better Auth's `beforeDelete` hook first counts organizations in which the user
is the only owner, recognizing `owner` as an exact comma-separated role token,
then records the request. Any read or write failure aborts deletion. Better Auth
1.7.2 does not wrap the hook and identity deletes in one transaction. Recording
first is therefore the crash-safe order: a failed later delete can leave a stale
pending request, but the operator command always locks the exact request and
refuses while that identity remains live.

Installed Admin-plugin `/admin/remove-user` deletes a target directly without
calling `user.deleteUser.beforeDelete`. BAP has no consumer, so the path is
disabled in both the configured auth handler and public route gate. Phase 5's
inventory preserves that disable and separately disables both impersonation
paths; this phase adds no admin flow.

`bap_eraser` is a NOLOGIN, passwordless, NOINHERIT, BYPASSRLS role with no
database CONNECT. Only `bap_owner` can SET it, without inherited privileges.
`app.erase_user(user_id)` runs as the invoker with a fixed search path and
generates one opaque `erased_<uuid>` only when at least 1 target row exists. It
applies that value to `app.audit_log.user_id`, `app.data_grants.user_id`, and
`app.dataset.created_by`. Direct repeats leave stored state unchanged. The role
has only schema usage, function execution, predicate-column reads, and updates
to those 3 columns. A retained or granted dataset can remain readable after its
creator is tombstoned, but `app.dataset_is_writable` no longer recognizes a live
creator, so it remains unwritable until later ownership or delegation work.

`erase-user <user-id>` connects as `bap_migrator`, starts 1 transaction, sets
`bap_owner`, locks the exact pending request, checks that `auth.user` is absent,
sets `bap_eraser` for app erasure, returns to owner, deletes the request, and
commits. Any failure rolls back both anonymization and request consumption. The
CLI emits JSON only and redacts failures.

The account route is a Server Component that reads the session and passes only
the email to a minimal Client Component. That component calls Better Auth's
existing `changePassword`, `deleteUser`, and `signOut` client methods. It always
sends the deletion password and offers `revokeOtherSessions` for password
changes. The page uses semantic HTML only, with generic accessible status and
error messages.

## Security

`bap_auth` keeps zero `app`-schema access. `bap_api` cannot execute erasure and
retains no UPDATE privilege on `app.audit_log`. A web compromise can record a
request but cannot anonymize app records, and the operator command cannot erase
a live or unrequested id. Identifiers may still survive in
`app.audit_log.metadata`, `auth.rate_limit`, `auth.verification`, and pg-boss
payloads. No access or portability workflow is included, so this feature must
not be described as complete GDPR compliance.

## Verification

Database integration tests cover role attributes and ACLs, auth-row cascades,
sole-owner counting, request access, explicit-id erasure, idempotency, live and
unrequested refusals, and service-role denial. CLI tests cover arguments, role
transitions, request consumption, rollback, JSON-only output, and redaction. Web
tests cover the fail-closed deletion hook, 5-minute freshness configuration,
composed ownership roles, disabled admin removal through the configured HTTP
handler and public gate, session gating, exact client calls, deletion password
submission, session revocation, sign-out, and generic accessible failures. Run
focused database and web tests, both workspace gates, Docker-backed integration,
`pnpm check`, stale documentation scans, scoped Prettier, and
`git diff --check`.

## Open questions

None.
