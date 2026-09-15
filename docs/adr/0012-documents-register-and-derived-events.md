# ADR 0012: Documents Register and Derived Economic Events

- Status: accepted
- Date: 2026-09-14

## Context

BAP had no place to record that a document exists. Documents arrive from many
places, invoices, receipts, bank statements, contracts, HR and payroll papers,
tax filings, and each was already booked in whatever accounting software the
legal entity uses. Analytics over that data needs every document registered
once, its structured content kept where it has structure, and a comparable
debit/credit view so a P&L, a payables view, or a partner drill-down reads the
same across legal entities that use different source systems.

BAP is explicitly not the book of record. The register must not invent document
numbering, close periods, or enforce legal immutability the way the source
system already does.

## Decision

The register, `app.document`, is uniform across every document kind. Content is
kept per kind: invoices get `app.invoice` and `app.invoice_line`, and every
other kind stores free key/value pairs in `app.document_attribute` instead of a
dedicated table.

Economic events are derived, not entered. `app.economic_event` and
`app.economic_event_line` hold one rebuildable debit/credit event per
accounting-relevant document, produced by a versioned rule set
(`RULE_SET_VERSION`) that lives in code, not a database table. Changing a rule
means shipping a new version string; there is no table-driven rule override and
no batch re-derive job yet, so an existing event keeps the version that produced
it until its document is written again.

A derived event's balance is a data issue, not a write constraint. An imbalance
is reported through `app.data_issue` and the document still registers; the
platform never blocks registration on a derivation outcome.

The schema carries a version chain (`version`, `supersedes_document_id`,
`is_current`) so a future correction flow has somewhere to live, but no
numbering series and no period lock exist, and no route writes that chain today.
A re-versioning endpoint is deliberately deferred.

Partners are organization-wide, not scoped to one legal entity, because the same
supplier or customer commonly transacts with several of an organization's legal
entities, and an organization-wide partner also lets an intercompany document be
detected through `partner.legal_entity_id`.

## Consequences

Every document, invoice, and derived-event table follows ADR 0011's composite
foreign key tenancy pattern: `organization_id` for row level security and
`legal_entity_id` pinned to `app.legal_entity(id, organization_id)`. Only
`app.directive_account`, the shared chart of accounts, and `app.partner`, which
is organization-wide by design, depart from the per-entity shape.

Because rules live in code and events are always rebuildable, a rule fix ships
like any other code change: bump `RULE_SET_VERSION`, deploy, and only documents
touched afterward pick up the new rules. Retroactively re-deriving every
existing event needs a batch job that does not exist yet; until it does, mixed
rule-set history is expected and `rule_set_version` on each event makes it
identifiable.

Because balance is a data issue rather than a constraint, the register stays
always writable even when a source system or a future rule produces an
inconsistent result, at the cost of needing a data-issue review surface to
notice and resolve those cases; today that surface is the open issue list on the
document detail page, with no dedicated triage view.

Because no route exercises the version chain, a document correction today can
only be expressed as a generic `document_link` of kind `supersedes`, which does
not flip `is_current` or bump `version`. A real correction flow, if the product
needs one, requires new API surface, not just the existing schema.
