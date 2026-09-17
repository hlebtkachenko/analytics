# Inbox Plan

This plan specifies the Inbox, the single intake layer through which anything
from outside becomes structured product data in BAP. It is a design document. No
code, migration, or Compose change is part of it; the dated specs under
`.ai/specs/` deliver it phase by phase, starting with
[the inbox foundation spec](../../.ai/specs/2026-09-16-inbox-foundation.md). It
inherits [ADR 0011](../adr/0011-two-level-tenancy.md),
[ADR 0012](../adr/0012-documents-register-and-derived-events.md), and the three
decisions written for it, [ADR 0014](../adr/0014-durable-blob-storage.md),
[ADR 0015](../adr/0015-inbox-intake-model.md) and
[ADR 0016](../adr/0016-channel-principal.md), and it continues
[the documents runtime document](../documents.md).

## Goal

Give every organization one place where an arrival of any kind (a file, an
email, a structured export, a bank record, plain text) is kept as received,
understood with a recorded confidence, and routed to its destination by a rule
or by a person, so that documents, datasets and partners stop being hand-typed
forms and every downstream row can show its original.

BAP is not a legal archive. The Inbox keeps originals for evidence and
analytics; the client's accounting system and their own archive remain the book
of record, and the UI says so.

## Frame: the system, not the reader

AI reading of PDFs and images is deferred. The Inbox delivers the backend, the
frontend and the contract between them. "How do we get facts out of a file" is a
provider behind one interface, and version 1 ships two providers only:

- `sniff`, deterministic: magic bytes, media type, XML root namespace (ISDOC,
  Money S3, Pohoda, CAMT), GPC header, CSV or XLSX shape.
- `manual`: a person fills the draft in the Inbox.

Everything else (hints, routing configuration, rules, explanation, states, open
and edit, duplicates, issues) is built now and works with those two providers.
Later providers (`isdoc`, `money_s3`, `pohoda`, `camt`, `llm_extract`, `rossum`)
plug into the same contract without changing the pipeline around them.

The Inbox has three stages:

1. Arrive: an item lands through a channel. The raw bytes are kept, never
   discarded.
2. Understand: the item is classified (what is it) and extracted (what does it
   say), with a confidence.
3. Route: the item goes to its destination (documents, datasets, partners, later
   bank transactions, or nothing), by a rule or by a person.

Every downstream row that came from the Inbox keeps a pointer back to the item
and the file, so "show me the original" always works.

## Item model

`app.inbox_item` is the envelope, one row per arrival, any payload type.

- `organization_id` is the row level security boundary. `legal_entity_id` is
  nullable until the item is routed or pre-bound by its channel. This amends ADR
  0011, which says every dataset and upload belongs to exactly one entity: inbox
  items are organization-level until routed, the same way `app.partner` already
  is (ADR 0012, ADR 0015).
- `channel_kind` closed enum (Phase 0 writes `upload`). A `channel_id` column
  arrives with `app.inbox_channel` in Phase 1; Phase 0 has no channel table and
  no bare uuid.
- `payload_kind` closed enum: `file`, `email`, `structured`, `text`. Phase 0
  writes `file`; Phase 1 adds `email` and `text`; the enum is closed now so a
  later channel adds a value, not a shape.
- `origin`: sender address, uploader user, API token id, bank account, mailbox
  id.
- `external_id` nullable, `unique(organization_id, channel_kind, external_id)`
  where not null: replay-safe for webhooks and polls.
- `status` (see states below), `detected_type`, `confidence`, `provider`.
- `parent_item_id` for splits: one PDF holding three invoices becomes three
  children.
- Typed destination pointers, never a polymorphic `routed_to`: nullable
  `document_id`, `dataset_id`, `partner_id`, each a composite foreign key pinned
  to `organization_id`, `ON DELETE RESTRICT`, with a check that at most one is
  set and that `routed` implies one is set. Provenance as typed columns:
  `decided_by_kind` (`hint`, `rule`, `target_default`, `provider`, `user`),
  `decided_by_user_id`, `decided_by_rule_id`, `routed_at`.
