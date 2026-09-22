# Documents pages on the Carbon product patterns

Date: 2026-09-21. Branch `hlebtkachenko/inbox-ux` (same PR as the inbox
rebuild). Follows `.ai/specs/2026-09-21-inbox-ux.md`; every rule there applies
here (edges measured, no raw ids, codes or ISO timestamps, `cs-CZ` dates with a
full year, names not ids, one primary button, overflow for the rest, honest
empty values).

## Problem

Hleb reviewed `/documents` after the inbox rebuild (a screenshot of the current
documents page): an organization dropdown that RLS already decides, a full-width
legal entity dropdown, a bare "CZK / CZK 0.00" tile, a grid title band, five
inline filters crammed above the header row, eleven columns (Balanced and
Currency as their own columns, "Not set" eight times per row), ISO dates, and
the pre-existing 32 px overflow at 1056. The detail page is one long column: an
"Overview" heading over a key/value table, three outline buttons, an "Economic
event" heading with a sentence, an Original tile with an ISO timestamp and a raw
uuid, and a "Linked documents" form at the bottom.

References Hleb gave (screenshots of IBM Carbon product pages): Page header with
title, status and one Actions control; a row of stat tiles with big numbers; a
key/value detail summary in two columns; tabs with counts; a table with a
toolbar (search, filter, settings) and chips for active filters; a right-hand
detail pane; an activity log.

## Scope

In: `/documents`, `/documents/[documentId]`, `/documents/new`,
`/documents/analytics`; one additive list field; labels; the documents and inbox
operational proofs updated; the visual gate with measured edges and classic
scrollbars at 1440 and 1056.

Out: schema changes; new document capabilities; the reporting API; new
dependencies.

Every capability of the current pages survives: search, kind, status, partner
and date filters, sort, pagination, entity scope, `?organization=` resolution,
New document (all kinds, invoice lines, advance deductions, rounding, partner
create), status changes (verified, needs review, archived), document links (add,
list), versions (supersedes, superseded by), Original panel with inbox item
back-links, files download, analytics query and its tables. Each lane lists the
capabilities of its page before rewriting it.

## API (lane D0, additive)

`GET .../documents` response gains
`counts: { all, needsReview, verified, archived, withIssues }`, computed under
the caller's scope predicate and the current entity filter, ignoring the status,
kind, partner, search and date filters, one grouped query. `totalsByCurrency`
stays. Both contract mirrors, parity test, API tests, docs.

## `/documents` (lane D1)

- Header row: title "Documents"; right: legal entity as a compact inline
  dropdown labelled "Entity" (it is a real filter; the organization dropdown
  goes, the shell decides), primary "New document" with the `DocumentAdd` icon
  (facade has it or lane adds it), overflow menu with "Analytics".
- Stat row, four Carbon tiles with big numbers under the header: Documents
  (`counts.all`), Needs review, With issues, and Total shown (the first entry of
  `totalsByCurrency`, formatted `1 234 567,00 CZK` through `Intl` `cs-CZ`, or
  "—" when empty). The total follows the active list filters, so its label says
  "shown", not "in scope". Tiles are read only.
- Tabs with counts: All · Needs review · Verified · Archived (`tab` query
  parameter mapped to the status filter; All keeps today's default of hiding
  superseded versions).
- Grid (DataGrid block, `fitContainer`, no title band, `ariaLabel`): Document
  (kind icon from the facade by kind, then the title, with the reference as a
  second line when present), Date (`21. 9. 2026`), Partner (name or "—"), Total
  (right aligned, tabular numbers, `12 345,00 CZK`, "—" when null), Status (one
  word: Registered, Needs review, Verified, Archived), Issues (a red count tag
  only when `openIssueCount > 0`; an unbalanced event adds the word "Unbalanced"
  in the same cell), row overflow with today's row actions. Kind, Currency,
  Balanced and Reference columns are gone as columns. Row click opens the
  document; a "New" tag marks documents created after the previous page load
  (same helper as the inbox, key `bap.documents.lastSeen`).
- Toolbar: search (reference, title, partner) on the left; "Filter" on the right
  toggling Kind, Partner, Date from, Date to; active filters as removable tags
  under the toolbar. Sort stays on the columns.
- Dates in the filters use Carbon `DatePicker`, not text inputs.

## `/documents/[documentId]` (lane D2)

- Header: breadcrumb; title = title (reference as the title when the title
  repeats the filename); one line "Received invoice · FA-2026-12 · 21. 9. 2026 ·
  Demo Supplier s.r.o." from kind, reference, date, partner; tags: status, and
  "Version 2" when `version > 1`. Right of the title: one primary button by
  status (`registered` and `needs_review` "Mark verified"; `verified` "Archive";
  `archived` none) and an overflow with the remaining status changes, "Link a
  document" (opens a Modal with today's relationship and document picker) and
  "Open in inbox" when an inbox item exists.
- Two panes on the nested Carbon grid, centre 9 / original 7 at lg, 4 / 4 at md,
  stacked at sm (the inbox item page is the template).
