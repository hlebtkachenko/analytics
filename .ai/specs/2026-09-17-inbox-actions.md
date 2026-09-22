# Inbox Actions (Phase 1b-actions)

**Date:** 2026-09-17

## Problem

After 1b-runtime and 1b-rules an item can be routed, discarded, assigned,
snoozed and auto-routed, but three things the planning document promises are
still impossible
([UI actions](../../docs/planning/inbox.md#routing-configuration-and-rule-precedence),
[duplicate policy](../../docs/planning/inbox.md#duplicate-policy)): a re-issued
invoice that hits `document_current_reference_key`
(`packages/db/drizzle/20260914.0002_documents.sql:343-345`) can only be refused
with a bare 409 (`apps/api/src/inbox/inbox.controller.ts:316-318`), a probable
duplicate is never detected because no fingerprint query exists, a file cannot
be attached to a document that already exists (the only `document_file` writer
is the route flow, `apps/api/src/inbox/inbox-repository.ts:975-980`), and the
list has no filters beyond status and type
(`apps/api/src/inbox/contract.ts:321-336`) and no bulk action. The version chain
has readers only (`apps/api/src/documents/document-repository.ts:106-107,149`);
`createDocument` (`:723-747`) and `updateDocument` (`:947-970`) never write
`version`, `supersedes_document_id` or `is_current`, as ADR 0012 records. This
is the last of the three stacked core pull requests, and it also delivers
`pnpm demo:inbox`, so the core can be seen running end to end.

## Scope

- Migration `20260917.0006_inbox_actions.sql`: the `attached` event kind,
  compatibility bump to `20260917.0006`.
- API: versioning route, fingerprint check with acknowledgement, attach to an
  existing document and its undo, bulk action, list filters, the document
  detail's originals, the `failed` email parent path on the existing `process`
  route.
- Web: item page actions (attach, version, duplicate dialog), list page filters,
  selection and bulk bar, the "Original" panel on the document page, BFF routes
  and Zod mirrors.
- `scripts/demo-inbox.sh`, `tests/operational/inbox.spec.ts`, the two
  `package.json` entries and their `docs/testing.md` paragraph.
- Out: manual Split and its file-adding route (`POST .../items/:itemId/files`),
  dropped entirely: both intake routes accept one file per request
  (`apps/api/src/inbox/inbox.controller.ts:95`,
  `inbox-channel.controller.ts:144`), every Split the plan names is either
  page-range (needs PDF tooling, `page_from` and `page_to` on `document_file`
  and `inbox_item_file` stay unused, connections and setup track) or the email
  attachment split that `split_email_item` already performs
  (`apps/api/src/worker/split-email-item.ts:550-676`); two files for one
  document is route then attach. Also out: Merge and Link actions, datasets and
  partners destinations for bulk approve, any connector, ARES, AI, OCR, reply
  mail, retention.

## Design

Migration. `inbox_event_kind_check` (`20260916.0001_inbox.sql:254-257`) gains
`attached`; `inboxEventKinds` (`packages/db/src/schema.ts:274`) gains the same
value. `INBOX_ISSUE_CODES` (`apps/api/src/inbox/contract.ts:51-57`) gains
`duplicate_probable`, an issue code only (jsonb `issues` on the extraction row,
`20260916.0001_inbox.sql:229`), never an event or discard reason, so
`inbox_event_reason_check` and `inboxDiscardReasons` are untouched by this PR;
the web mirrors gain `attached` in `inboxEventKindSchema` and
`duplicate_probable` in `inboxIssueCodeSchema`
(`apps/web/src/lib/inbox/contract.ts:77-91,112-118`, both strict enums). No new
fingerprint index: `app.partner` is organization-wide, not entity-scoped
(`docs/documents.md:37-40`), so the fingerprint lookup below is
organization-wide within the caller's allowed entity ids (the `LIST_FILTER`
shape, `document-repository.ts:122`), not entity-scoped, and
`document_partner_idx (organization_id, partner_id)`
(`20260914.0002_documents.sql:350-352`) already covers it. Migration
`20260917.0006_inbox_actions.sql` shrinks to the `attached` event kind in
`inbox_event_kind_check` and the compatibility bump. No new table, no new
column, no policy change: every write below goes through tables whose
per-command policies already gate on `app.role_can_write()`
(`20260916.0001_inbox.sql:474-497` for `document_file`), and
`inbox_item_channel_update` (`20260917.0001_inbox_channels.sql:356-371`) keeps
the channel out of `document_id` and a person's decision.
`DATABASE_MIGRATION_COMPATIBILITY` (`packages/db/src/access.ts:39`) becomes
`20260917.0006`.

Versioning route. `routeInboxItemToDocumentRequestSchema`
(`contract.ts:374-386`) gains `supersedesDocumentId?: uuid` and
`acknowledgeDuplicateOf?: uuid`, both optional. Before `createDocument`, the
route transaction runs one pre-check per rule instead of waiting for the unique
violation the controller catches today (`inbox.controller.ts:316-318`), because
a bare 409 cannot name the document a person must choose to supersede:

- reference:
  `select id, version from app.document where legal_entity_id = $1 and kind = $2 and reference = $3 and is_current for update`;
  a hit without `supersedesDocumentId` answers 409
  `{ code: 'reference_conflict', documentId }`. Unlike today, where the unique
  violation on `document_current_reference_key` rolls back before
  `insertExtraction` runs and nothing is written (`inbox-repository.ts:960-970`,
  controller `:316-318`), this route's own transaction writes an extraction row
  carrying issue `reference_conflict` with the conflicting document id before it
  answers 409, the same mechanism as the `duplicate_probable` hit below. With
  `supersedesDocumentId` equal to the hit (any other value is 400), the
  transaction runs
  `update app.document set is_current = false, updated_at = now() where id = $1 and is_current`
  first (0 rows means it changed under us: 409), then inserts the new document
  with `version = old.version + 1` and `supersedes_document_id = old.id` through
  `createDocumentInTransaction`, which gains an optional
  `supersedes: { documentId, version }` input, the first writer of the three
  columns; `document_supersedes_fkey` (`20260914.0002_documents.sql:338-339`)
  pins the organization. Economic events: the register derives one event per
  document and every analytics read sums `economic_event_line` with no
  `is_current` predicate (`apps/api/src/documents/analytics-repository.ts:20-26`
  reads the event's `legal_entity_id` and never joins the register;
  `docs/documents.md`, Reaching the data), so a superseded invoice and its
  correction would both count. The safe behaviour is the one `updateDocument`
  already uses for a re-derive (`document-repository.ts:496-499`): the version
  transaction deletes the superseded document's `economic_event` (its lines
  cascade) and its unresolved `data_issue` rows, the same two deletes `rederive`
  does (`document-repository.ts:499-502`), and nothing is written by hand; the
  new version derives its own event on create. The old row keeps its invoice
  content, files and links (document links stay on the predecessor, and the
  banner below says so); `has_event` reads false and the summary carries
  `isCurrent: false` and `version`, already in `documentSummarySchema`
  (`apps/api/src/documents/contract.ts:250`). Undo of a version route reuses the
  existing delete path (`document-repository.ts:1046-1096`):
  `deleteDocumentInTransaction` deletes the row first, as it already does, then,
  when the deleted row's `supersedes_document_id` is not null, flips
  `is_current = true` on the predecessor and re-derives its event through the
  same helper as a `PATCH`, so an undo and an ordinary delete from the Documents
  page restore the predecessor identically and there is only one code path. Both
  undo and delete refuse (409) when the target row is not `is_current`: a later
  version exists, and `document_supersedes_fkey` (`ON DELETE SET NULL`,
  `20260914.0002_documents.sql:338-339`) would otherwise orphan the chain. The
  documents list gains the filter `current=true|false|all` (default `true`, the
  `LIST_FILTER` shape, `document-repository.ts:122-132`), and the detail page
  shows a "Superseded by version N" banner linking to the current row and a
  "Supersedes version N" line on the new one; `documentDetailSchema`
  (`contract.ts:367-376`) gains `supersedesDocumentId` and
  `supersededByDocumentId`.
- fingerprint: only when the draft has `partnerId`. Query, organization-wide
  within the caller's allowed entity ids (the `LIST_FILTER` shape,
  `document-repository.ts:122`), not entity-scoped: `app.partner` is
  organization-wide (`docs/documents.md:37-40`), so the same supplier can
  invoice several of the caller's legal entities. Current rows only:
  `select id, reference, document_date::text, total_amount::text from app.document where organization_id = $1 and ($7::uuid[] is null or legal_entity_id = any($7::uuid[])) and partner_id = $2 and is_current and id <> coalesce($5::uuid, '00000000-0000-0000-0000-000000000000') and ((reference is not null and reference = $3) or ($4::numeric is not null and total_amount = $4::numeric and document_date between $6::date - 3 and $6::date + 3)) limit 10`
  with `$1` the organization id, `$2` the draft `partnerId`,
  `$3 = body.reference`, `$4` the draft total (`totalAmount`, `contract.ts:632`,
  when there is no `invoice` block; else the computed invoice total of
  `document-repository.ts:719-722`), `$5` the `supersedesDocumentId` (a
  correction is not a duplicate of the row it replaces), `$6 = documentDate`
  (`:623`), `$7` the caller's `allowedEntityIds`. Reference match is exact and
  ignores kind on purpose: the same number registered as `received_invoice` and
  as `credit_note` is the case the check exists for. A hit without
  `acknowledgeDuplicateOf` writes the manual extraction row with issue
  `duplicate_probable` and the candidate ids in its message, commits that row
  (its own transaction, so the review list shows the banner after the refusal)
  and answers 409
  `{ code: 'duplicate_probable', candidates: [{ id, reference, documentDate, totalAmount }] }`.
  `acknowledgeDuplicateOf` must name one returned candidate (400 otherwise), is
  recorded in the audit entry, and lets the route proceed; the item page then
  offers "Attach as additional file to document X" (the attach route below),
  "Discard as duplicate" (discard with reason `duplicate` and
  `duplicate_of_item_id` left null; the reference is the document, not an item)
  and "Route anyway" (the same request with the acknowledgement). The 1b-rules
  auto-route job runs the same pre-checks under the author and treats a
  fingerprint hit like a `reference_conflict`: extraction row with the issue,
  the item stays `needs_review`, no retry, never an acknowledgement.