- `duplicate_of_item_id`, nullable, composite foreign key to
  `inbox_item(id, organization_id)`, set when the exact-hash check finds an
  earlier item in the organization.
- Hints: `hint_text`, `hint_legal_entity_id`, `hint_kind`, `hint_partner_id`,
  `hint_link_document_id`.
- `assignee_id`, `snoozed_until`, `discard_reason`, `received_at`, `created_by`.
- No `jsonb` on this row, so list queries stay narrow. Index
  `(organization_id, status, received_at desc, id desc)`, mirroring
  `document_list_idx`.

Around the envelope:

- `app.blob`: per-organization content-addressed file (ADR 0014):
  `unique(organization_id, sha256)`, `byte_size`, `media_type`, `storage_key`,
  `scan_status`. Never global across organizations: a global blob table is an
  oracle ("does another tenant hold this PDF"), blocks per-organization erasure
  and retention, and saves nothing because invoices are unique per recipient.
- `app.inbox_item_file`: item to blob, many-to-many, with `position` and
  optional `page_from` and `page_to`. For email items the raw `.eml` is position
  1 (`position >= 1` is a schema check) and the attachments become child items.
- `app.inbox_item_extraction`: one row per Understand pass: the
  destination-shaped draft (for example the exact `createDocumentRequestSchema`
  payload), per-field confidences, `reasons[]`, `issues[]`, provider name and
  version. Kept separate so the item row stays small.
- `app.inbox_event`: append-only audit per item (received, scanned, classified,
  extracted, rule matched, routed, reopened, discarded), index
  `(item_id, created_at)`. Expect about ten times the item count.
- `app.inbox_correction`: a human override of a provider or rule value with an
  optional one-line reason. Phase 1.

Phase 1 adds `app.inbox_channel` (kind, name, default legal entity, enabled,
config, secret reference, schedule, last run, last error) and `app.inbox_rule`
(ordered per organization, `unique(organization_id, position)`, match then
action), and `app.inbox_routing_target` (see routing configuration).

On the documents side: `app.document_file` (document to blob with `page_from`
and `page_to`) and `inbox_item_id` on `app.document`. The dead
`app.document.upload_id` column and the duplicate `app.document.content_hash`
column are retired; the blob carries the hash.

## Provider contract

Understanding is one interface, whatever sits behind it.

- Input: the item, its files, its hints, and the organization context (legal
  entities with IČO and DIČ, partners, channel defaults).
- Output: `detected_type`, `confidence`, optional `legal_entity_id`, optional
  `partner_ref`, a destination-shaped draft, per-field confidences, `reasons[]`
  (each reason: source step, evidence, weight), `issues[]` from the closed
  taxonomy below.

The ladder is deterministic first, AI last, confidence always recorded:

1. Sniff (media type, XML namespace, GPC header, tabular shape).
2. Structured parse to a normalised draft, full confidence.
3. Rules: channel default, sender, filename pattern, recipient IČO to legal
   entity.
4. AI extraction for PDF and images through the platform's model access (ADR
   0005), in the worker, per-field confidence. This ships tenant PII to an
   external provider: per-organization opt-in and a data processing agreement
   are required. Rossum as an optional external extractor later.
5. Human: anything below threshold or with an issue lands in `needs_review`.

Enrichment happens inside Understand, not in channels: ARES (partner by IČO,
free REST, upsert against the IČO unique index to avoid races), VIES, and the
organization's own legal entities (recipient IČO or DIČ resolves
`legal_entity_id`).

Split is a provider slot like any other: a provider may propose page ranges, and
the user confirms or draws them.

## Routing configuration and rule precedence

`app.inbox_routing_target` answers "faktura přijatá goes to A, payroll goes to
B": one row per organization per `detected_type`, with destination module
(`documents`, `datasets`, `partners`, `discard`), destination kind, default
legal entity or "resolve by IČO", partner policy (`match_only`,
`upsert_from_ares`), auto policy (`never`, `above_threshold`, `always`),
threshold, default assignee, and the fields required before routing. The
platform default applies to a type until the organization saves its own row in
settings. `app.inbox_rule` adds conditional overrides (sender, channel, keyword,
amount) on top of targets.

