# Inbox Foundation (Phase 0)

**Date:** 2026-09-16

## Problem

A person who receives an invoice, a payroll paper or a bank statement has to
know what it is, open the right form and type it in, and the platform keeps no
original: uploaded bytes are deleted after parse (ADR 0006). There is no place
to drop a file and decide later, no record of why a document was registered the
way it was, and no protection against registering the same file twice.

Phase 0 of [the inbox plan](../../docs/planning/inbox.md) delivers the smallest
useful Inbox: durable files, one intake envelope, two deterministic providers
and a manual route into Documents.

## Scope

- [ADR 0014](../../docs/adr/0014-durable-blob-storage.md): durable
  per-organization content-addressed blobs behind a `BlobStore` interface,
  restic backup of the volume, platform-wide quota.
- [ADR 0015](../../docs/adr/0015-inbox-intake-model.md): the Inbox as the single
  intake boundary.
- Tables `app.blob`, `app.inbox_item`, `app.inbox_item_file`,
  `app.inbox_item_extraction`, `app.inbox_event`, `app.document_file`;
  `inbox_item_id` on `app.document`; retire `app.document.upload_id` and
  `app.document.content_hash`.
- New document kind `advance_request`. `document_link` kind `advance_of` added;
  `settles` and `relates` already exist and are reused.
- Manual multi-file upload of any type, one request per file, the existing size
  limit, exact-hash duplicate handling at arrival.
- Providers `sniff` and `manual` behind the provider contract; hints on the
  item; the unprocessable reasons enum; routing to Documents through a prefilled
  create form; undo back to `needs_review`; blob download and inline routes.
- `/inbox` product page inside the product shell, a rail destination, the
  reserved organization slug `inbox` and its parity test.
- The full issue taxonomy is stored, but Phase 0 raises only `duplicate_exact`,
  `unprocessable_*`, `entity_unresolved`, `missing_required_field` and
  `reference_conflict`.
- Not in scope: `inbox_channel` and `inbox_rule` tables, the orphan sweep (Phase
  1, it needs a non-human principal), a per-organization quota setting, routing
  target settings UI, email-in, ClamAV, any AI provider, ARES, fingerprint
  duplicates, Split, the document versioning route, bank statements or
  transactions, the channel principal.

## Design

Migration `20260916.0001_inbox.sql` creates the six tables with per-command
policies gated by `app.role_can_write()`, grants for `bap_api`, `bap_reporting`
(read) and `bap_backup` (read), and reserves the `inbox` slug. It drops
`app.document.content_hash`, `app.document.upload_id`, constraint
`document_upload_fkey` and index `document_upload_idx`
(`packages/db/drizzle/20260914.0002_documents.sql`); zero readers today (grep
confirmed; every `content_hash` hit belongs to `dataset_embedding`). It alters
`document_kind_check` to add `advance_request` and `document_link_kind_check` to
add `advance_of`. `advance_request` derives nothing: not in `EVENT_KINDS`,
attributes only (`docs/documents.md`). A routed document gets
`document.source = 'upload'` (already in `contract.ts`); later channels map to
`import` or `api`. `DATABASE_MIGRATION_COMPATIBILITY` becomes `20260916.0001`.

`app.inbox_item` columns: `id`, `organization_id`, `legal_entity_id` (nullable,
composite FK), `channel_kind` (closed enum, Phase 0 writes `upload`),
`payload_kind` (closed enum, Phase 0 writes `file`), `external_id` (nullable
text; `unique(organization_id, channel_kind, external_id)` where not null),
`parent_item_id` (nullable self composite FK, unused until Split), `status`,
`detected_type`, `confidence`, `hint_text`, `hint_legal_entity_id`, `hint_kind`,
`hint_partner_id`, `hint_link_document_id`, `duplicate_of_item_id` (nullable
composite FK to `inbox_item(id, organization_id)`), `document_id`, `dataset_id`,
`partner_id` (each a composite FK, `ON DELETE RESTRICT`, check: at most one
set), `decided_by_kind` (enum: `hint`, `rule`, `target_default`, `provider`,
`user`), `decided_by_user_id`, `decided_by_rule_id` (nullable, no FK until rules
exist), `routed_at`, `assignee_id`, `snoozed_until`, `received_at`,
`created_by`, `created_at`, `updated_at`. No `channel_id` until `inbox_channel`
exists (a bare uuid is what ADR 0015 rejects). Check constraint:
`status <> 'routed' OR (document_id IS NOT NULL OR dataset_id IS NOT NULL OR partner_id IS NOT NULL)`.
No `jsonb`; list index `(organization_id, status, received_at desc, id desc)`.
Drafts, per-field confidences, reasons and issues live in
`app.inbox_item_extraction`. `app.document.inbox_item_id` and
`app.document_file` pin to the organization the same way.

Erasure (ADR 0008): every subject-bearing column the migration adds joins
`app.erase_user` and the `bap_eraser` column grants: `inbox_item.created_by`,
`inbox_item.assignee_id`, `inbox_item.decided_by_user_id`,
`inbox_event.actor_user_id`, `blob.created_by`, `document_file.created_by`,
`inbox_item_extraction.created_by`.