- Centre tabs: Overview, Lines (invoice kinds only, count), Event (when an event
  exists), Links (count), Activity.
  - Overview: "Detail summary" key/value list in two columns (Reference, Date,
    Due date, Partner, Legal entity, Currency, Total, Amount due, VAT mode,
    Valid from and to, Source, Version), only rows with a value plus the
    required ones with "—"; then the free attributes for non-invoice kinds; then
    the issues as sentences with a red tag each (none: one green line "No open
    issues").
  - Lines: the invoice lines table (description, quantity, unit price, VAT,
    total), advance deductions and rounding rows marked, totals row.
  - Event: the debit and credit lines as a table with the balance line.
  - Links: table of linked documents (relationship, document, date) with "Link a
    document" in the tab toolbar.
  - Activity: sentences newest first: registered on, filed from the inbox by
    (with the inbox link), status changes if the API exposes them (else only
    what exists: created, version chain), versions ("Replaces FA-2026-12 v1",
    "Replaced by v3").
- Original pane: preview of the first file as on the inbox item page (PDF
  iframe, image, text), Files list with Download, and "Filed from the
  inbox 21. 9. 2026 by rule X" with the item link. No uuid, no ISO timestamp.
- The "Back to documents" button goes; the breadcrumb does that.

## `/documents/new` and `/documents/analytics` (lane D3)

- `/documents/new`: same page grid edges; sections with the 20 px heading and a
  Complete or Missing tag (Where: entity and kind; Document: title, date,
  reference, currency, partner; Lines for invoice kinds with the line editor,
  advance deductions and rounding as today); sticky bottom bar with Cancel and
  the primary "Register document"; Carbon `DatePicker` for dates; every
  validation message a sentence. No behaviour change.
- `/documents/analytics`: header with title, the same "Entity" dropdown and the
  period controls in a toolbar row; a stat row from `stats`; the four tables (by
  month, by account, by activity, by VAT regime) as DataGrid blocks with
  `fitContainer`, no title bands, amounts right aligned with `cs-CZ` formatting;
  the documents table with the kind icon. No new charts (out of scope; the
  dataviz pass is a later PR).

## Verification (lane D4, after D0 to D3)

- Unit tests per page; contract parity; API tests for `counts`.
- Operational proofs: `tests/operational/documents.spec.ts` (through
  `pnpm demo:documents`) and `tests/operational/inbox.spec.ts` (through
  `pnpm demo:inbox`) updated to the new pages, every step passing.
- Visual gate: screenshots with forced classic scrollbars at 1440 and 1056 of
  the four pages, edges measured (title, toolbar, tabs, grid, table, footer,
  stat row, panes within 1 px), no horizontal overflow, including the
  pre-existing 32 px overflow at 1056 on `/documents`, which this pass fixes.
- `pnpm check`.

## Gate

Orchestrator synthesis from Hleb's review and references, 2026-09-21; no advisor
gate (Hleb: basic verification only for this review round).

## Review round 2 (Hleb, 2026-09-21 14:00)

Findings on the :39200 stack, with the product rail expanded (content about 1150
px): the "Legal entity" dropdown floats in the header without a native look;
document rows use three generic icons while the inbox varies its icons by file
type; the detail page is unbalanced (actions wrapped under the tags, a tall
empty preview box, a half-empty left column); analytics shows "0 documents"
while the list shows three and prints "5 queries, 4 ms".

Decisions:

- Legal entity becomes a Carbon `ContentSwitcher` under the page header on
  `/documents` and `/documents/analytics` ("All entities" plus one segment per
  entity in scope, up to five; a dropdown inside the filter panel beyond five).
  It drives the tiles, tabs, grid and analytics. No header dropdown.
- One kind-to-icon map in `apps/web/src/lib/documents/kind-icon.ts` from the
  Carbon pack through the facade: issued invoice, received invoice, credit note,
  receipt, bank statement, contract or agreement, HR document, payroll, tax
  filing, other; used by the list, the detail header and analytics.
- Detail page: one header row that never wraps (breadcrumb; title, subtitle line
  and tags on the left; the primary button and the overflow on the right, top
  aligned with the title; the title truncates first). Below it one full-width
  "Summary" tile with the key/value pairs in four columns at lg and two at md
  (Reference, Document date, Due date, Partner; Legal entity, Kind, Currency,
  Total; Amount due, VAT mode, Source, Version; Status, Issues, Filed from the
  inbox, Files). Below it full-width tabs: Original (preview two thirds, files
  and the inbox link one third), Lines (invoice kinds), Event, Links, Activity;
  the default tab is Lines for invoices and Original otherwise. No permanent
  right pane.
- Analytics: the same switcher; tiles Invoices analysed, Event lines, Invoice
  lines; no query statistics anywhere; the empty state says that analytics
  covers invoice kinds and offers "Register an invoice" and "Open the inbox".
- The inbox proof registers two received invoices through `/documents/new` so
  the review stack has analytics data, and proves the inbox to document links in
  both directions (item "Open document", document "Filed from the inbox"),
  attach to an existing document, and the version chain after a reference
  conflict (detail tag "Version 2", Activity "Replaces …").

## Review round 3 (Hleb, 2026-09-21 15:30)

Findings: Hleb wants the legal entity control back in the header row, as the
Carbon multiselect dropdown (his reference:
carbondesignsystem.com/components/dropdown/usage/#multiselect, showing a count
tag "2 ×" in the field that clears every selection), not the content switcher
under the header.

Decisions:

- `/documents`: a Carbon `MultiSelect` ("Legal entity", label "All legal
  entities", size md) in the header row left of the primary "New document"
  button; `/documents/analytics`: the same control alone at the right of its
  header row. The switcher row and the more-than-five Select branch go away.
- Several entities can be selected; none selected means every entity in scope;
  the field's count tag × clears all. URL state stays in the `entity` query
  parameter as a CSV of ids.
- API (additive): `GET .../documents` (rows, `counts`, `totalsByCurrency`) and
  `GET .../documents/analytics` accept `legalEntityId` repeated or as CSV; one
  id behaves as before; each id is still checked against the caller's scope.
  Both contract mirrors, parity test, API tests, `docs/documents.md`.
- Proofs: the documents proof selects two entities where the seed has them or
  one otherwise, and checks the tiles and rows follow; the visual gate keeps the
  header row on one line at 1056.
