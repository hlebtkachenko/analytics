# Inbox Runtime (Phase 1b-runtime)

**Date:** 2026-09-17

## Problem

After Phase 1a-email the Inbox receives from three channels, but every routing
default is a code constant nobody can change
(`apps/api/src/inbox/routing-targets.ts:17-42`, read by no runtime caller), the
blob quota is one platform number for every organization
(`apps/api/src/runtime-configuration.ts:8,62-64`), and nothing cleans up after a
crash: a blob whose rows failed to commit stays on the volume, a parent stuck
`processing` by a crash on the last attempt never fails
(`apps/api/src/worker/split-email-item.ts:318-319,701-721`), and an email item
whose `split_email_item` enqueue failed after commit stays `received` forever
(`apps/api/src/inbox/inbox.service.ts:410-425`, the open question of
[1a-email](2026-09-17-inbox-email-channel.md)). A discard also records no
decider: `discardItem` is a bare status transition
(`apps/api/src/inbox/inbox-repository.ts:1087-1098`), so a channel could later
overwrite a person's discard, which ADR 0015 forbids.

Phase 1b is the core of the Inbox, delivered as three stacked PRs: 1b-runtime
(this spec), 1b-rules (`app.inbox_rule`, auto-route as the rule author,
`app.inbox_correction`, create-a-rule-from-this, own spec) and 1b-actions
(Split, versioning route, fingerprint duplicates, attach-to-existing, bulk
actions, `pnpm demo:inbox`, own spec). Every connector and every setup feature
after that is one small PR on the "Connections and setup" track of
[the plan](../../docs/planning/inbox.md).

## Scope

- Migration `20260917.0004_inbox_runtime.sql`: `app.inbox_routing_target`,
  `app.organization_inbox_setting`, three maintenance definer functions and
  their `bap_owner` policies, the `stalled` event reason, erasure and grants,
  compatibility bump.
- API: routing target and setting routes, the effective target on the item
  detail, the per-organization quota in the intake gate, `discardItem` and
  `restoreItem` provenance.
- Worker: the scheduled `inbox_maintenance` job with the orphan sweep, the
  reaper and the requeue.
- Web: `/inbox/settings` inside the product shell, BFF routes and Zod mirrors.
- Not here: rules, auto-route, corrections (1b-rules); Split, versioning,
  fingerprints, attach, bulk (1b-actions); ARES, AI, OCR, any connector, the
  credential vault, retention, channel health, `poll_channels` and
  `list_due_channels` (connections and setup track).

## Design

Migration. `app.inbox_routing_target`: `id`, `organization_id`, `detected_type`
(`~ '^[a-z][a-z0-9_]{0,63}$'`), `destination` (check `documents`, `datasets`,
`discard`), `document_kind` (nullable, check: not null exactly when
`destination = 'documents'`), `default_legal_entity_id` (nullable composite FK
to `legal_entity(id, organization_id)`, `ON DELETE SET NULL`), `partner_policy`
(check `match_only`, default `match_only`), `auto` (check `never`,
`above_threshold`, `always`, default `never`), `auto_threshold` (`numeric(3,2)`
nullable, between 0 and 1, check: not null when `auto = 'above_threshold'`),
`default_assignee_id` (nullable text, no FK to `auth`), `required_fields`
(`text[]`, default `'{}'`, no null element, at most 32), `created_by` default
`current_setting('bap.user_id', true)`, `created_at`, `updated_at`,
`updated_by text not null default current_setting('bap.user_id', true)`,
refreshed on every PUT: 1b-rules runs a target-default auto-route as the account
that saved the row, so the row must say who that was;
`unique (organization_id, detected_type)`; no `jsonb`. FORCE RLS with the
per-command pattern of `inbox_channel`
(`packages/db/drizzle/20260917.0001_inbox_channels.sql:272-307`): SELECT by
organization `AND NOT app.role_is_channel()`, INSERT with the `created_by`
check, UPDATE and DELETE all `app.role_can_write()`; the owner-only rule is the
API permission. The effective target for a type is the organization row when
present, else `ROUTING_TARGET_DEFAULTS` (lazy override, no seeding migration:
seeding every organization would copy a constant into thousands of rows and pin
future default changes). `RoutingTarget` in `routing-targets.ts` gains
`destination: 'discard'`, `partnerPolicy`, `threshold`, `defaultLegalEntityId`,
`defaultAssigneeId` and `requiredFields`;
`routingTargetFor(detectedType, overrides)` merges the loaded rows over the
constant. `partner_policy` and `destination` hold only the values this PR
consumes: `partner_policy` is `match_only` alone, and `destination` is
`documents`, `datasets` and `discard`. The ARES and partner-route PRs on the
connections track widen the checks when they land, adding `upsert_from_ares` and
`partners` respectively. `auto = 'above_threshold'` and `always` are stored and
shown now and consumed only by the 1b-rules auto-route (`auto` keeps its full
`never | above_threshold | always` vocabulary because 1b-rules is next in the
stack); until then the settings page marks them "takes effect with rules".
1b-rules never enqueues an automatic route for an invoice kind in 1b, whatever
the target's `auto` value, and records the reason on the item's extraction row.

