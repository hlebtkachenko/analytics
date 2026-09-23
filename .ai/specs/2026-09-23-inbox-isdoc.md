# Inbox ISDOC and ISDOCX parser

**Date:** 2026-09-23

**Correction (2026-09-23):** Review found that sender authentication alone
could file attacker-supplied email invoices. Parsed email children now require
an authenticated sender and a matched live sender-bound auto-route rule; the
route job checks again under the item lock.

## Problem

An ISDOC invoice lands as `isdoc_invoice` with an empty draft, a person retypes
every line, and an invoice kind never auto-routes
(`inbox-rule-repository.ts:226-234`, `inbox-rules.controller.ts:67-74`). ISDOC
comes first among Czech structured sources, with hardened XML parsing and IČO
entity resolution riding with it (`docs/planning/inbox.md:440-442`).

## Scope

- Provider `isdoc` (ISDOC 6.0.x XML and ISDOCX to a
  `createDocumentRequestSchema` draft), hardened XML and zip reading, entity and
  partner resolution by IČO, worker job `parse_inbox_item`, a content guard for
  invoice auto-route, `default_line_category` on `app.partner`, and the item
  page summary.
- Out: Money S3, Pohoda, CAMT, ARES, AI extraction, XMLDSig verification, ISDOCX
  supplements and the preview PDF, an `advance_tax_document` kind, foreign
  currency as document content, `advance_of` and `corrects` links, a line
  editor, entity chain steps 4 to 6, process isolation, pairing a sibling PDF,
  DIČ on `legal_entity`, a parse-time duplicate check.

## Design

### Detection

The sniff stays as it is: root `Invoice` in `http://isdoc.cz/namespace/2013` is
`isdoc_invoice` at 1.0 (`sniff.ts:36-41`); a zip whose central directory names
an `.isdoc` entry is `isdoc_invoice` at 0.9 (`sniff.ts:155-165`). The sniff only
nominates; the parser confirms or refuses:

- XML: root `Invoice` whose resolved namespace URI is the 2013 namespace and
  `version` matching `^6\.0(\.\d+)?$`. 6.0.1 and 6.0.2 share the namespace and
  the element names [S1, S4]. Any other version, or the 5.x namespace, raises
  `unsupported_type`.
- ISDOCX: `manifest.xml` at the archive root (exact name bytes) in
  `http://isdoc.cz/namespace/2013/manifest` names exactly one `maindocument`
  `filename` [S2 section 3.2.1, S3]. With no manifest, the one `.isdoc` entry in
  the root directory is the main document [S2 section 3.2.1]. Two root `.isdoc`
  entries and no manifest raise `unreadable`.

Plug-in point: after a clean verdict, `scan_inbox_item` and `split_email_item`
enqueue `parse_inbox_item` instead of the route job for `isdoc_invoice`, with
their payload and `routeRuleId` unchanged. `POST .../process` enqueues it under
the person pressing it, only when every blob has `scan_status = 'clean'` (else
409 as at `inbox.service.ts:955-961`; today it sniffs with no verdict check,
`:744-763`). Never parsed in a request. The queue joins `INBOX_QUEUES`, created
with `policy: 'exclusive'` (`inbox-queue.ts:157`); retry 3, delay 60,
`singletonKey = itemId`. `PROVIDER_STEPS` gains `parse` (API and
`apps/web/src/lib/inbox/contract.ts:137`).

### Hardened XML

`saxes` 6.0.0, already in `pnpm-lock.yaml` (via jsdom), ISC, becomes a direct
`apps/api` dependency through the catalog. It is non-validating, knows only the
5 predefined entities and fails on an undefined one [S5]. Safeguards:

- Check the byte size (5 MB) before decoding; decode with
  `TextDecoder('utf-8', { fatal: true })` [S2 section 3.1]. A declared other
  encoding or invalid UTF-8 is `unreadable`.
