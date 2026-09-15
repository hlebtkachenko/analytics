# Documents

## Purpose and frame

BAP is an analytics platform, not a book of record. Every document it holds was
already booked in a source system such as Money S3, Pohoda, or a bank portal.
The documents feature registers those documents once, keeps their structured
content where structure exists, and derives a comparable debit/credit view so a
P&L, a payables view, or a partner drill-down reads the same across legal
entities that use different accounting software.

The model has three layers.

- The register, `app.document`, is uniform for every document kind: an invoice,
  a receipt, a bank statement, a contract, and so on all get the same columns.
- Content is per kind. Invoices get dedicated tables, `app.invoice` and
  `app.invoice_line`. Every other kind stores free key/value pairs in
  `app.document_attribute` instead.
- Economic events are derived, not entered. `app.economic_event` and
  `app.economic_event_line` hold one rebuildable debit/credit event per
  accounting-relevant document, produced by a versioned rule set.

Because BAP is not the book of record, the register invents no numbering series,
closes no period, and enforces no legal immutability. An imbalance in a derived
event is reported as a data issue, never a rejected write.

## Tenancy

Documents follow ADR 0011's two-level tenancy. `organization_id` is the only row
level security boundary. `app.document`, `app.invoice`, `app.invoice_line`,
`app.economic_event`, and `app.economic_event_line` also carry
`legal_entity_id`, pinned by a composite foreign key to
`app.legal_entity(id, organization_id)`, the same pattern legal entities and
datasets already use. Every child row pins its parent the same way, so a row can
never reference another organization's entity, partner, upload, or document.

`app.partner` is organization-wide, not entity-scoped: the same supplier can
invoice several of an organization's legal entities, and an organization-wide
partner also lets one legal entity be detected as another's intercompany
counterparty through `partner.legal_entity_id`. `app.directive_account` carries
no `organization_id` and no row level security at all, because the Czech
synthetic chart of accounts is identical for every tenant.

Every partner answer masks `legal_entity_id` to null when the intercompany
entity is outside the caller's scope, and a patch that would clear or overwrite
a stored link the caller cannot see is answered as 404 instead, so a narrow
scope can neither read nor destroy the link.

Entity selection and the restricted member scope stay an application-level
filter through `readEntityScope` and `allowedEntityIds`, never a database
policy, exactly as ADR 0011 describes for datasets.

## Table inventory