`app.organization_inbox_setting` is a new one-row-per-organization table
(`organization_id text primary key`, `blob_quota_bytes bigint` nullable,
positive, `created_by` default from the setting, `created_at`, `updated_at`). No
per-organization app settings row exists to extend: `auth.organization_quota`
(`20260831.0003_organization_creation.sql:2`) counts organizations per user, and
`auth.platform_setting` is platform-wide. Policies: SELECT by organization
without the channel exclusion, because the intake gate runs inside the channel's
own transaction (`inbox-repository.ts:563-570`) and inside the split job
(`apps/api/src/worker.ts:171`) under the channel role, and the row carries one
number and no tenant content; INSERT and UPDATE `app.role_is_owner()`; no DELETE
policy (the row is reset by nulling the column). The effective quota is
`least(blob_quota_bytes, BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION)`: the
environment value is both the platform default and the cap, so an owner can only
tighten. `receiveIntake` and the split's child blob path read the row in their
transaction and gate against the effective value; `QuotaExceededError` and the
413 are unchanged.

Maintenance. Three `SECURITY DEFINER` functions owned by `bap_owner` with the
fixed search path of `app.record_blob_scan`
(`20260917.0003_inbox_email.sql:30-65`), EXECUTE to `bap_api` because the worker
connects as `bap_api` (`apps/api/src/worker.ts:43`) and ADR 0005 adds no
database role. Each raises `insufficient_privilege` when
`current_setting('bap.organization_id', true)` is set, the inverse of the
`record_blob_scan` guard: every API request and every channel job runs inside a
tenant transaction, so none of them can reach these functions; only the
organization-less worker tick can. `reap_stalled_inbox_items` and
`list_stuck_email_items` take `(stale interval, max_rows int)` and return ids
only; `list_blob_keys` takes `(organization_id uuid, sha256s text[])` and
returns the subset of hashes that already have a `blob` row, so the worker never
deletes a row and only ever asks about hashes it already suspects. FORCE RLS
applies to `bap_owner`, so the migration adds `TO bap_owner USING (true)`
policies in the shape of `inbox_channel_maintenance_select`
(`20260917.0001_inbox_channels.sql:309`): SELECT on `inbox_item` and `blob`,
UPDATE on `inbox_item`, INSERT on `inbox_event`. No policy touches
`inbox_item_file` or `document_file`, and there is no DELETE policy on `blob`:
both existed only for the row sweep this spec replaces.