- Never set an `error` handler, so every well-formedness error throws; the
  `doctype` handler throws, so any `<!DOCTYPE` fails the parse.
- `xmlns: true`; the root is checked by resolved namespace URI, never prefix.
- Caps: depth 32, 20 000 elements, 4 000 characters of text per element, item
  lines plus deposits together at most `MAX_INVOICE_LINES` (200), because
  `createInvoiceSchema` caps all lines (`documents/contract.ts:582`). Over any
  cap: `too_large`, no draft.
- Elements outside the ISDOC namespace, `Extensions` and `ds:Signature` are
  skipped but still counted against the caps.

### ISDOCX reader

A stdlib reader (`zlib.inflateRawSync` with `maxOutputLength`, `zlib.crc32`),
not jszip: jszip 3.10.1 has no public inflate cap and no public uncompressed
size (`index.d.ts:54` is commented out). Every rule refuses the whole archive:

- End of central directory: search the last 65 557 bytes and take the last
  signature whose central directory fits inside the file and whose entry count
  matches, so a signature inside a comment or a stored entry cannot redirect the
  reader. ZIP64 markers (`0xFFFF`, `0xFFFFFFFF`) or a ZIP64 locator, split
  archives: `unsupported_type` [S2 section 3.2].
- Sizes, CRC, method and flags come from the central directory; the local header
  is read only for its name and extra lengths, and its name must be byte-equal.
  Bit 3 (data descriptor) is accepted because the central values are used.
  Offsets beyond the file, overlapping entries, and zero or negative sizes for a
  file entry are `unreadable`.
- Flag bit 0 or 6 `password_protected`, bit 5 `unreadable`, a method other than
  0 and 8 `unsupported_type`.
- Caps from central-directory values before any inflate: archive at most 25 MB
  (`MAX_ATTACHMENT_BYTES`), 50 entries, 50 MB declared total, ratio 100.