Precedence, documented and shown in the UI:

1. Hint set by a person on the item.
2. User rule.
3. Suggested rule that a user accepted.
4. Routing target default.
5. Provider suggestion.

Nothing auto-routes by default. Auto-route happens only when the target's auto
policy allows it and the confidence clears its threshold. Confirming a routing
decision offers "create a rule from this"; BAP suggests, the user confirms, and
no rule is ever created silently. Rule scope is future only, or also re-run the
items currently in `needs_review`.

Routing never edits the item. It creates the destination row with
`inbox_item_id` and marks the item routed. Undo un-routes the item first (clears
the destination column, sets `needs_review`, appends an event) and then deletes
the destination row in the same transaction; the `ON DELETE RESTRICT` foreign
key refuses any other delete of a routed destination.

UI actions: Register as document (prefilled create form), Import as dataset,
Attach to existing document, Create partner, Split, Merge, Link, Discard,
Snooze, Assign, Reopen. The review list filters by confidence and by issue type,
supports bulk approve and bulk assign, and colours items by state (untouched,
user-touched, routed).

## States and hints

`status` values: `received` (held, unprocessed; waits for hints or for the user
to press Process, or auto-continues when the channel says so), `queued`,
`processing`, `needs_review`, `routed`, `discarded`, `failed`. The Unprocessed
view is `received | queued | failed`. `discarded` keeps a reason (`irrelevant`,
`duplicate`, `not_ours`, `spam`) and is retained for audit until the
organization's retention policy purges it.

Hints are notes before processing: free `hint_text` plus the structured hints on
the item. Hints outrank every provider and every rule. A channel can carry
standing hints (default entity, default kind). Hints appear in the explanation
as the first reason.

## Explanation and provenance

Every routed or reviewed item stores `decided_by_kind` (`hint`, `rule`,
`target_default`, `provider`, `user`) with the typed `decided_by_user_id` or
`decided_by_rule_id`, and the ordered `reasons[]` from the provider run. The UI
shows one plain sentence per reason: "ISDOC namespace found (sniff)", "supplier
IČO 12345678 matches partner X", "rule 3: sender @dodavatel.cz sets legal entity
Y", "confidence 0.62 below target threshold 0.90, sent to review".

Provenance is per field as well as per decision. Low confidence is visibly
marked, and hover text answers "who set it and why". On override the UI may ask
why in one line; the answer is stored in `app.inbox_correction`, feeds future
provider runs (deferred) and offers "re-check similar items" now. BAP stores
explicit corrections and rules only, and shows them; there is no "learns from
your actions" without a visible mechanism.

## Open and edit