- `app.list_blob_keys(organization_id uuid, sha256s text[])`: the same guard as
  the other two functions (raises when `bap.organization_id` is set). The orphan
  this spec targets is not a blob row: a blob row and its `inbox_item_file` row
  commit in one transaction (`inbox-repository.ts:572-637`), both blob foreign
  keys are `ON DELETE RESTRICT` (`20260916.0001_inbox.sql:196,291`), and no
  production path deletes item, file or blob rows, so `app.blob` never holds an
  unreferenced row. The real orphan is the untracked file: the rename into the
  content-addressed path (`inbox-repository.ts:697`) followed by a failed commit
  leaves bytes on the volume with no row at all. The worker tick lists
  `org/<organization_id>/` directories under `BAP_BLOB_STORAGE_DIR`, and for
  each file whose mtime is older than 60 minutes calls `list_blob_keys` with its
  `(organization_id, sha256)`; a file whose hash comes back missing is unlinked,
  bounded to `max_files` per organization per tick (`max_files = 1000`). The
  mtime threshold is the race guard: an in-flight `put()` renames and commits
  within seconds, so a file younger than 60 minutes is never touched and no
  advisory lock is needed. `BlobStore` gains
  `listStale(organizationId, olderThan)`, returning the stale file paths and
  hashes for one organization, and `unlink(key)`; there is no
  `BlobStore.delete(key)` and no "row goes first" ordering, because no row is
  ever deleted. ADR 0016 sketched this sweep as a read-only `system_sweep`
  subject walking directories; the delivered shape keeps that walk in the worker
  with `list_blob_keys` as its only database contact, drops the row-deleting
  definer an earlier draft of this spec described, and needs no retention
  follow-up for the walk itself; the ADR is amended with this spec.
- `app.reap_stalled_inbox_items(stale, max_rows)`: sets `status = 'failed'` on
  `inbox_item` rows in `processing` with `updated_at < now() - stale` and
  appends an `inbox_event` with `kind = 'failed'`, `reason = 'stalled'`,
  `actor_user_id` null (the column is nullable, `20260916.0001_inbox.sql:250`);
  `stalled` is added to `inbox_event_reason_check` and `inboxEventReasons`. The
  split job touches `inbox_item.updated_at` at the start of every attempt
  (`updated_at` is otherwise touched only on `received -> processing`,
  `split-email-item.ts:318-320`), so the reaper's clock starts at attempt one: 4
  attempts x 900 second pg-boss expiration plus 3 x 60 second retry delay is 63
  minutes, which a 60 minute `stale` does not exceed, and pg-boss expiry does
  not abort an in-process handler. `stale` for the reaper stays 60 minutes and
  is a floor inside the function (any smaller argument is raised to 60 minutes).
  Because a reaped item can still be owned by a running handler, the split's
  terminal status update becomes conditional `and status = 'processing'` so a
  reaped (`failed`) item is never resurrected to `needs_review`: today
  `setStatus` at `split-email-item.ts:438` is unconditional and
  `inbox_item_channel_update` (`20260917.0001_inbox_channels.sql:356-370`)
  admits `failed`. A reaped parent keeps its children.
- `app.list_stuck_email_items(stale, max_rows)`: returns `item_id`,
  `channel_id`, `organization_id` for `inbox_item` rows with
  `payload_kind = 'email'`, `status = 'received'`, `parent_item_id` null,
  `received_at < now() - stale`, on an enabled undeleted channel; `stale` for
  the requeue stays 10 minutes and is a floor inside the function (any smaller
  argument is raised to 10 minutes), far past the post-commit enqueue and the 60
  second retry delay. The worker enqueues `split_email_item` for each with the
  1a-email options and `singletonKey = itemId`. pg-boss 12.28.1 ignores
  `singletonKey` on a `standard` queue: the unique indexes it relies on are
  policy-scoped
  (`node_modules/.pnpm/pg-boss@12.28.1/node_modules/pg-boss/dist/plans.js:642-665`),
  and both queue creators pass only `{ partition: false }` today
  (`apps/api/src/worker.ts:88`, `apps/api/src/inbox/inbox-queue.ts:70`). This
  spec creates `split_email_item` and the new `inbox_maintenance` queue with
  `policy: 'exclusive'` in both creators, which admits at most one job per
  `singletonKey` across `created`, `retry` and `active`; the 1a-email comment at
  `inbox-queue.ts:12` is corrected to say so. Without this the tick would add a
  job per still-received item every 15 minutes, and two worker replicas could
  split the same item concurrently (`split-email-item.ts:311-316` admits
  `processing`, not only `received`). The integration suite proves a second
  enqueue with the same key is dropped against a real pg-boss.