| Table                     | Purpose                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.directive_account`   | Shared, RLS-free Czech synthetic chart of accounts, 218 rows from decree 500/2002 Sb.                                                                                                                                        |
| `app.partner`             | Organization-wide counterparty, optionally naming one of the organization's own legal entities.                                                                                                                              |
| `app.document`            | The uniform register: one row per document, every kind, per legal entity.                                                                                                                                                    |
| `app.document_attribute`  | Free key/value pairs for kinds with no dedicated content table.                                                                                                                                                              |
| `app.invoice`             | Invoice content, one row per invoice kind document: dates, totals, signed `rounding_amount`, `advance_total`, generated `amount_due`.                                                                                        |
| `app.invoice_line`        | Invoice lines: `line_kind` (`item` or `advance_deduction`), category, VAT mode, VAT rate, amounts, own tax point date, service period, activity code. A deduction line carries no category, no tax point date and no period. |
| `app.economic_event`      | Derived, rebuildable debit/credit event, one current event per document.                                                                                                                                                     |
| `app.economic_event_line` | Derived event lines: account code, side, amount, `effective_date`, `activity_code`, and the invoice line it came from.                                                                                                       |
| `app.document_link`       | Directed link of any kind between two documents.                                                                                                                                                                             |
| `app.data_issue`          | What derivation found: an open or resolved issue against a document.                                                                                                                                                         |

## Lifecycle statuses and versioning

`app.document.status` is `registered` (the default), `needs_review`, `verified`,
or `archived`. The API changes status only through
`PATCH .../documents/:documentId`; the database enforces no transition order
between the four values.

The schema carries a version chain: `version` (default `1`),
`supersedes_document_id`, and `is_current` (default `true`), with a partial
unique index so only the current version of a kind can claim a given `reference`
inside a legal entity. No API route sets `version`, `supersedes_document_id`, or
clears `is_current` today; every document is created and stays at version 1. A
re-versioning endpoint is explicitly out of scope (see Out of scope below). The
only way to relate an old document to a correction today is a generic
`document_link` of kind `supersedes`, which does not touch `version` or
`is_current`.

## Derivation

Derivation lives in `apps/api/src/documents/derivation.ts`, a pure function with
no I/O. Money is parsed into scaled `bigint` (`packages` under `decimal.ts`),
never a JS number. The current rule set is:

```
RULE_SET_VERSION = 'cz-default-2026-09.1'
```

Only `issued_invoice` and `received_invoice` produce an event; every other kind
derives nothing.

### Fixed accounts

| Document kind      | Debit                                                                                             | Credit                                                                                            | VAT handling                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issued_invoice`   | 311 (receivable), base + VAT                                                                      | category revenue account, base only; 343, VAT amount, only when `vat_mode = standard` and VAT > 0 | `reverse_charge`, `exempt`, and `outside_scope` lines carry no VAT line at all on the issued side.                                                                                                                                           |
| `received_invoice` | category expense account, base only; 343, VAT amount, only when `vat_mode = standard` and VAT > 0 | 321 (payable), base + VAT                                                                         | `reverse_charge` additionally debits and credits 343 by the same self-assessed amount, computed as `round_half_away_from_zero(base * rate / 100)`; the two legs cancel and never move the balance. `exempt` and `outside_scope` book no VAT. |

Those rows describe an `item` line. The two other sources of legs are:

| Source                                       | Issued invoice                                                                                     | Received invoice                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `advance_deduction` line, `standard`         | debit 324 base; debit 343 VAT; credit 311 base + VAT                                               | debit 321 base + VAT; credit 314 base; credit 343 VAT |
| `advance_deduction` line, any other VAT mode | debit 324 base; credit 311 base (no VAT legs: a reverse charge supply self-assesses once, at DUZP) | debit 321 base; credit 314 base (no VAT legs)         |
| `rounding_amount` > 0                        | debit 311; credit 648                                                                              | debit 548; credit 321                                 |
| `rounding_amount` < 0                        | debit 548; credit 311                                                                              | debit 321; credit 648                                 |

Rounding legs carry `abs(rounding_amount)`, no `invoice_line_id` and no
`activity_code`; the 311 or 321 leg carries the partner. Advance deduction legs
take the invoice tax point date, then the document date: the contract refuses a
tax point date or a period on a deduction line, because the settlement belongs
to the final invoice, never to the month the advance was paid.

For an invoice kind `app.document.total_amount` is the printed total,
`gross_total + rounding_amount`, before any advance deduction; the list page and
its totals by currency sum that number. `amount_due` lives on `app.invoice`.

### Category to account

| Category    | Issued invoice credit (revenue) | Received invoice debit (expense) |
| ----------- | ------------------------------- | -------------------------------- |
| `goods`     | 604                             | 504                              |
| `material`  | 642                             | 501                              |
| `services`  | 602                             | 518                              |
| `labour`    | 602                             | 518                              |
| `transport` | 602                             | 518                              |
| `asset`     | 641                             | 042                              |
| `other`     | 648                             | 548                              |

`labour` and `transport` share the services accounts on purpose: the category
exists so the kind of work is groupable, not to pick a different account. Only
an `item` line reaches this table; an `advance_deduction` line has no category.

