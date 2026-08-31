# ADR 0009: Organization Creation Foundation

- Status: accepted
- Date: 2026-08-31

## Context

Better Auth stores organizations, memberships, and invitations, but its base
schema does not attribute an organization to its creator or enforce a BAP
creation quota. Counting every organization a user belongs to would make
accepted invitations consume that user's creation allowance. A check followed by
an insert would also permit concurrent requests to exceed a quota.

Tables created by `bap_owner` in schema `auth` inherit full Better Auth DML for
`bap_auth`. That default is too broad for a quota grant table. At the same time,
the interactive owner bootstrap and operational synthetic-account command need
an initial allowance before their server-side Better Auth organization call.
Long-lived web must not receive the migrator credential, and `bap_auth` must not
receive a quota writer.

## Decision

Migration `20260831.0003` adds `auth.organization_quota`, keyed to `auth.user`.
An absent row means zero. The migration revokes all inherited `bap_auth` table
privileges and returns SELECT only; `bap_backup` also retains SELECT. Quota
grants remain owner-tier writes.

`auth.organization.created_by` is nullable and references `auth.user` with
`ON DELETE SET NULL`. NULL identifies an unattributed legacy or system-created
organization and consumes no user's quota. Phase 7 does not yet enable the
public creation path or inject creator attribution into Better Auth writes.

A BEFORE INSERT trigger takes `pg_advisory_xact_lock(hashtext(created_by))`,
reads the creator's quota, counts organizations with that exact creator, and
rejects the insert when the count is already at the granted total. It skips NULL
creators. The invoker-rights trigger function has a fixed search path, is owned
by `bap_owner`, and grants no direct execution to runtime roles.

Organization slugs use lowercase ASCII letters and digits separated by single
hyphens, are 3 through 20 characters, cannot be all digits, and cannot equal the
15 approved route segments. The database CHECK and shared Zod validator use the
same literal contract. The normalizer lowercases, converts unsupported runs to
one hyphen, trims edge hyphens, and truncates deterministically. It does not
invent alternative names for reserved, numeric, empty, or short candidates.

New or changed membership and invitation roles are limited to scalar `owner`,
`admin`, or `member`. The checks are `NOT VALID`, so a historical composed or
invalid value does not block migration. Access resolution treats any such value
as no membership instead of throwing.

Both setup commands validate the normalized slug before creating a user or
quota. After a user exists, a narrow `@bap/db` accessor connects as
`bap_migrator`, starts 1 transaction, sets `bap_owner` locally, and changes only
an absent or zero quota to the minimum 1. New or raised rows record
`system-bootstrap: initial organization`; an existing quota of 1 or more and its
provenance are unchanged. The migrator pool closes before Better Auth creates
the organization.

Only the profiled one-shot bootstrap service receives both the auth and migrator
credential mounts. The operational synthetic command runs as a command override
of that service. Long-lived web receives neither the migrator path nor its
secret, and no quota-write function is executable by `bap_auth`.

## Consequences

Creator-attributed inserts cannot race past quota, and accepting an invitation
does not consume creation allowance. Existing and Phase 7 system-created
organizations with NULL attribution count against no user. Phase 8 must inject
`created_by`, enable the approved creation path, and add the general quota grant
CLI; this decision does none of those tasks. Phase 9 routing remains separate.

The literal reserved list must advance with new route segments in the later
routing phase. No confusable folding, `slug_key`, or reserved-slug table is
introduced here.

Migration compatibility advances to `20260831.0003`. There is no down migration.
Rolling application code back while leaving this migration applied makes every
service readiness route return 503 until code expecting that exact version is
deployed or the expected version is deliberately updated.