- Names: no `..` segment, no leading `/`, no `\`, `:` or NUL, no duplicates,
  compared as bytes (bit 11 not trusted). `maindocument/@filename` must equal an
  entry name byte for byte, a percent escape is refused; neither a directory
  entry nor `manifest.xml` is ever the main document.
- Only `manifest.xml` and the main document are inflated, with
  `maxOutputLength = min(declared + 1, MAX_XML_BYTES + 1)` for the main document
  and 64 KB for the manifest. A stored entry length, an inflated length or a CRC
  that differs from the declared value is `unreadable`.

The original file is the ISDOCX blob as received; its sha256 drives the exact
duplicate check at Arrive. The pure parser does no I/O and holds no database
connection: bytes in, draft and issues out.

### Field mapping

`DocumentType` [S1] decides the kind. The side comes from resolution below.

| ISDOC `DocumentType`          | BAP kind                              | Content                                    |
| ----------------------------- | ------------------------------------- | ------------------------------------------ |
| 1 invoice                     | `issued_invoice` / `received_invoice` | `invoice` block                            |
| 3 debit note                  | same as 1                             | `invoice` block, reason names the original |
| 7 simplified tax document     | same as 1                             | `invoice` block                            |
| 2 credit note, 6 advance CN   | `credit_note`                         | `totalAmount`, attributes                  |
| 4 proforma (no VAT)           | `advance_request`                     | `totalAmount`, attributes                  |
| 5 advance tax document (DDPP) | `advance_request`                     | `totalAmount`, attributes, never auto      |

Type 5 is an advance tax document, which ADR 0013 keeps out of the document
kinds (`docs/adr/0013-invoice-advances-rounding-and-line-periods.md:70`). Booked
as an invoice kind it would post the expense twice (518 at the advance and again
at the final invoice), leave its 321 uncleared because the payment was matched
to 314, and leave that 314 with no deduction. So it becomes `advance_request`
with attributes `isdoc_document_type`, `tax_point_date`, and per rate
`vat_base_<rate>`, `vat_amount_<rate>` (`PercentType` is `xs:decimal`, so the
rate is canonical digits with `_` for the point: `vat_base_21`,
`vat_base_12_5`), and the reason says the VAT claim is not derived. An
`advance_tax_document` kind with a 343/314 rule is a follow-up.

Attribute keys are snake_case (`documents/contract.ts:218`); every kind stores
`isdoc_document_type`. Credit notes carry no invoice content and non-negative
amounts (`docs/documents.md:193-209,499-500`): `totalAmount` is the absolute
`TaxInclusiveAmount`, attributes `signed_total_amount` (raw) and
`original_reference`. Header: `ID` to `reference` (over 64 dropped with a
reason, `documents/contract.ts:210`); `IssueDate` to `documentDate`;
`TaxPointDate` to `invoice.taxPointDate`; the first
`PaymentMeans/Payment/Details` gives `dueDate` and `variableSymbol` (dropped
with a reason unless 1 to 10 digits); `title` is the counterparty name and the
`ID`, cut to 200 (`:211`); `UUID` is reason evidence only.

### Currency

Analytics has no currency dimension (`documents/analytics-repository.ts:48-93`),
so foreign content would sum EUR into CZK. Content always uses the local
elements: `currencyCode = LocalCurrencyCode`; the CZK figures are the
tax-document figures. With `ForeignCurrencyCode`,
`fxRate = CurrRate / RefCurrRate` to 6 places, documented as CZK per one foreign
unit (XSD `CurrRateType` and `RefCurrRateType` [S1]; `fx_rate` has no stated
direction, `20260914.0002_documents.sql:388`); attributes
`foreign_currency_code` and `foreign_payable_amount`; the totals identities run
over the `*Curr` elements too. A `LocalCurrencyCode` other than CZK raises
`unsupported_type` on `currencyCode`, keeps the draft and never auto-routes.

### Lines, deposits, rounding

Item lines, one per `InvoiceLine` in document order: `description` from
`Item/Description`, else `Note`, else `Line <ID>`, cut to 500
(`documents/contract.ts:495`); `quantity` and `unit` from `InvoicedQuantity` and
its `unitCode`, a unit over 16 (`:502`) dropped with a reason; `unitPrice` from
`UnitPrice`; `baseAmount` from `LineExtensionAmount`; `vatAmount` from
`LineExtensionTaxAmount`; `vatRate` from `ClassifiedTaxCategory/Percent`.
`vatMode`: header `VATApplicable = false` or line
`ClassifiedTaxCategory/VATApplicable = false` is `outside_scope`;
`LocalReverseCharge` present is `reverse_charge`; rate 0 with VAT applicable is
`exempt` at field confidence 0.9; otherwise `standard`. ISDOC has no category
(Routing below). A negative line amount is never flipped: the line stays as
parsed and raises `amount_mismatch`.

Advance deductions, appended after the item lines as
`line_kind = 'advance_deduction'`, no category, no tax point, no period:
`TaxedDeposit` gives base `TaxableDepositAmount`, VAT
`TaxInclusiveDepositAmount - TaxableDepositAmount`, rate and mode from its
`ClassifiedTaxCategory`; `NonTaxedDeposit` (a paid proforma) gives base
`DepositAmount`, `outside_scope`, rate 0, which derives 324/311 and 321/314
(`docs/documents.md:123-124`). Description is `Advance <ID>` with the variable
symbol. `PayableRoundingAmount` goes to the signed `invoice.roundingAmount`;
`invoice.amount_due` is never written.

### Totals cross-check

Exact to the cent; a mismatch raises `amount_mismatch` (`vat_mismatch` for a VAT
figure) with the draft path in `field` and both values in the message. Per line,
`LineExtensionAmountTaxInclusive = LineExtensionAmount + LineExtensionTaxAmount`.
Line bases against `TaxExclusiveAmount`, base plus VAT against
`TaxInclusiveAmount`, per-rate sums against each `TaxSubTotal`, and
`TaxTotal/TaxAmount` against the sum of `TaxSubTotal/TaxAmount`. Per rate, the
sum of `TaxedDeposit/TaxableDepositAmount` against
`TaxSubTotal/AlreadyClaimedTaxableAmount`; taxed deposits against
`AlreadyClaimedTaxInclusiveAmount`; untaxed deposits against
`PaidDepositsAmount`.
`DifferenceTaxInclusiveAmount = TaxInclusiveAmount - AlreadyClaimedTaxInclusiveAmount`,
and `DifferenceTaxInclusiveAmount - PaidDepositsAmount + PayableRoundingAmount`
against `PayableAmount` (inferred from the element definitions [S1], not stated
by the standard).

Pre-checked as `amount_mismatch`, so the route job never meets an unexpected
23514 that it rethrows and retries into a dead job
(`worker/route-inbox-item.ts:358-361`): deducted at most supplied plus rounding
(`documents/contract.ts:628-635`, `invoice_amount_due_check`) and
`abs(rounding) < 1` (`invoice_rounding_amount_check`). The draft is then run
through `createDocumentRequestSchema`; each failure becomes one issue. Nothing
is ever adjusted to make it balance.

### Legal entity and partner resolution

IČO is the party's `PartyIdentification/ID`, mandatory in ISDOC [S1], normalised
to digits and left-padded to 8. DIČ is `PartyTaxScheme/CompanyID` where
`TaxScheme = VAT`. `app.legal_entity` has no DIČ column
(`20260910.0001_legal_entities.sql:5-24`), so own entities match by IČO only.

- Supplier own: `issued_invoice`; customer own: `received_invoice`. Both own:
  the channel or hint entity picks the side, else `entity_conflict`. Neither:
  `entity_unresolved` and a null parsed kind.
- The parsed entity stays on the extraction row; the parse never writes
  `inbox_item.legal_entity_id`, which counts as a hint (`draft-composer.ts:92`),
  so a hostile file naming a public IČO cannot steer the item into a restricted
  member's lane.
- A channel, hint, rule or target-default entity that differs from the parsed
  one, a bound entity with an IČO when the file names none of ours, or two own
  entities with the same IČO, is `entity_conflict`.

Confidence: entity from step 1 or 2 is 1.0, step 3 (IČO) 0.95, unresolved 0.5;
the extraction takes the lower of that and the parse (1.0 when clean). Steps 4
to 6 stay out: `app.partner.legal_entity_id` means "this partner is our own
entity" (`20260914.0002_documents.sql:257-258`), not a default entity.

Partner: the counterparty matches `app.partner` by normalised IČO, then by DIČ.
One match sets `partnerId`. Several matches by either (the unique index holds
the raw string, `20260914.0002_documents.sql:278-280`, so `123` and `00000123`
both match): none is picked, `unknown_partner` with the candidate ids. No match:
`unknown_partner`, and the proposal (name, IČO, DIČ, country) goes into the
reason evidence, not the draft. A person creates the partner from the item page
with the existing `POST .../partners`. Nothing creates a partner without ARES.

### Principals

A channel cannot read `legal_entity` or `partner`
(`20260917.0001_inbox_channels.sql:374-378,421-425`); the member-level SELECT
policies admit `system_automation` (`20260910.0001_legal_entities.sql:121-122`),
but `inbox_item_extraction_insert` and `inbox_event_insert` (`:342-353`) refuse
it (member role, not a channel) and ADR 0016 keeps it write-less
(`docs/adr/0016-channel-principal.md:246-254`). So the job parses outside any
transaction, then:

1. Transaction 1 as `system_automation`, read-only: legal entities and partners
   by IČO and DIČ, plus the partner's `default_line_category` (a channel cannot
   read `app.partner` in transaction 2); both travel in memory only. Targets
   come through the `app.list_inbox_routing_targets()` definer
   (`inbox-repository-support.ts:242-249`).
2. Transaction 2 through `runTenantJob` under the scan job's payload union:
   uploader `{organizationId, userId, itemId}` or channel
   `{organizationId, channelId, itemId}` (`worker/job-context.ts:29-37,57-62`).
   It writes the `isdoc` row and the `extracted` event, decides the auto-route,
   and enqueues the route after commit. A demoted uploader fails before any
   write; `process` re-enqueues under the person pressing it. No new policy.

### Routing, rules, corrections

Composer: `composeDocumentDraft` reads the newest `isdoc` row as the provider
layer and passes `invoice`, `reference`, `documentDate`, `currencyCode`,
`totalAmount` and `attributes` through `toCreateDocumentBody`. Precedence for
kind and entity is hint, rule, parse, then target default. The parsed kind
outranks the target default because it is a fact from the file (this differs
from `docs/planning/inbox.md:165-171`). A hint or rule kind that is not an
invoice kind drops the `invoice` block.

Line category: item lines take the resolved partner's nullable
`app.partner.default_line_category`; the auto_route row records the source per
line (`partner_default` or `person`). A null default or no partner means review,
because an item line needs a category (`invoice_line_category_kind_check`,
`20260915.0001:25-26`). An owner or admin sets it through the existing partner
edit surface, `PATCH .../partners/:partnerId`
(`apps/api/src/documents/partner.controller.ts:157`, BFF
`apps/web/src/app/api/bff/application/organizations/[organizationId]/partners/[partnerId]/route.ts`;
`partner_update` needs `app.role_can_write()`,
`20260914.0002_documents.sql:603-611`). Main has no partner page, so the item
page shows that select to owner and admin.

Item detail gains `parsed`, the newest `isdoc` row (`extraction` is the newest
row of any provider, `inbox-repository-support.ts:183-205`). Manual route: the
body names that row by `parsedExtractionId` and carries no `invoice`; the
service copies `invoice`, `totalAmount` and `attributes` from the stored row
(not the item's newest `isdoc` row: 422), so credit notes and types 4 and 5
follow the same rule. The client's `parsed.draft` is never trusted.

Auto-route: the `INVOICE_KINDS` refusal and the rule routes' 422 `not_available`
are removed. The guard lives once in `decideAutoRoute`
(`inbox/inbox-rule-repository.ts:196-251`), fed by one loader the rule pass and
the parse job share. An invoice kind auto-routes only when the target or a rule
asks and all hold:

- the newest `isdoc` row carries an `invoice` block, and no extraction row
  created at or after it carries an issue (today only the newest row is read,
  which a rule row with `issues: []` would mask);
- the entity came from chain steps 1 to 3 with no `entity_conflict`;
- the parsed kind equals the resolved kind; an unresolved side gives a null
  parsed kind, so this fails instead of the target default `received_invoice`
  (`routing-targets.ts:40-44`) supplying a direction the file never stated;
- the parse resolved the partner, any hint or rule partner equals it (else
  blocked with a reason), and it has a `default_line_category`;
- an email child with a parsed layer has `sender_authenticated` and a matched
  live auto-route rule with a sender pattern. A target default alone, or a rule
  without a sender pattern, cannot auto-route that child, whatever its kind.

Type 5 never auto-routes, with the VAT claim reason. Otherwise the item stays in
review with the reason. The parse job recomputes the decision from the stored
rule matches, because no rule condition reads a parsed field. The route job
rechecks the parsed content and the live rule after locking the item.

Duplicates: exact stays sha256 at Arrive. The parse job runs no
`findDuplicateCandidates`: as `system_automation` it would read organization
wide and leak document ids into an issue message. The route job and the manual
route run it under a scoped principal (`worker/route-inbox-item.ts:274-285`).

Corrections: header fields keep `inbox_correction`, source `provider`. Lines are
create-time facts (`docs/documents.md:501-502`): only the batch line category is
set in the Inbox; wrong lines mean discard or another kind.

### Issues, confidence, provenance

`INBOX_ISSUE_CODES` (API and web) gains `amount_mismatch`, `vat_mismatch`,
`unknown_partner` and `entity_conflict` (jsonb, no migration). `field` and field
confidences use the draft path (`invoice.lines[3].vatAmount`); line `i` is
`InvoiceLine[i+1]`, then deposits in order; messages name the XML path.

## Lanes (one PR, three vertical commits)

1. db: `20260923.0001_inbox_isdoc.sql`, the only migration: nullable
   `app.partner.default_line_category`, checked against the list of
   `invoice_line_category_check` (`20260915.0001:20-22`); Drizzle, partner
   contract (API and web), OpenAPI.
2. api and worker: `providers/isdoc.ts`, `providers/isdocx.ts`,
   `worker/parse-inbox-item.ts`, `job-context.ts`, the three enqueue sites, the
   `process` check, composer, `decideAutoRoute`, `parsed`, the route body,
   removal of `refuseInvoiceAutoRoute`, `saxes` in the catalog.
3. web: item page summary (`DataGrid` lines and deductions, totals, issues,
   "XMLDSig not verified"), line and partner category selects, "Create partner",
   `parsedExtractionId` in the route body, the copy at `resources.ts:751,824`.

## Security

Attacker bytes are parsed in the worker as `bap_api`; process isolation stays
open (planning security ranking 2). Review points: the saxes safeguards; zip
caps before inflating; names; entries stay in memory; `system_automation` writes
nothing; the parsed entity never reaches `inbox_item`; invoice content comes
only from the stored row. Logs carry ids and issue codes, never party names,
IČO, amounts or XML text.

## Verification

- `isdoc.test.ts`: each `DocumentType`; each side case; local and foreign
  currency, non-CZK local; deposits; rounding both signs; each cross-check and
  pre-check; line `VATApplicable`; length cuts; negative line; the shared
  200-line cap; version 5.x; a right prefix on a wrong URI; DOCTYPE, external
  and undefined entities; every cap; bad UTF-8.
- `isdocx.test.ts`: one fixture per reader rule above, each EOCD, header,
  offset, flag, method, ZIP64, cap, length, CRC and naming failure mode.
- Fixtures are synthetic (`providers/__fixtures__/index.ts`, placeholder names,
  IČO `00000000` and `11111111`); one copies a real emitter's totals block shape
  (Pohoda or Money S3 style, synthetic values) for the rounding and deposit
  identities.
- Composer precedence and each `decideAutoRoute` condition.
- Integration: an upload scans, parses and auto-routes to a `received_invoice`
  with lines, deduction and rounding; a channel item resolves and writes as the
  channel; a demoted uploader fails before any write; `process` refuses an
  unscanned blob; a route with a client `invoice` block is refused.
- Web: summary, category selects, create partner. Gate: `pnpm check` and
  `pnpm test:integration`.

## Gate

Advisor-critical (Fable 5.1, 2026-09-23): revise, folded in.

- Currency: local CZK as content, foreign in attributes.
- Type 5: `advance_request` now; `advance_tax_document` kind later.
- Line category default: an `app.partner` column.
- Debit note (type 3): invoice kind, `corrects` link later.
- Preview PDF inside ISDOCX: follow-up extraction; XMLDSig stays unverified and
  the UI says so.

Re-gate (Fable 5.1, 2026-09-23): approve; five text fixes folded.

## Sources

- [S1] https://isdoc.cz/6.0.1/xsd/isdoc-invoice-6.0.1.xsd
- [S2] https://isdoc.cz/6.0.1/doc/isdoc.pdf (the 6.0.1 standard)
- [S3] https://isdoc.cz/6.0.1/xsd/isdoc-manifest-6.0.1.xsd
- [S4] https://isdoc.cz/6.0.2/xsd/isdoc-invoice-6.0.2.xsd
- [S5] https://github.com/lddubeau/saxes/blob/v6.0.0/README.md