The receivable (311) and payable (321) lines carry the document's `partner_id`;
every other line carries no partner. Every event line derived from a line
carries the `invoice_line_id` it was derived from, so a report can always trace
a booked amount back to its source line. Every event line carries
`effective_date`, the tax point of its source line with the fallback line
`tax_point_date`, then invoice `tax_point_date`, then document date (rounding
legs use the last two), and a copy of the line's `activity_code`.
`effective_date` is the supply date, never the service period and never the date
a VAT deduction is claimed. A zero-amount candidate line, for example the VAT
leg of an `exempt` invoice, is dropped rather than stored, because
`economic_event_line.amount` must be greater than zero.

### Changing the rules

A rule change is a new `RULE_SET_VERSION` string, never an edit to a stored
event. `app.economic_event.rule_set_version` records which version produced each
event, so mixed history is always identifiable. Re-derivation happens inline,
inside the same tenant transaction, in exactly two places today:

- every `POST .../documents` that creates an invoice kind derives its event
  once, unconditionally;
- `PATCH .../documents/:documentId` re-derives when `partnerId` or
  `documentDate` changes on a document that already has an event. Those two are
  the only updatable fields that feed derivation: the partner rides on the
  receivable and payable lines, and the document date is the event date and the
  last fallback of every `effective_date` (`updateDocumentRequestSchema` carries
  no invoice or line fields). The re-derive reads the stored lines and the
  stored invoice header (`tax_point_date`, `rounding_amount`), so the rounding
  legs and the tax point fallback survive a patch.

There is no batch re-derive job. Bumping `RULE_SET_VERSION` and shipping new
rule code changes only documents that are created or have their partner or
document date updated afterward; every existing event keeps the rule set version
that produced it until something writes that document again.

`app.economic_event.event_date` is always the document date: it answers "what
was registered when". The per leg `effective_date` answers "what belongs to
which month"; the due date feeds nothing.

### Signs and credit notes

Every amount an invoice carries is non-negative, with one bounded exception.
`base_amount`, `vat_amount`, `base_total`, `vat_total` and `advance_total` all
have a `>= 0` check constraint, and the API contract accepts money without a
leading minus for those fields. Direction lives in the document kind or the line
kind, never in the sign: a refund is registered as a `credit_note`, which is its
own kind and derives no event today, and a deducted advance is an
`advance_deduction` line. The exception is `app.invoice.rounding_amount`, the
rounding of the printed total to whole crowns, which the VAT Act keeps outside
the tax base: it is signed (positive means the issuer rounded up) and
`abs(rounding_amount) < 1` is enforced. Derivation therefore drops only a leg
whose amount is exactly zero, for example the VAT leg of an exempt line; a
non-zero leg is never silently discarded.

## Data issues

`app.data_issue.code` is a closed vocabulary of four values, but the derivation
code only emits two of them today.