Attach. `POST .../items/:itemId/attach` with `{ documentId }` on an item that is
`received` or `needs_review`, 409 otherwise, 404 when the document is not
visible in the caller's entity scope. One transaction: lock the document row,
insert one `document_file` row per item file at `max(position) + 1` onward in
item order with `created_by` the caller (`document_file_insert` requires it,
`20260916.0001_inbox.sql:477-482`; the PK `(document_id, position)` and the blob
FK `ON DELETE RESTRICT`, `:288-291`, are satisfied by construction, and a blob
already on that document is 409 `blob_already_attached` since the same bytes
twice is the duplicate the action exists to avoid). Then
`update app.inbox_item set document_id = $2, legal_entity_id = document.legal_entity_id, status = 'routed', decided_by_kind = 'user', decided_by_user_id = $3, routed_at = now()`
(`inbox_item_routed_check`, `20260916.0001_inbox.sql:107-108`, is satisfied by
`document_id`), event `attached`, audit `inbox_item.attached` with both ids.
Undo is `POST .../route/undo` on an attached item: the existing `undoRoute`
(`inbox-repository.ts:1004`) branches on `document.inbox_item_id = item.id`
(`20260916.0001_inbox.sql:299-303`), not on the newest event: equal means this
item created the document, and the existing delete-the-document path runs
unchanged; unequal means the item was attached to a document another item
created, and the transaction below deletes the `document_file` rows of that
document whose `blob_id` is among the item's blobs (exactly the rows this item
brought, since the same blob twice was refused), un-routes the item with the
same update `deleteDocumentInTransaction` uses
(`document-repository.ts:1063-1082`) and the `unrouted` event, and never touches
the document itself. The blob FK is `RESTRICT` on the blob side only, so
deleting `document_file` rows is free; the blob keeps its `inbox_item_file`
reference and the orphan sweep never sees it. Deleting a document with attached
items un-routes them through the existing `where document_id = $1` update
(`:1063-1072`), which already covers attached items, and
`document_file_document_fkey` cascades their rows (`:288-289`).

