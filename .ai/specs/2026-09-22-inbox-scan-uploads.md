# Inbox scan of direct uploads and API-channel blobs

**Date:** 2026-09-22

## Problem

Only the email split scans blobs. `split-email-item.ts` is the sole caller of
`app.record_blob_scan`. A direct upload (`channelKind = 'upload'`) and an API
push (`channelKind = 'api'`) store their blob `not_scanned`, enqueue the route
job at once, and `openBlob` refuses only `infected` and `failed`, so an
unscanned file is downloaded, previewed and auto-routed into a document.

## Scope

- A `scan_inbox_item` worker job that scans the blobs of an upload or API item
  and routes it afterwards.
- The intake enqueues that job instead of the route job while a blob is
  unscanned.
- `openBlob` refuses `not_scanned` with 409 `blob_scan_pending`.
- The maintenance tick resends a lost scan job.
- The item page shows a scan-pending indicator instead of the preview and the
  download link.
- Out: email items (the split already scans them), a scan of blobs that arrived
  before this change other than through the maintenance sweep, rescanning a
  `clean` blob after a signature update, a per-organization scan setting.

## Design

Contract. `SCAN_INBOX_ITEM_QUEUE = 'scan_inbox_item'` and
`scanInboxItemJobSchema` join the split and route jobs in
`apps/api/src/inbox/contract.ts`. The payload is ids only (ADR 0005) and one of
the two principals `runTenantJob` knows: `{ organizationId, userId, itemId }`
for an upload, `{ organizationId, channelId, itemId }` for an API push.
`job-context.ts` gains `scanInboxItemJobPayloadSchema` (the tenant payload plus
`itemId`) in `jobPayloadSchema`; the channel member already accepts an optional
`itemId`. The queue is registered in `INBOX_QUEUES` with the split's exclusive
policy, `retryLimit: 3`, `retryDelay: 60` and `singletonKey = itemId`.

Intake. `InboxService.receive` enqueues `scan_inbox_item` instead of
`result.routeJob` when the channel kind is `upload` or `api` and the item stored
a file whose `scanStatus` is `not_scanned`. A duplicate shares the blob row of
the item that first carried it, so its blob is already `clean` and the item is
already `discarded`; nothing is enqueued. An email item is untouched. A failed
enqueue logs and leaves the item in review, the same as the route enqueue, and
the maintenance sweep recovers it.

Worker. `apps/api/src/worker/scan-inbox-item.ts` mirrors the split: it loads the
item and its `not_scanned` blobs under `runTenantJob`, completes with nothing
done when the item is not `received` or `needs_review`, and scans each blob
through the shared `ClamdClient`. `clean` records the verdict through
`app.record_blob_scan` with a `scanned` event; `infected` records the verdict,
sets the item `discarded` guarded on the status it loaded, appends the
`discarded` event with reason `policy_rejected` and stops; `error` throws so
pg-boss retries, and on the last attempt records `failed` for that blob with its
`scanned` event and completes. When every blob is `clean` the handler re-reads
the route decision the intake already took, through the new `routeJobForItem` in
`inbox-repository.ts` (the read-only tail of `applyInboxRules`: the newest rule
extraction names the rules that matched, so the auto-route rule, the composed
draft and `decideAutoRoute` are re-derived without writing a second extraction
row), and sends it through `enqueueRouteInboxItem`. `recordScan` and the guarded
status update move to `apps/api/src/worker/blob-scan.ts` so the split and the
scan share them. The worker registers the queue next to the split with
`localConcurrency: 2`, sharing the `blobs` and `scanner` instances.

Reads. `openBlob` is the only gate in front of both blob routes: it now refuses
every status other than `clean`, with 409 `blob_scan_pending` for `not_scanned`
and the existing 409 `blob_quarantined` for `infected` and `failed`. The BFF
blob route reads the upstream `code` and passes `blob_scan_pending` through.

Maintenance. Migration `20260922.0009_inbox_scan_sweep.sql` adds
`app.list_unscanned_inbox_items(stale interval, max_rows integer)`, a
`SECURITY DEFINER` function owned by `bap_owner` with EXECUTE to `bap_api`, the
shape of `app.list_stuck_email_items`: it raises `insufficient_privilege` inside
a tenant context and returns the `upload` and `api` items still `received` or
`needs_review` past the same 10 minute window with a `not_scanned` blob,
skipping an item whose channel is disabled or deleted. It also adds
`inbox_item_file_maintenance_select`, because `FORCE` row level security applies
to the definer and no policy admitted `bap_owner` to the item to blob link yet;
SELECT only, the shape of `blob_maintenance_select`.
`DATABASE_MIGRATION_COMPATIBILITY` becomes `20260922.0009`. The maintenance tick
gains a fourth task that resends `scan_inbox_item` for each row; the exclusive
queue drops a duplicate.

Web. `isBlobScanPending` joins `isBlobQuarantined` in
`apps/web/src/lib/inbox/contract.ts`. The item page renders a neutral
`StatusIndicator` labelled `inbox.scanPending` in place of the preview frame and
of the per-file download link while a file is pending.

## Security

No new principal and no new boundary. The scan job runs as the uploader
(membership re-resolved at dequeue, a demoted subject fails before any
transaction) or as the channel principal, the same two contexts the intake ran
in. The verdict is still written only through `app.record_blob_scan`, which is
already granted to `bap_api`; nothing new is granted. The new definer is
organization-less like the other three maintenance functions and returns
identifiers only. No file content, filename or storage key reaches a log line or
`inbox_event`; the job payload carries identifiers only, because `pgboss.job` is
cross-tenant readable. The change closes an exposure: an unscanned blob is no
longer served or auto-routed.

## Verification

- `apps/api` unit: the scan handler against a fake scanner and a mocked pool for
  clean, infected and a final-attempt error; an item past review scans nothing;
  an upload enqueues the scan job and not the route job while the email intake
  still enqueues the split; `openBlob` answers 409 `blob_scan_pending`; the
  maintenance tick resends a scan job for an upload and for an API item.
- `apps/api` integration: `scan-inbox-item.integration.test.ts` on
  Testcontainers for clean (the blob becomes `clean` and the route job is sent),
  infected (the item is `discarded` with `policy_rejected`) and the exhausted
  retry (the blob becomes `failed`).
- `packages/db` integration: the new definer refuses a tenant context and lists
  the unscanned upload and API items only.
- `apps/web` unit: the item page renders the scan-pending indicator instead of
  the preview and the download link.
- `pnpm check`, `pnpm --filter @bap/api test:integration`,
  `pnpm --filter @bap/db test:integration`.

## Open questions

- `routeJobForItem` re-derives the decision after the rule extraction committed,
  so an item whose channel carries a kind hint and whose rule matched is decided
  on the merged confidence rather than the sniff confidence. Carrying the
  intake's `routeJob.ruleId` in the scan payload would avoid the re-derivation
  entirely; the re-read was chosen so the payload keeps one shape per principal.
- A blob stored before this change stays `not_scanned` until the maintenance
  sweep reaches its item; there is no backfill for a blob whose item is already
  routed.