An unrouted item opens inside the Inbox: file preview, hints, an editable draft
(the destination create form rendered from the target's contract), and the
Route, Discard, Split and Link actions.

A routed item shows a read-only summary, the explanation, and a deep link that
opens the destination in its own module (`/documents/:id`, `/datasets/:id`, the
partner page). Editing after routing happens in the owning module, never in the
Inbox. Every destination page shows an "Original" panel linking back to the item
and the file.

## Channels

Push and manual channels enter at the web BFF (public ingress). Pull channels
run in the worker, the only runtime with egress besides web (ADR 0004, ADR
0006).

| Channel               | Transport                                                                                                                            | Runs in            | Notes                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Manual upload         | drag and drop, multi-file, any type                                                                                                  | web to api         | today `files: 1` and CSV or XLSX only (`upload.controller.ts:114`); one request per file, Caddy limits kept |
| Email-in              | per-organization address keyed on a token only (`in-<token>@in.<domain>`, never on the slug, because slugs rename), provider webhook | web webhook to api | Mailgun EU; Resend inbound unverified; self-hosted SMTP adds a public port                                  |
| Public API or webhook | `POST /api/intake/v1/items` with a channel token; the web binds the organization from the token                                      | web to api         | `external_id` required; the path n8n or any pusher uses                                                     |
| MCP                   | `inbox.submit` in the planned MCP server                                                                                             | same as API        | see [the MCP server plan](mcp-server.md)                                                                    |
| ISDOC and ISDOCX      | file via any channel                                                                                                                 | worker parser      | highest return: every Czech accounting product emits it                                                     |
| Money S3 XML          | file export, manual or client-scheduled                                                                                              | worker parser      | no push exists                                                                                              |
| Pohoda XML            | file, or mServer HTTP pull                                                                                                           | worker poll        | request-response on the client's machine                                                                    |
| Bank statement file   | GPC or ABO, CAMT.053, CSV, MT940                                                                                                     | worker parser      | postponed to Phase 4                                                                                        |
| Bank API              | Fio token (one call per 30 s), KB, ČSOB, RB and ČS certificate APIs                                                                  | worker cron        | Fio first                                                                                                   |
| Fakturoid             | native webhooks                                                                                                                      | web webhook to api |                                                                                                             |
| iDoklad               | SDK poll, webhooks unverified                                                                                                        | worker poll        |                                                                                                             |
| ISDS                  | SOAP pull, ZFO or PDF                                                                                                                | worker poll        | per-entity credentials, sensitive                                                                           |
| Cloud folder watch    | Drive, OneDrive, Dropbox                                                                                                             | worker poll        | for non-technical staff                                                                                     |
| Peppol                | access point                                                                                                                         | later              | no Czech B2B mandate today                                                                                  |

Every channel except manual upload needs a non-human principal first. Today no
non-human actor can write: every resource JWT is minted from a browser session
(`apps/web/src/lib/auth/bff.ts`), the API requires membership
(`apps/api/src/tenant-access.ts`), the worker fails any job whose `userId` is
not a live write-role member (`apps/api/src/worker/job-context.ts`), and RLS
inserts require `created_by = bap.user_id`
(`packages/db/drizzle/20260914.0002_documents.sql:625`). An email webhook, an
API token or a bank poll has no user.
[ADR 0016](../adr/0016-channel-principal.md), the Phase 1 prerequisite, defines
the channel principal: subject `channel_<uuid>` with `bap.role = 'channel'`, a
capability set limited to inbox writes, how RLS `created_by` and the worker
membership check treat it, and how the organization binding is derived
server-side from the token (hashed at rest, shown once, per-token rate limit
through the existing `SubjectRateLimitGuard`). Provider signatures prove the
sender, never the tenant.

The email channel replies to the sender with a summary: items created, files
skipped and why (Phase 1).

BAP owns the intake API and the core channels (upload, email-in, API, structured
parsers). Long-tail sources reach BAP through the intake API from self-hosted
n8n as an operator tool for BAP's own sources only; n8n never holds tenant
credentials. The intake API is the contract; who pushes is interchangeable.

## Entity fallback chain

For an item with no legal entity, resolution walks a chain and each step lowers
confidence:

1. Channel-bound entity.
2. Hint.
3. Recipient IČO or DIČ matches an own legal entity.
4. Partner default entity.
5. Most recent entity used for that partner.
6. Organization primary entity.

Only the first three can clear an auto-route threshold. Unrouted items (null
entity) are visible only to members with unrestricted scope and
`manageDocuments`; no new role. Channels bound to an entity pre-fill it so
scoped members see their own lane.

## Duplicate policy

Two layers, never a second document:

- Exact: a blob `sha256` match inside the organization at Arrive is resolved as
  `discarded` with reason `duplicate` and `duplicate_of_item_id` pointing at the
  earlier item, visible and reversible, before any processing.
- Probable: a fingerprint match (partner IČO, invoice number, total, date) after
  Understand raises the issue `duplicate_probable` and never auto-drops. The
  suggested actions are "attach as additional file to document X" (a
  `document_file` row, not a link) or discard.

A re-issued invoice with the same number hits `document_current_reference_key`.
The version chain (`version`, `supersedes_document_id`, `is_current`) exists in
the schema but no route sets it (ADR 0012). The Inbox is the first feature that
needs it; the versioning route is Phase 1b-actions.

## Issue taxonomy and the agentic loop

The agentic loop, defined as a system: detect an issue from a closed taxonomy,
propose a fix as an action with a reason and a confidence, apply it
automatically only when the organization's policy allows and the guardrails
pass, otherwise queue it for one-click confirmation, and record the outcome as a
correction. No AI reader is needed for any of this.

Issue codes: `duplicate_exact`, `duplicate_probable`, `unknown_partner`,
`partner_bank_account_changed`, `entity_unresolved`, `entity_conflict`,
`missing_required_field`, `amount_mismatch` (lines against total),
`vat_mismatch`, `date_out_of_window`, `reference_conflict` (same number as a
current document), `unmatched_payment`, and the unprocessable reasons
`unsupported_type`, `password_protected`, `encrypted`, `empty`, `unreadable`,
`decorative_image`, `too_large`, `policy_rejected`. Each issue maps to one or
more proposed actions (link, discard, split, set entity, create partner, attach
to existing, open draft field).

An issue is a banner with a reason, never a rejection; a human confirms or
overrides. Unprocessable reasons are always visible, never silent.

Guardrails: automation never overrides a value set by a person, a value set by a
rule, or an item already `routed`. Automation attempts an auto-route at most
once after a human has touched the item. Per-organization enablement: all
fields, selected fields, off.

Matching thresholds are explicit and configurable. Payment to invoice needs two
of three among amount, variable symbol or invoice number, and date within a
window; the recency window is configurable with no hard cut-off, because Czech
accountants receive late documents; with no match the UI shows candidates for a
manual pick.

Partners: an unknown partner is auto-created only when its IČO is verified in
ARES; otherwise a draft partner needs confirmation. An invoice IBAN differing
from the partner's known IBAN raises `partner_bank_account_changed`, which is
cheap and catches invoice fraud.

Nothing is purged and nothing is unrecoverable: discard is reversible, retention
is a per-organization policy, never a fixed purge window.

## Security ranking

Ranked risks, with the mitigation each needs.

1. Organization binding of unauthenticated intake. Bind from a server-side
   lookup of the address token or API token, never from payload content or
   provider identity. Decided in ADR 0016.
2. Parser blast radius. The worker runs as `bap_api` over every tenant and, by
   Phase 3, holds bank and ISDS credentials. XXE in ISDOC and Pohoda XML, zip
   bombs in XLSX and ISDOCX, PDF parser bugs. ClamAV does not cover this. Needs
   DTD and entity resolution off, decompression and nesting caps, and eventually
   a parse process with no database role and no secrets.
3. Serving originals. Any-type uploads plus inline display would run SVG or HTML
   with the session cookie. Download route with
   `Content-Disposition: attachment` and `nosniff` for any type; inline route
   only for PDF, PNG, JPEG and WebP, with `Content-Security-Policy: sandbox`,
   rendered in an `<iframe sandbox>`; a download link for everything else.

Also:

- ClamAV is a new Compose service plus freshclam egress plus a
  `verify-compose.mjs` rule; the worker stays `read_only` with `cap_drop`. Phase
  1, not Phase 0.
- Channel credentials need envelope encryption with a mounted key file (ADR
  0005: every credential arrives as a mounted file) and a `key_id` column for
  rotation.
- pg-boss payloads carry ids only.
- Blobs join the ADR 0008 erasure path and get a per-organization retention
  policy.
- Sender allowlists are per organization or per entity, managed by admins, never
  per user.
- Payroll and HR items are visible only within entity scope; retention and
  erasure apply.

## Storage

No object storage exists; uploaded bytes are deleted after parse today (ADR
0006), and the staging volume is not backed up. ADR 0014 supersedes that: a
durable per-organization content-addressed filesystem volume behind a
`BlobStore` interface in `apps/api`, key `org/<organization_id>/<sha256>`,
restic backup of the volume (backup mounts it read-only, restore read-write),
per-organization quota, orphans avoided by write ordering in Phase 0 and swept
by a worker job from Phase 1. MinIO only when a second host appears. Never bytes
in PostgreSQL.

## Phasing

Phase 1b is the core: everything manual and automatic that needs no external
connector. After 1b the phase plan stops; every connector and every setup
feature is one small PR on the connections and setup track, added one by one
after the core is live.

- Phase 0, foundation, delivered (PR #56): ADR 0014 and ADR 0015; `blob`,
  `inbox_item`, `inbox_item_file`, `inbox_item_extraction`, `inbox_event`;
  `document_file` and `inbox_item_id` on documents; manual multi-file upload;
  `sniff` and `manual` providers; hints; exact-hash duplicates; Register as
  document with a prefilled form; blob routes; `/inbox` page, rail entry,
  reserved slug. Spec:
  [inbox foundation](../../.ai/specs/2026-09-16-inbox-foundation.md).
- Phase 1a, channels, delivered (PR #65): ADR 0016; the channel principal,
  `inbox_channel` and the credential table with its definer functions;
  `resolveChannelAccess` and `receiveIntake`; the channel items route; channel
  CRUD and credentials for owners; the public intake route with the edge IP
  bucket; channel settings page for API channels. Spec:
  [inbox channels](../../.ai/specs/2026-09-17-inbox-channels.md).
- Phase 1a-email, delivered (PR #67), stacked on 1a: the Mailgun webhook bound
  by the recipient token, the `email_address` credential kind, the API email
  route, the `split_email_item` job, ClamAV and `app.record_blob_scan`,
  `inbox_item.sender`, email channels in the settings page, the Caddy cap. Spec:
  [inbox email channel](../../.ai/specs/2026-09-17-inbox-email-channel.md).
- Phase 1b, core, three stacked PRs:
  - 1b-runtime: `inbox_routing_target` with the `/inbox/settings` page, the
    per-organization blob quota setting, the `inbox_maintenance` job (orphan
    blob sweep, reaper for parents stuck `processing`, requeue for email items
    stuck `received`), discard provenance. Spec:
    [inbox runtime](../../.ai/specs/2026-09-17-inbox-runtime.md).
  - 1b-rules: `inbox_rule`, auto-route running as the rule author,
    `inbox_correction`, create-a-rule-from-this. Spec pending.
  - 1b-actions: Split, the document versioning route, fingerprint duplicates,
    attach-to-existing, bulk approve and assign, `pnpm demo:inbox`. Spec
    pending.

Connections and setup track, each its own PR, added after the core is live. The
bullets keep the old phase order: Czech structured sources first, then live
connectors, then wide sources, mirroring the earlier Phase 2, 3 and 4 sequence.

- Czech structured sources: ISDOC and ISDOCX parse; Money S3 XML; Pohoda XML
  file; hardened XML parsing and legal entity resolution by IČO ride with the
  first of them.
- Live connectors: Fio API poll; Fakturoid webhooks; Pohoda mServer pull; ISDS;
  cloud folder watch; bank premium APIs with the `bank_transaction` table keyed
  `(bank_account, external_id)` and an optional statement document; Peppol; MCP
  `inbox.submit`.
- Enrichment: ARES enrichment (unlocks `partner_policy = 'upsert_from_ares'`);
  AI extraction with per-organization opt-in; reply summaries through outbound
  mail, with a new `@bap/mail` package only when two consumers exist.
- Setup: credential vault; channel health page (last poll, failure streak,
  credential expiry, throughput); retention policy with the walk of untracked
  files on the volume; per-channel pull cron with `list_due_channels` and
  `record_channel_run`, arriving with the first puller; operator wiring (Mailgun
  EU, `freshclam`, the intake domain) is documented per PR as each channel goes
  live.

What the phases unlock: reconciliation (arrived in the Inbox but absent from the
Money S3 export means an unbooked invoice, possible only when arrivals are
recorded independently of the book of record), an evidence trail from economic
event line to invoice line to file and page, and Inbox metrics in the reporting
API (time to triage, auto-route rate, items per channel).

## Case matrix

What happens to each named arrival with the version 1 providers.

| Arrives                                                            | Version 1 detection (no AI)                                                                                                   | Destination                                                                                                                                                               | Notes and gaps                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Faktura (invoice PDF or ISDOC)                                     | ISDOC: full parse. PDF: `unknown`, review. Issued or received decided by which side's IČO matches an own legal entity         | Documents, `received_invoice` or `issued_invoice`, prefilled invoice draft, partner upsert from ARES                                                                      | later `llm_extract` fills the PDF draft through the same contract                                         |
| Mzdový předpis                                                     | hint or manual                                                                                                                | Documents, `payroll`, attributes: period, gross total, entity                                                                                                             | derivation books nothing for payroll today; a payroll rule set is a later feature                         |
| Doklad o platbě (payment confirmation)                             | manual; variable symbol and amount match against open invoices when present                                                   | Link to the paid invoice through `document_link` kind `settles`; or Documents `receipt` when it is a cash receipt (účtenka)                                               | link-only, no `payment_confirmation` kind (decision 9)                                                    |
| Výpis z účtu                                                       | GPC or CAMT header: sniff; PDF: manual                                                                                        | Documents, `bank_statement`, attributes: account, period, balances, file attached                                                                                         | transaction lines deferred to the `bank_transaction` phase                                                |
| Loan agreement                                                     | manual                                                                                                                        | Documents, `contract`, attributes: counterparty, principal, rate, `validFrom` and `validTo`                                                                               | repayment schedule and interest events are later analytics                                                |
| Payroll (run summary, payslips)                                    | manual; multi-page per employee triggers Split                                                                                | Documents, `payroll` for the run; `hr_document` per employee                                                                                                              | PII: visible only within entity scope; retention and erasure apply                                        |
| Advance document (zálohová faktura, daňový doklad k platbě)        | manual                                                                                                                        | Documents, `advance_request` (no tax effect) for the advance; the tax document as `received_invoice` or `issued_invoice` with link kind `advance_of` to the final invoice | the final invoice already models the deduction line (ADR 0013); the register must hold the advance itself |
| Irrelevant documents                                               | rule by sender or keyword; else manual Discard                                                                                | `discarded`, reason `irrelevant` or `spam`, retained for audit                                                                                                            | never silently dropped; a rule can auto-discard                                                           |
| Duplicate of an existing document                                  | blob `sha256` match inside the organization at Arrive; fingerprint match (supplier IČO, number, total, date) after Understand | "Attach as additional file to document X" (a `document_file` row) or Discard `duplicate` with `duplicate_of_item_id`; never a second document                             | exact-bytes duplicates are flagged before any processing                                                  |
| Text files, email body only                                        | `payload_kind = text`; keywords and hints                                                                                     | Documents `other`, or "Add as note to document X", or Discard                                                                                                             | text is a first-class payload, not a file exception                                                       |
| PDF contract attached to a payment email, known only by reading it | version 1: email item with two files; preview; the user Splits, registers the contract, links it to the payment               | Two child items: `contract` and the payment link; `document_link` kind `relates` between them                                                                             | later a provider suggests both; the actions exist from version 1                                          |

## Competitor evidence

Sources: Ramp and Brex help centres (primary, specific); the Puzzle help centre
(primary for rules) and the Puzzle blog (marketing register, treated as design
intent); Agicap product pages only (help articles returned 404), used for intake
shape and pain points.

What BAP takes:

- Entity fallback chain for items with no entity, each step lowering confidence
  (Ramp: vendor default entity, then most recent entity for that vendor, then
  primary entity).
  https://support.ramp.com/hc/en-us/articles/35659701397395-Bill-Pay-AP-Email-Forwarding
- Two-layer duplicates: exact hash dropped, vendor plus invoice number flagged;
  a re-sent file with a different hash still creates a flagged draft (Ramp,
  Brex).
- A closed list of unprocessable reasons, and a reply to the forwarding email
  listing drafts created and files skipped with the reason (Ramp).
- Automatic bill creation attempted only once after the first completed review;
  unknown vendor becomes a draft vendor; approval intelligence recommends and
  never approves (Ramp AP Agents).
  https://support.ramp.com/hc/en-us/articles/47024360747027-AP-Agents-available-in-Ramp-Bill-Pay
- Provenance and guardrails: low confidence in yellow with "who coded it and
  why"; source icons for AI, person, rule; optional "why" on override stored as
  guidance; never override employee, admin or rule values or items marked Ready;
  enablement levels all fields, selected fields, off (Ramp Accounting Agent).
  https://support.ramp.com/hc/en-us/articles/45051740591251-Ramp-Accounting-Agent-Enablement-Daily-Use-Admin-guide
- Explicit matching threshold (two of three among merchant, amount, date),
  candidates shown for manual pick when nothing matches (Brex receipts).
  https://www.brex.com/support/receipts-for-expenses
- A flag is a banner with a reason, "a flag does not mean deny" (Brex flagged
  expenses). https://www.brex.com/support/flagged-expenses
- Explicit rule precedence (linked transaction, custom user rules, bot rules,
  community rules, team rules), rule scope past or future, conditions and
  actions editable in a side panel (Puzzle).
  https://help.puzzle.io/en/articles/6986850-rules-and-categories
- Plain-language prompts for the remainder that is not auto-categorised
  (Puzzle). https://help.puzzle.io/en/articles/8600305-ai-categorization-tools
- Item colour by state: finalized, user-touched, untouched (Puzzle).
  https://help.puzzle.io/en/articles/8598085-finalization-transaction-states
- Per-transaction reasoning trail, filter by confidence, bulk approve, nothing
  posts without approval (Puzzle blog, design intent only).
  https://puzzle.io/blog/ai-accounting-accuracy-reviews
- Bulk upload with automatic invoice separation, and an IBAN-change fraud alert
  (Agicap). https://agicap.com/en/products/account-payable/

What BAP avoids:

- A shared mailbox alias bound to one person's account, and per-user sender
  allowlists (Ramp receipts).
- Purging unmatched items after 30 days, or deletes that cannot be restored
  (Ramp receipt matching, Brex auto-generated receipts).
- Rules auto-created from a single confirmation with no user review; it produced
  the "hard to override" complaints at Puzzle.
- "Learns from your actions" with no visible mechanism (Ramp).
- Hard recency cut-offs for matching (Brex, two months).
- Reconciliation that misses or duplicates transactions, the recurring Agicap
  complaint; hence exact-hash dedup at Arrive and `external_id` uniqueness per
  channel.

## Decisions

Locked on 2026-09-16, with the reason in one line each.

1. The envelope is generic, Phase 0 writes `file`, Phase 1 adds `email` and
   `text`, the enum is closed now: one table for every arrival, no per-channel
   schema.
2. Storage is a durable filesystem volume with backup and sweep, MinIO only for
   a second host (ADR 0014): no new service until a second host forces one.
3. Inbound email through Mailgun EU: the only verified inbound provider with EU
   residency; self-hosted SMTP would add a public port.
4. Unrouted items are visible to unrestricted scope plus `manageDocuments`, no
   new role: entity scope cannot filter an item that has no entity yet.
5. AI extraction in-house with per-organization opt-in, Rossum later: tenant PII
   leaves the deployment only when the organization agrees.
6. n8n is an operator-only pusher and never holds tenant credentials: the intake
   API is the contract, the pusher is interchangeable.
7. Bank data is postponed to Phase 4, then `bank_transaction` plus an optional
   statement document: statements are documents, transactions are not.
8. Add the `advance_request` document kind and the `advance_of` link kind: the
   register must hold the advance itself, not only its deduction (ADR 0013).
9. Payment confirmations are link-only (`settles` to the paid invoice) rather
   than a new document kind: a cash receipt already has `receipt`, and a bank
   confirmation carries no fact the invoice does not.
10. `document_link` kinds needed by the Inbox: `settles`, `relates`,
    `advance_of` (only `advance_of` is new): a link relates two registered
    documents, an exact duplicate is `inbox_item.duplicate_of_item_id`, and
    attaching a file to an existing document is a `document_file` row.

Also fixed by ADR 0015: typed destination foreign keys instead of a polymorphic
pointer; blobs per organization, never global; the channel principal ADR is a
Phase 1 prerequisite; Phase 0 has no channels table, no rules and no ClamAV.
