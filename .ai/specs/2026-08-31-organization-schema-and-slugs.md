# Organization Schema and Slugs

## Problem

BAP has Better Auth organization tables but no durable creator attribution,
creation quota, database slug contract, or safe shared slug normalizer. The web
login role must not gain a quota-escalation path while the two trusted setup
commands still need to create their initial organization.

## Scope

Add the organization quota table, creator attribution, slug and scalar-role
constraints, an atomic quota trigger, a shared web slug module, and safe setup
CLI preparation. This phase does not enable public organization creation, add
the Phase 8 quota administration CLI, add organization routing or UI, introduce
confusable folding or `slug_key`, or change organization deletion policy.

## Design

Migration `20260831.0003` adds nullable `auth.organization.created_by`,
referencing `auth.user` with `ON DELETE SET NULL`. NULL means a legacy or
system-created organization, is attributed to no user, and consumes no user's
quota. `auth.organization_quota` stores one row per user with a non-negative
total, optional granting user, timestamp, and note; absence means zero. Better
Auth's inherited auth-table DML is explicitly revoked, then only SELECT is
returned to `bap_auth`.

Stable CHECK constraints pin slugs to 3-20 lowercase ASCII letters, digits, and
single internal hyphens, reject all-digit values, and initially rejected the 15
approved literal route segments. Phase 10's forward migration added
`organizations`, so the current database and shared contracts reject 16. Member
and invitation roles accept only `owner`, `admin`, or `member`; they are added
`NOT VALID` so existing composed or otherwise invalid legacy rows do not block
deployment, while every new or changed row is constrained. Membership resolution
uses `safeParse` and returns null for a legacy invalid role.

A fixed-search-path, invoker-rights BEFORE INSERT trigger skips NULL creators.
For an attributed creator it takes
`pg_advisory_xact_lock(hashtext(created_by))`, reads the quota, counts existing
organizations attributed to that user, and rejects insertion when the count is
already at the granted total. The function is owned by `bap_owner`; PUBLIC
execution is revoked and no service receives direct execution.

`apps/web/src/lib/organizations/slug.ts` exports the exact reserved list, a Zod
validator, and a deterministic lowercase/hyphen normalizer that truncates to the
database limit without leaving a trailing hyphen. Reserved, numeric, empty, or
too-short candidates remain validation failures instead of being silently
renamed.

The setup CLIs validate and normalize before creating a user. After a user id is
known and before calling Better Auth organization creation, they use a narrow
`@bap/db` accessor through a separate `bap_migrator` connection to ensure an
initial quota of 1 under one transaction and `SET LOCAL ROLE bap_owner`. It
raises only an absent or zero row, records system-bootstrap provenance for that
new grant, and never reduces or rewrites an existing quota or provenance at 1 or
higher. The migrator pool closes before organization creation. The extra
credential is mounted only into the existing one-shot bootstrap service.
Operational synthetic setup runs that service with a command override instead of
executing inside long-lived web. Long-lived web remains `bap_auth` only, and no
`bap_auth`-executable quota writer exists.

## Security

`bap_auth` can inspect its quota dependency but cannot insert, update, delete,
or bypass the trigger. API and reporting roles receive no quota access. The
one-shot helper never logs credentials, passwords, email input, or database or
provider/database details. Quota seeding is deliberately fixed to the setup
commands' initial total and is not a general grant interface. Compose checks
prove long-lived web has neither the migrator environment path nor secret mount,
while the profiled one-shot alone has both auth and migrator credential
boundaries.

## Verification

PostgreSQL integration covers exact columns, constraints, FKs, trigger/function
catalog state and ACLs, NULL attribution, quota absence and positive quota,
deterministic concurrent quota-1 insertion, service-role denial, and slug
rejection. A shared table-driven corpus proves database/Zod parity and now
enumerates every current reserved route. The suite also executes the inherited
SELECT, INSERT, UPDATE, and DELETE privileges on a newly created disposable
`auth.*` table before proving the quota exception. Unit tests cover
normalization, legacy invalid membership, migrator role transitions and
rollback, and both actual CLI entrypoints' validation and seed-before-create
ordering. Run focused database/web/CLI tests, PostgreSQL 18 integration, Compose
model and operational proof after the one-shot workflow change, `pnpm check`,
Prettier, stale scans, and `git diff --check`.

## Open questions

None.