One queue `inbox_maintenance` (`INBOX_MAINTENANCE_QUEUE` in
`apps/api/src/inbox/contract.ts`), created beside the others in
`apps/api/src/worker.ts:85-88` with `policy: 'exclusive'` and scheduled there
with `queue.schedule` on `*/15 * * * *` UTC,
`singletonKey = 'inbox_maintenance'`, `expireInSeconds` 600, `retryLimit` 0,
`localConcurrency: 1`. `QUEUE_MAINTENANCE_OPTIONS` already turns `schedule` on
(`apps/api/src/worker/queue.ts:11-19`) and nothing calls `schedule` yet, so this
is the platform's first cron. The payload is an empty strict object; it does not
join `jobPayloadSchema` (`apps/api/src/worker/job-context.ts:38-41`) and never
goes through `runTenantJob`, because it has no tenant and opens no tenant
transaction. Each task is capped at 500 rows per tick, runs in its own
statement, and a failing task logs and lets the next one run. Metrics:
`recordJob` with the queue label only. Logs: one line per tick with three counts
and the ids at debug level; never a storage key, filename or organization name.

Provenance. `discardItem` (`inbox-repository.ts:1087`) leaves `transition` and
sets `status = 'discarded'`, `decided_by_kind = 'user'`,
`decided_by_user_id = current user` in the same update as the event;
`restoreItem` clears both back to null with `status = 'needs_review'`. The
`inbox_item_channel_update` policy then refuses a channel job on a discarded
item, which is the ADR 0015 guardrail the transition was missing.

API. `GET /v1/organizations/:organizationId/inbox/routing-targets` returns the
effective target per `DETECTED_TYPES` entry with `source` (`platform` or
`organization`); `PUT .../routing-targets/:detectedType` upserts the row and
carries the full target, not a partial patch: the form is prefilled from the
effective target, so a one-field edit never resets `required_fields` back to
`'{}'`; `DELETE .../routing-targets/:detectedType` removes it, back to the
platform default. `GET .../inbox/settings` returns `blobQuotaBytes`,
`platformQuotaBytes` and `usedBytes`; `PATCH .../inbox/settings` sets or nulls
`blobQuotaBytes`, 422 above the platform cap. Reads require `manageDocuments`,
writes `manageOrganization`, the owner-only capability of
`packages/security/src/access-contract.ts:158-161` (`manageMembers` is not the
line: settings, not people). Every write records `app.record_audit` with the
type and ids. `GET .../inbox/items/:itemId` gains `routingTarget`, the effective
target of the item's detected type, and the prefilled draft defaults its kind
from it, so the setting is visible on an item the day it lands.

Web. `apps/web/src/app/(product)/inbox/settings/page.tsx` renders
`PageContainer` with a `DataGrid` of the ten detected types (destination, kind,
default entity, auto policy, threshold, assignee, source) and an edit modal,
plus the quota field with the platform cap and current use. Each row shows a
line of copy next to the `auto` control: "Automatic routing runs under the
account that saved this row." For a target whose `document_kind` is an invoice
kind (`INVOICE_KINDS`, `apps/api/src/documents/contract.ts:614-617`; today only
`isdoc_invoice` defaults to `received_invoice`,
`apps/api/src/inbox/routing-targets.ts:31-35`) the copy says instead that
automatic routing waits for the ISDOC parser on the connections track, because
`createDocumentRequestSchema` refuses an invoice kind with no `invoice` block
(`apps/api/src/documents/contract.ts:639-644`); the `auto` control itself stays
editable so the setting is ready when that PR lands. Reached from `/inbox`
through a link beside the existing channels link
(`apps/web/src/app/(product)/inbox/page.tsx:210`), no rail change; `settings` is
a child of the reserved `inbox` segment, so `reservedOrganizationSlugs` is
untouched and `breadcrumb-trail.ts:22` gains `settings: 'Settings'`. Owners see
the edit controls; everyone with inbox access reads. BFF functions
`getInboxRoutingTargets`, `putInboxRoutingTarget`, `deleteInboxRoutingTarget`,
`getInboxSettings` and `patchInboxSettings` follow `getInboxChannels`
(`apps/web/src/lib/auth/bff.ts:2137-2161`) with Zod mirrors in
`apps/web/src/lib/inbox/contract.ts`. `inboxEventReasonSchema`
(`apps/web/src/lib/inbox/contract.ts:98-112`) is a closed `z.enum`, so `stalled`
is added there too, or a reaped item's event carries a reason the item detail
response fails to parse. The `[orgSlug]/settings` route belongs to another stack
and is not touched.

