# ADR 0015: Inbox Intake Model

- Status: accepted
- Date: 2026-09-16

## Context

Data enters BAP today through two hand-driven paths: a tabular upload that
becomes a dataset (ADR 0006) and a create form that becomes a document (ADR
0012). Both require a person to know what a thing is before the platform sees
it. Invoices, payroll papers, bank statements, contracts and accounting exports
arrive as email attachments, exports, portal downloads and scans, and each
destination would otherwise grow its own intake: its own upload, its own parser,
its own duplicate check, its own idea of where the original went.

The register also has no way to show an original. `app.document.upload_id` is
dead and `app.document.content_hash` duplicates a hash that belongs to the
bytes, not the document.

[The inbox plan](../planning/inbox.md) describes the subsystem. This record
fixes the decisions that constrain every later phase of it.

## Decision

The Inbox is the single intake boundary. Everything from outside becomes an
`app.inbox_item` first, is understood with a recorded confidence, and is routed
to a destination by a rule or a person. Documents, datasets and partners are
destinations, and each destination row keeps `inbox_item_id`.

- Items are organization-level. `app.inbox_item.legal_entity_id` is nullable
  until the item is routed or pre-bound by its channel. This amends
  [ADR 0011](0011-two-level-tenancy.md), which says every dataset and upload
  belongs to exactly one entity, in the same way `app.partner` already departs
  from it: the organization is still the only row level security boundary, and
  entity scope is still an application filter. An item with no entity is visible
  only to members with unrestricted scope and `manageDocuments`.
- Destinations are typed foreign keys, never a polymorphic pointer: nullable
  `document_id`, `dataset_id`, `partner_id`, each pinned to `organization_id`,
  `ON DELETE RESTRICT`, with a check that at most one is set, so a routed
  destination can only be deleted through the path that un-routes the item
  first. A polymorphic `(routed_to_kind, routed_to_id)` pair cannot be enforced
  by the database and would be the first tenant table without referential
  integrity.
- Understanding is a provider behind one contract: input item, files, hints and
  organization context; output detected type, confidence, entity, partner, a
  destination-shaped draft, per-field confidences, ordered reasons and issues
  from a closed taxonomy. Deterministic providers run before AI, and confidence
  is always recorded, including `1.0` for a structured parse and the value a
  person implies by filling a draft.
- Nothing auto-routes without a routing target policy and a threshold. The
  platform default for every type is `never`; an organization opts in per type
  with `above_threshold` or `always`.
- Provenance is stored on every decision and every field as typed columns, never
  free text: `decided_by_kind` (`hint`, `rule`, `target_default`, `provider`,
  `user`) plus `decided_by_user_id` or `decided_by_rule_id`, and the ordered
  reasons the provider produced. The UI shows it; it is never derived after the
  fact.
- Guardrails: automation never overrides a value set by a person, a value set by
  a rule, or an item already `routed`. Automation attempts an auto-route at most
  once after a human has touched the item.
- Issues are banners with a reason, never rejections. An item with an issue
  lands in `needs_review` and stays writable; a human confirms or overrides.
- Nothing is purged and nothing is unrecoverable. Discard keeps the item and its
  bytes with a reason and is reversible; retention is a per-organization policy,
  never a fixed window.
- A non-human channel principal is required before any channel other than manual
  upload. Every write path today is bound to a browser session member; an email
  webhook, an API token or a bank poll has no user. Defining that principal
  (subject, capability set, RLS `created_by`, worker membership check,
  server-side organization binding) is a separate future ADR and a prerequisite
  for Phase 1.
- pg-boss payloads carry ids only. `pgboss.job` has no row level security and is
  cross-tenant readable by `bap_api`, so no filename, path, hash of content or
  extracted value ever enters a payload.
- Tenant content reaches an external AI provider only with a per-organization
  opt-in. Without it the `llm_extract` provider is not offered, and the item
  waits for a person.

## Consequences

Every intake feature from now on is an Inbox channel or an Inbox provider, not a
new upload route. The tabular upload of ADR 0006 becomes a manual upload whose
item routes to a dataset, and the documents create form becomes the prefilled
draft of a routed item, both without losing their current behaviour.

`app.document` gains `inbox_item_id` and `app.document_file`, and loses
`upload_id` and `content_hash`. Blobs are durable per
[ADR 0014](0014-durable-blob-storage.md).

Because items are organization-level, the shared scope resolver from ADR 0011
must treat a null `legal_entity_id` as "unrestricted scope only", and the
integration suite must prove that a restricted member cannot list or open an
unrouted item.

Because destinations are typed columns, adding a destination module (bank
transactions in Phase 4) is a migration that adds one column and widens one
check, and the database keeps enforcing that an item points at one live row of
one organization.

Because providers share one contract, the `sniff` and `manual` providers of
Phase 0 are the whole pipeline's proof: hints, targets, explanation, review and
routing must work with them before any AI or parser is added. A provider that
cannot express its output in the contract does not ship.

Because nothing auto-routes by default and every channel beyond manual upload
waits for the principal ADR, Phase 0 changes no authorization boundary: every
inbox write is still a browser-session member with `manageDocuments`.
