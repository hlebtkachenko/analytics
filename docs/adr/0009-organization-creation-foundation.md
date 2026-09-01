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
organization and consumes no user's quota. The Phase 8 path described below
injects creator attribution into ordinary Better Auth writes.

A BEFORE INSERT trigger takes `pg_advisory_xact_lock(hashtext(created_by))`,
reads the creator's quota, counts organizations with that exact creator, and
rejects the insert when the count is already at the granted total. It skips NULL
creators. The invoker-rights trigger function has a fixed search path, is owned
by `bap_owner`, and grants no direct execution to runtime roles.

Organization slugs use lowercase ASCII letters and digits separated by single
hyphens, are 3 through 20 characters, cannot be all digits, and cannot equal the
approved route segments. The database CHECK and shared Zod validator use the
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

Phase 8 enables Better Auth creation and configures its function-form
`organizationLimit` as a fail-closed precheck over creator-attributed rows. The
global before-hook normalizes and validates slugs before Better Auth queries;
the plugin hook validates again and injects the authenticated user id into a
`createdBy` field declared `input: false`. The creator role is explicitly
`owner`, and membership is capped at 100. The PostgreSQL trigger remains the
real race-enforcement boundary.

The installed Better Auth 1.7.2 source has 11 organization endpoints that use
active-organization fallback, rather than the plan's earlier inventory of 8. The
before-hook requires explicit `organizationId` input on the 10 endpoints that
can bind one. `get-active-member` has no id input, so the hook always rejects it
and the public router disables it. Better Auth creation and invitation
acceptance may still update stored `activeOrganizationId`, but no supported BAP
operation may consume it as an implicit selector. Public organization deletion
and active-organization mutation are disabled. General quota grants run only
through the existing migrator one-shot and require email, total, and note; the
command sets `bap_owner` locally and records a NULL auth grantor plus the
operator note.

## Consequences

Creator-attributed inserts cannot race past quota, and accepting an invitation
does not consume creation allowance. Existing and Phase 7 system-created
organizations with NULL attribution count against no user. The ordinary path is
now quota gated and creator attributed. Phase 9 adds the member-gated routing
boundary. Phase 10 adds the deliberately temporary organization browser loop.

The Better Auth precheck can race, so an insertion rejected by the trigger may
surface as a generic server failure. Disabling auth-only organization deletion
also leaves an interim ownership deadlock: a sole owner can delete neither the
organization nor their account until ownership is delegated. A cross-schema
operator purge workflow is a later milestone.

The literal reserved list advances in the same pull request as every new
top-level application route. Migration `20260831.0004` reserves `organizations`,
bringing the database and shared validator to 16 literals before that route is
published. It aborts before replacing the stable named constraint if a colliding
organization already exists. No confusable folding, `slug_key`, or reserved-slug
table is introduced here.

Phase 11 closes the decision with executable evidence: the shared web/database
corpus enumerates all 16 literals, the deterministic two-backend quota test
observes the advisory-lock waiter and exactly 1 success, and a newly created
disposable `auth.*` table executes all 4 inherited DML verbs as `bap_auth`
before the quota exception is checked as SELECT-only.

Migration compatibility is now `20260831.0004`. There is no down migration.
Rolling application code back while leaving the newer migration applied makes
every service readiness route return 503 until code expecting that exact version
is deployed or the expected version is deliberately updated.