| Code               | Severity | Emitted today   | Trigger                                                                                                                                                                                                                                           |
| ------------------ | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unbalanced_event` | error    | Yes             | Debit total does not equal credit total after derivation. In practice this cannot currently happen: every rule pairs its legs so they always balance.                                                                                             |
| `missing_partner`  | warning  | Yes             | An invoice kind's `partnerId` is null, so the receivable or payable line is unattributed.                                                                                                                                                         |
| `total_mismatch`   | warning  | Vocabulary only | Reserved for when invoice totals disagree with the sum of their lines. Not reachable today because `base_total`, `vat_total`, and `gross_total` are always computed server-side as the sum of the submitted lines, never taken from client input. |
| `unmapped_line`    | warning  | Vocabulary only | Reserved for a line the rule set cannot map to an account. Not reachable today because the seven invoice line categories cover every entry in both the revenue and the expense account maps.                                                      |

Open issues are unique per `(document_id, code)`; a resolved issue can repeat.
Every re-derivation deletes unresolved issues for the document before inserting
the fresh set.

## API routes

All routes are versioned `v1`, mounted under
`organizations/:organizationId/...`, and guarded by `ResourceJwtGuard` and
`SubjectRateLimitGuard`. Every handler resolves tenant access first; an entity
or document outside the caller's scope answers 404, the same as a genuinely
missing one.

| Method | Path                                   | Capability        | Success | Failure                                                                                       |
| ------ | -------------------------------------- | ----------------- | ------- | --------------------------------------------------------------------------------------------- |
| GET    | `/documents`                           | `readDocuments`   | 200     | 401, 403                                                                                      |
| GET    | `/documents/analytics`                 | `readDocuments`   | 200     | 401, 403                                                                                      |
| POST   | `/documents`                           | `manageDocuments` | 201     | 401, 403, 404 (legal entity not visible), 409 (reference already used)                        |
| GET    | `/documents/:documentId`               | `readDocuments`   | 200     | 401, 403, 404 (not visible)                                                                   |
| PATCH  | `/documents/:documentId`               | `manageDocuments` | 200     | 401, 403, 404, 409 (reference already used)                                                   |
| DELETE | `/documents/:documentId`               | `manageDocuments` | 204     | 401, 403, 404                                                                                 |
| POST   | `/documents/:documentId/links`         | `manageDocuments` | 201     | 401, 403, 404 (either document not visible), 409 (link already exists)                        |
| DELETE | `/documents/:documentId/links/:linkId` | `manageDocuments` | 204     | 401, 403, 404                                                                                 |
| GET    | `/partners`                            | `readDocuments`   | 200     | 401, 403                                                                                      |
| POST   | `/partners`                            | `manageDocuments` | 201     | 401, 403, 404 (intercompany legal entity not visible), 409 (registration number already used) |
| PATCH  | `/partners/:partnerId`                 | `manageDocuments` | 200     | 401, 403, 404, 409 (registration number already used)                                         |
| GET    | `/directive-accounts`                  | `readDocuments`   | 200     | 401, 403                                                                                      |

A value the database refuses, a check constraint violation (`23514`) or a
numeric overflow (`22003`), is answered as 400 with the `invalid-request`
problem document, never as a 500: it is bad input that the boundary schema did
not catch.

### Link visibility

`app.document_link` is read from both ends, but a link is only shown when the
document at its other end is inside the caller's entity scope. A restricted
member reading a document linked to a document it may not see gets no link at
all, so the link cannot leak the existence of the other document. A link may be
removed from either end: `DELETE .../documents/:documentId/links/:linkId`
accepts a path document that is the `from` or the `to` side, and the entity
scope is checked on that path document.

`manageDocuments` and `readDocuments` are `true`/`true` for `owner` and `admin`,
and `false`/`true` for `member`, matching every other write capability under ADR
0011; a restricted member's scope does not change these booleans.

## BFF and page routes

The browser never calls `apps/api` directly. Every documents route above has a
matching fixed BFF route and `apps/web/src/lib/auth/bff.ts` function, listed in
[the application route contract](application-routes.md). The three product
pages, `/documents`, `/documents/new`, and `/documents/[documentId]`, are
registered in the rail through `railDestinations` and are documented in full,
including their state contracts, in [the route contract](application-routes.md)
and [how to add a product page](product-pages.md).

## How to add a new document kind

1. Add the value to the `document_kind_check` constraint in a new migration and,
   if the kind needs it, give it a `document_current_reference_key`-style
   uniqueness rule.
2. Add the value to `DOCUMENT_KINDS` in `apps/api/src/documents/contract.ts` and
   to the mirrored enum in `apps/web/src/lib/documents/contract.ts`.
3. If the kind has structure worth its own columns, add a content table with the
   same `document_id` primary key and cascade pattern as `app.invoice`;
   otherwise the kind stores its data in `app.document_attribute` and needs no
   new table.
4. If the kind should produce an economic event, add it to `EVENT_KINDS` in
   `derivation.ts` and a booking function for it; otherwise it derives nothing,
   like every kind other than the two invoice kinds today.
5. Update `apps/api/src/documents/derivation.test.ts`,
   `document.controller.test.ts`, and `document.integration.test.ts` for the new
   kind, and the equivalent `apps/web` page and contract tests.
6. Update the reserved-slug and rail steps only if the kind also needs its own
   page; most new kinds need no web change at all.

## Reaching the data for analytics

An analytics read starts from `app.economic_event_line`, joins
`app.directive_account` on `account_code` for the account name and nature, joins
`app.partner` on `partner_id` for the counterparty (only present on receivable
and payable lines), and joins back through `app.economic_event` and
`app.document` for the document date, kind, status, and legal entity. This is
the same shape [database-isolation.md](database-isolation.md) describes for the
migration; there is no separate reporting-API read path for documents yet.

Every fact is stored split at write time, so the common groupings are a plain
`group by` with no arithmetic. One received invoice for five months of work,
mixed reverse charge and standard lines, a deducted advance and a rounding
difference is read like this:

```sql
-- expense by month of supply, per account
select date_trunc('month', l.effective_date) as month, l.account_code, sum(l.amount)
  from app.economic_event_line l
  join app.economic_event e on e.id = l.event_id
 where e.document_id = $1 and l.side = 'debit'
 group by 1, 2 order by 1, 2;