Original panel. `documentDetailSchema` gains
`files: [{ blobId, position, filename, mediaType, byteSize }]` (read from
`document_file` joined to `blob`; `blob.original_filename`
(`20260916.0001_inbox.sql:15`) supplies the filename directly, no
`inbox_item_file` join needed) and
`inboxItems: [{ id, status, receivedAt, channelKind }]` (rows of `inbox_item`
with `document_id = this`, routed and attached alike). Today the detail page
(`apps/web/src/app/(product)/documents/[documentId]/page.tsx`) renders no file
and no item reference, and the detail contract has neither
(`contract.ts:367-376`), so the panel is new: a section "Original" listing each
file with the inline or download link of the blob routes and each item as a link
to `/inbox/:itemId`.

Failed email parent. `POST .../items/:itemId/process` on a `failed` email parent
re-enqueues `split_email_item` instead of re-sniffing (children are idempotent
by `external_id`, `split-email-item.ts:561-565`, so a re-run resumes at the
first child that does not exist yet). Today the job accepts a parent in
`received` or `processing` only (`split-email-item.ts:311-316`), `recordFailure`
sets `failed` (`:718`) on the last attempt, and the runtime requeue targets
`received` only, so a `failed` parent stays stuck until this route reopens it.

Bulk. `POST .../items/bulk` with strict body
`{ itemIds: uuid[] (1..100, distinct), action: 'assign' | 'snooze' | 'discard' | 'approve', assigneeId?, snoozedUntil?, reason? }`,
the field of the action required and the others refused. `snooze` and `discard`
are a creep past the plan's "bulk approve and bulk assign"
(`docs/planning/inbox.md:188`); both are kept because they reuse the single-item
paths and cost nothing extra. Each id runs the existing single-item repository
function in its own transaction, in body order, inside one request, so a refusal
on one item (409 not open, 404 not visible) never rolls back another. `approve`
calls `routeToDocument` with the draft that 1b-rules'
`composeDocumentDraft(item, matchedRules, effectiveTarget)` composes: `kind`
from the hint, then a matched rule, then the target's `document_kind`;
`legalEntityId` from the hint, then the item, then the target's default;
`documentDate = received_at`; an invoice kind is refused; the target's
`required_fields` are honoured. Approve routes that draft with
`decided_by_kind = 'user'`, `fileBlobIds` in item order, no acknowledgement and
no `supersedesDocumentId`, so a fingerprint hit or a reference conflict is
reported per id, never forced; a per-id `missing_required_field` result when the
composer cannot fill a required field, including a `received` item with no
`detected_type`. The response is
`{ results: [{ itemId, status: 'ok' | 'refused', code? }] }` with HTTP 200
whatever the mix; the audit entry is one row per changed item, the same as the
single actions, and the rate limit counts one request. 100 is the list page's
maximum (`MAX_INBOX_PAGE_SIZE`, `contract.ts:61`), so a bulk action is at most
one page.