Erasure and grants. `inbox_routing_target.default_assignee_id`,
`inbox_routing_target.created_by`, `inbox_routing_target.updated_by` and
`organization_inbox_setting.created_by` join `app.erase_user` and the
`bap_eraser` column grants (ADR 0008). Both tables:
`SELECT, INSERT, UPDATE, DELETE` to `bap_api`, `SELECT` to `bap_reporting` and
`bap_backup`. `DATABASE_MIGRATION_COMPATIBILITY`
(`packages/db/src/access.ts:39`) becomes `20260917.0004`.

## Security

A channel principal reads `organization_inbox_setting` (one integer) and nothing
else new: `inbox_routing_target` excludes it on SELECT like every non-inbox
table, and no write policy names `app.role_is_channel()`. The maintenance
functions are reachable only from the organization-less worker tick: the API
never calls them; `resolveMembership` runs on the pool without a tenant context,
so the guard is the function's own check, not the connection, and the channel
job never opens one either. They touch `inbox_item` status, one event row and a
read-only check of `blob` existence, and return ids or hashes, never bytes. The
worker only unlinks a file on the volume it already listed and whose mtime
cleared the grace period; it deletes no database row and takes no advisory lock.
The quota setting can only tighten the platform cap. Owner edits are audited
with ids and enum values; nothing on this page is tenant content. Payloads stay
ids only; the maintenance payload is empty.

## Verification

- `packages/db` integration: migration applies; the routing target unique key
  and every check; a member cannot write either table; a channel context cannot
  read `inbox_routing_target` and can read `organization_inbox_setting`; the
  three functions raise inside a tenant transaction, run across organizations
  outside one, `list_blob_keys` returns only the hashes that already have a row
  and omits the rest, `reap_stalled_inbox_items` skips a fresh `processing` row
  and writes the `stalled` event with a null actor, the split job's terminal
  status update is rejected by the conditional `and status = 'processing'` check
  once the item has been reaped, `list_stuck_email_items` skips a disabled
  channel and a child item; erasure of the four columns; `bap_reporting` reads
  both tables.
- `apps/api` unit and integration: effective targets merge one organization row
  over the constant; a threshold is required for `above_threshold`; quota above
  the cap 422; an upload past a tightened quota 413 while the platform cap alone
  admits it; the split's child blob obeys the tightened quota; discard sets and
  restore clears the two provenance columns; a channel job cannot update a
  discarded item; the item detail carries `routingTarget`; writes need
  `manageOrganization`; OpenAPI.
- Worker: the tick runs all three tasks when the first throws; the orphan sweep
  proves an untracked file older than the grace period is removed, a younger one
  is kept, and a file with a `blob` row is kept; the requeue sends with
  `singletonKey = itemId` and the 1a-email retry options, and a second enqueue
  with the same key while the queue holds a `created`, `retry` or `active` job
  is dropped; the schedule is registered once with the cron and singleton key;
  metrics and log lines carry counts and ids only.
- `apps/web` unit: settings page renders the ten rows and hides edit controls
  for a non-owner; BFF mirrors for the five functions; breadcrumb label; the
  link from `/inbox`.
- `pnpm check` locally; `pnpm test:integration` in CI.

## Open questions

None. The retention PR on the connections and setup track owns only what a
discarded item's bytes become; the walk of untracked files ships with this spec.