`BlobStore` lives in `apps/api/src/blobs`, with the filesystem implementation
keyed `org/<organization_id>/<sha256>`. The upload route receives the file at a
temporary path (multer disk storage in `upload.controller.ts` writes before any
check runs), hashes it, enforces the existing size limit and the quota, inserts
the `app.blob`, `app.inbox_item` and `inbox_item_file` rows in one transaction,
then renames the file into its content-addressed path; on any failure the
temporary file is deleted, so Phase 0 creates no orphan. The quota is a
platform-wide `BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION` environment value checked
against the sum of `blob.byte_size` for the organization, and
`BAP_BLOB_STORAGE_DIR` names the mounted volume path the filesystem
implementation writes under. An existing blob with the same hash in the
organization makes the new item `discarded` with `duplicate_of_item_id` set to
the earlier item, issue `duplicate_exact` and an `inbox_event` with reason
`duplicate`, reversible from the UI.

`apps/api/src/inbox` holds the provider contract (Zod), the `sniff` provider
(magic bytes, media type, XML root namespace, GPC header, tabular shape), the
`manual` provider (validates a person's draft against the destination contract),
the routing service and the controllers. `sniff` runs synchronously inside the
intake transaction in Phase 0, so the upload response already carries the
detected type and confidence; a post-commit pg-boss queue job is the Phase 1
shape, once a provider needs I/O or an external call. Routing to Documents calls
the existing documents service inside the same tenant transaction, sets
`inbox_item_id` and `document_file`, and marks the item `routed` with
`decided_by_kind = 'user'` and `decided_by_user_id`. Undo runs one transaction
that first clears `inbox_item.document_id`, sets `status = needs_review` and
appends an `inbox_event`, then calls the existing
`DELETE .../documents/:documentId` path (the `@Delete` route in
`document.controller.ts`); the `ON DELETE RESTRICT` FK refuses any other delete
of a routed document, so a delete from the Documents page follows the same path
(the document repository un-routes the item first). Routing target defaults are
a code constant (`auto: never` for every type); the table arrives in Phase 1.

Two blob routes. Download: `Content-Disposition: attachment`, `nosniff`, any
media type. Inline: only when the sniffed media type is `application/pdf`,
`image/png`, `image/jpeg` or `image/webp`, served with
`Content-Disposition: inline`, `nosniff` and `Content-Security-Policy: sandbox`;
any other type is refused and the panel shows a download link only. The BFF blob
routes follow `getDatasetExport` in `apps/web/src/lib/auth/bff.ts`: header-only
upstream timeout, `response.body` streamed, `Content-Disposition` minted in the
BFF from validated ids and the sanitised stored filename (the upstream filename
is never forwarded verbatim), `nosniff` and the private response headers set in
the BFF.

Backup: `scripts/verify-compose.mjs` asserts the volume member set api (rw),
worker (rw), backup (ro), restore (rw) with per-service mode, and
`scripts/backup-entrypoint.sh` adds `restic backup` of the mounted volume path
to the same run as `pg_dump`.

The BFF gains the inbox and blob route shapes with Zod mirrors. The `/inbox`
page renders `PageContainer` with the item list (`DataGrid` from
`@bap/design-system/blocks`), the upload drop zone, and an item panel with the
preview in an `<iframe sandbox>` (no scripts, no same-origin), hints, the
explanation and the prefilled draft. Rail entry through `railDestinations`;
`inbox` added to `reservedOrganizationSlugs` and the database parity corpus.

## Security

Bytes move from the browser through the BFF to the API volume and never to the
model provider. Only PDF, PNG, JPEG and WebP render inline, sandboxed by the CSP
header and the frame; everything else is attachment-only with `nosniff`. A quota
refusal answers 413 and stores nothing: the temporary file is deleted, no row is
written. Every write is a browser-session member with `manageDocuments`;
unrouted items are visible only to unrestricted scope. pg-boss payloads carry
ids only. Audit entries record ids, kinds and reasons, never filenames, hint
text or draft values. Blobs join the ADR 0008 erasure path.

## Verification

- `packages/db` and `apps/api` integration suites (`pnpm test:integration`):
  migration applies, RLS isolates items and blobs across organizations, a
  restricted member cannot list an unrouted item, member role cannot insert,
  duplicate blob per organization rejected, routed check constraint, delete of a
  routed document refused outside undo, cascade and erasure of every column
  listed above, reserved `inbox` slug rejected.
- `apps/api` unit tests: `sniff` on fixtures for each detected type and each
  unprocessable reason, exact-hash duplicate handling, quota refusal (413,
  nothing stored), undo (document deleted, item back to `needs_review`, event
  appended), hints round-trip, download and inline headers (attachment vs
  inline, `nosniff`, CSP sandbox, inline refused for a non-allowed media type),
  routing target defaults, provider contract validation, controller matrix and
  OpenAPI.
- `apps/web` unit tests: `/inbox` page, item panel and prefilled draft, BFF blob
  routes (minted disposition, streamed body), rail from `railDestinations`,
  reserved slug corpus parity.
- Compose verify: the four-member volume set with per-service mode. Backup
  proof: a file written before `restic backup` is present after restore, in the
  backup verification script or as a documented manual step.
- Gate: `pnpm check` locally, `pnpm test:integration` in CI.

## Open questions

- Whether the tabular upload path migrates to an inbox item in Phase 0 or waits
  until the dataset destination is wired in Phase 1.