List. `inboxItemListQuerySchema` (`contract.ts:321-336`) gains `issue`
(`inboxIssueCodeSchema`, matches the newest extraction's issues), `assigneeId`
(`subjectIdentifierSchema`, or the literal `none`) and `confidence` (`low` below
0.5, `medium` 0.5 to below 0.9, `high` at or above 0.9, or `unknown` for null;
bands are constants in `contract.ts`, not a query parameter pair, so the OpenAPI
enum stays closed). `inboxItemSchema` (`contract.ts:136-150`) gains
`humanTouched: boolean`, computed in the list query as
`exists (select 1 from app.inbox_event e where e.item_id = i.id and e.actor_user_id is not null and e.kind in ('hint_added', 'assigned', 'restored', 'reopened', 'unrouted'))`,
the same kinds as 1b-rules' `HUMAN_TOUCH_EVENT_KINDS` constant, so the list and
the automation guardrail never disagree. State colour: a "State" column with a
Carbon `Tag`, grey for untouched, blue for user-touched, green for routed, red
for discarded; the `DataGrid` block has no per-row style hook
(`packages/design-system/src/blocks/types.ts:95-110`) and this spec does not add
one, which is the delta from "colours items" in the planning document. The page
turns on `selection="multi"` with `batchActions`
(`packages/design-system/src/blocks/README.md:61-62,101`) for assign, snooze,
discard and approve; each opens a small modal for its field and shows the per-id
result list. Three new filter controls sit beside the status select
(`apps/web/src/app/(product)/inbox/page.tsx:263-282`) and round-trip through the
URL like `filter` does (`:115`).

Web and BFF. Item page (`apps/web/src/app/(product)/inbox/[itemId]/page.tsx`):
"Attach to existing document" with a document search (the documents list BFF
with `search`), the reference conflict dialog offering "Register as new version"
(re-sends the route with `supersedesDocumentId`), and the duplicate dialog with
the three choices. BFF functions `postInboxItemAttach` and `postInboxItemsBulk`
follow `postInboxItemRouteDocument` (`apps/web/src/lib/auth/bff.ts:1849`);
`postInboxItemRouteDocument` forwards the two 409 bodies by code the way
`blob_quarantined` is read (`bff.ts:2056-2059`); `getInboxItems` (`:1675`)
passes the three filters; `getDocument` mirrors `files`, `inboxItems` and the
two version ids; `getDocuments` passes `current`. Zod mirrors in
`apps/web/src/lib/inbox/contract.ts` and
`apps/web/src/lib/documents/contract.ts`.

Demo. `scripts/demo-inbox.sh` is `scripts/demo-documents.sh` with the sixth step
swapped: it sources `scripts/demo-lib.sh` (its header comment, `demo-lib.sh:2`,
names the two demo scripts that source it today and gains this third), runs
`demo_local_secrets`, `demo_reset_stack`, `demo_start_stack`,
`demo_create_accounts`, `demo_grant_quota` (`scripts/demo-documents.sh:13-17`),
then `demo_playwright_spec tests/operational/inbox.spec.ts`
(`demo-lib.sh:141-146`), prints the same summary with
`Inbox $BAP_OPERATIONAL_BASE_URL/inbox?organization=$organization_slug` first,
opens it when `open` exists, and `--down` calls `demo_down`
(`demo-lib.sh:38-47`). Compose files and ports are the library's:
`compose.yaml`, `compose.development.yaml`, `compose.mailpit.yaml`
(`demo-lib.sh:23`), web on `39100`, PostgreSQL on `39432`, Mailpit on `39825`
(`:9-19`). `package.json` (`:13-16`) gains `demo:inbox` and `demo:inbox:down`;
`docs/testing.md` gains a paragraph after the `demo:documents` one
(`docs/testing.md:269-292`). Hleb runs `pnpm demo:inbox`, waits for the summary,
and the browser opens `/inbox`; `pnpm demo:inbox:down` removes the stack and its
volumes.

`tests/operational/inbox.spec.ts` follows `documents-analytics.spec.ts`: serial,
skipped without `BAP_OPERATIONAL_PASSWORD`, the `Placeholder` naming and the
`runSuffix` (`tests/operational/documents-analytics.spec.ts:16-22`), every seed
through `page.request` against the real BFF routes. Seed: one legal entity
`Placeholder Inbox Entity`, one partner `Demo Supplier s.r.o.`, one API channel
created through the channels BFF and one credential issued through
`POST .../channels/:channelId/credentials` (`inbox-channel.controller.ts:472`),
the secret held in a test variable and never written. Files are generated in the
spec: a one-page PDF written by hand (`%PDF-1.4`, one empty page object, an
`xref` table), a 1 by 1 PNG from a base64 constant, a three-line CSV, a text
payload, and the PDF sent a second time so the exact duplicate is discarded at
arrival; all five go through `POST .../channels/:channelId/items` with the
bearer credential. Browser proof in order: the list shows the items and the
discarded duplicate; the item page shows the sniffed type, files and reasons; a
hint is set; the CSV is routed to Documents as `other`, the document page shows
the Original panel; the text payload is discarded and restored; the PNG item is
attached to the CSV document (the Original panel now shows two files; undo
returns the PNG item to review); a second `other` document is routed with the
same reference as the CSV document, gets the 409, chooses "Register as new
version", and the version banner appears; a third document is routed with the
same reference under another non-invoice kind and the same partner, gets the
duplicate dialog, and is discarded as `duplicate`; bulk assign on two items; the
rules page creates one rule on the API channel with `auto_route`, a new PDF is
pushed and the list shows it `routed` with `decidedByKind = 'rule'` (checked
with `expect.poll`, the worker routes asynchronously; the `pdf` type's default
kind is already `other`, `routing-targets.ts:37`, so no routing-target settings
edit is needed for it); axe reports no violation on the list, the item page and
the document page. The spec joins the explicit list in
`.github/workflows/operational-proof.yml:147` before `zz-sign-out.spec.ts`; that
workflow runs on pull requests touching the listed paths (`:4-25`), weekly and
on dispatch, and `timeout-minutes` (`:50`) rises to 15 for the extra proof.

## Security

Every route in this spec resolves `manageDocuments` through the controller's
`manage` helper (`inbox.controller.ts:574-584`), which a `channel_` subject
never passes, so the channel principal can call none of them; it cannot set
`document_id`, `decided_by_kind` or `status = 'routed'` either
(`inbox_item_channel_update`). The reference query filters by `legal_entity_id`
inside the tenant transaction; the fingerprint query is organization-wide but
bounded by the caller's `allowedEntityIds` (the `LIST_FILTER` shape), since a
partner is organization-wide (`docs/documents.md:37-40`). Both answer only ids,
reference, date and total of documents the caller can list anyway, and nothing
crosses the entity scope, because the draft's `legalEntityId` is checked against
`allowedEntityIds` before either query runs. `document_file` rows and the
version chain carry `organization_id` through their composite keys
(`document_file_document_fkey`, `document_supersedes_fkey`), so an attach or a
version can never cross organizations. Bulk is bounded at 100 ids and one
rate-limit unit; it writes the same per-item audit entries as the single-item
routes, not a separate bulk row. Audit entries (`inbox_item.attached`,
`inbox_item.routed` with `supersedesDocumentId` or `acknowledgeDuplicateOf`)
carry ids and enum values only; logs carry operation, code and ids, never a
filename, a reference or a total.

## Verification

- `packages/db` integration: migration applies; the `attached` enum value; a
  member cannot insert `document_file`; a channel context cannot update
  `document_id`; `bap_reporting` reads `document_file`.
- `apps/api` unit and integration: versioning: the new row carries `version + 1`
  and `supersedes_document_id`, the old row flips `is_current`, its event and
  unresolved `data_issue` rows are gone and the new event derived, the unique
  index never fires, undo deletes the new row then restores `is_current` and
  re-derives the old event, an ordinary delete of a current version does the
  same, a wrong `supersedesDocumentId` is 400, a concurrent flip is 409, undo
  and delete both refuse a non-current row 409; fingerprint: reference hit,
  total plus date hit inside and outside the window, no partner means no check,
  the superseded row excluded, a hit outside the caller's `allowedEntityIds` is
  excluded, 409 body with candidates, the extraction row with
  `duplicate_probable` committed, acknowledgement of a listed candidate proceeds
  and an unlisted one is 400, the auto-route job records the issue and stays;
  reference conflict: the extraction row with the issue is committed before the
  409; attach: rows at the next positions, item routed with
  `decided_by_kind = 'user'`, event `attached`, same blob twice 409, undo
  discriminates by `document.inbox_item_id` and removes only that item's rows,
  leaving the document, document delete un-routes an attached item; bulk:
  partial success per id, 100 cap, wrong field for the action 400, approve
  composes the draft through `composeDocumentDraft` and reports a fingerprint
  hit or a `missing_required_field` result per id; a `failed` email parent's
  `process` re-enqueues `split_email_item`; list filters and `humanTouched`;
  controller matrix (403 for a channel subject on every new route,
  `manageDocuments`); OpenAPI document.
- `apps/web` unit: list filters, selection and bulk bar, state tags; item page
  attach, the conflict and duplicate dialogs; document page Original panel and
  version banners; BFF mirrors including the two 409 bodies.
- `tests/operational/inbox.spec.ts` under `pnpm demo:inbox` locally and in
  `operational-proof.yml`.
- `pnpm check` locally; `pnpm test:integration` in CI.

## Open questions

- Dependencies on 1b-runtime and 1b-rules relied on here: the `routingTargetFor`
  helper and the target defaults for `approve`, the `composeDocumentDraft`
  composer and the `HUMAN_TOUCH_EVENT_KINDS` constant, the auto-route job's
  `reference_conflict` path extended with the fingerprint check, and migration
  `.0005` that this spec bumps to `.0006`.