-- expense by economic activity (profit and loss accounts only; VAT and payable legs carry the activity too)
select l.activity_code, sum(l.amount)
  from app.economic_event_line l
  join app.economic_event e on e.id = l.event_id
  join app.directive_account a on a.code = l.account_code
 where e.document_id = $1 and l.side = 'debit' and l.activity_code is not null
   and a.nature in ('EXPENSE', 'REVENUE')
 group by 1;

-- VAT by regime, supplies and deducted advances apart
select line_kind, vat_mode, vat_rate, sum(base_amount) as base, sum(vat_amount) as vat
  from app.invoice_line
 where document_id = $1
 group by 1, 2, 3;

-- accrual view: the service period lives on the line, so join it
select il.period_start, il.period_end, sum(l.amount)
  from app.economic_event_line l
  join app.invoice_line il on il.id = l.invoice_line_id
 where il.document_id = $1 and l.side = 'debit' and il.line_kind = 'item'
 group by 1, 2;
```

The payable after the advance is `sum(credit 321) - sum(debit 321)` on the
event, and it equals `app.invoice.amount_due`, a generated column
(`gross_total + rounding_amount - advance_total`) that no code writes.

### Analytics route

`GET .../documents/analytics?legalEntityId=` runs exactly those group by
statements over the caller's scope instead of one document: the invoice list
capped at 50 rows, expense and revenue by month of `effective_date` and account,
by `activity_code` on expense and revenue accounts, VAT by line kind and regime,
and totals by account. Every query filters by `organization_id`, the event line
aggregates read the caller's entity scope from
`app.economic_event.legal_entity_id` rather than joining the register, and each
grouping reads both sides in one pass with
`coalesce(sum(...) filter (where side = ...), 0)`. Nothing is recomputed in
TypeScript: the amounts cross the boundary as the decimal strings PostgreSQL
printed. The response also reports its own cost in `stats`: the five statements
it ran, the event and invoice line counts those statements already carried, and
the wall clock milliseconds they took.

## Out of scope

- Source adapters that import documents from Money S3, Pohoda, ISDOC, or a bank
  feed.
- Table-driven rule overrides per organization or per legal entity; rules live
  in code, keyed only by `RULE_SET_VERSION`.
- A re-versioning endpoint; the `version`, `supersedes_document_id`, and
  `is_current` columns exist in the schema but no route writes them.
- Bank matching or settlement beyond the generic `document_link`.
- Reporting API reads of documents or economic events.
- A dedicated content table for `credit_note`; it is a register kind today with
  attribute-only content and derives no event.
- A document kind for the advance tax document; a final invoice links to a
  registered advance through `app.document_link` with kind `settles`.
- Editing invoice content after creation; lines, advance deductions and rounding
  are create-time facts.
- Dimension master tables; `activity_code` is a free normalised code.
