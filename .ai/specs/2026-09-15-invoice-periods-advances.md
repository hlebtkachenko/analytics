# Invoice Line Periods, Advance Deductions and Rounding

**Date:** 2026-09-15

## Problem

One received invoice can cover several months of work, each month with its own
tax point date (DUZP) and its own economic activity, mix reverse charge lines
with standard rate lines, deduct an advance already paid, and round the total to
whole crowns outside VAT. The register from the 2026-09-14 spec stores one tax
point date per invoice, no service period, no activity, no advance and no
rounding, and every event leg carries the document date. A report by month or by
activity would have to divide the invoice, which is a recompute the platform
must never need.

## Scope

- `app.invoice_line` gains `line_kind` (`item` or `advance_deduction`),
  `tax_point_date`, `period_start`, `period_end` and `activity_code`; `category`
  becomes nullable and is required exactly on item lines; categories gain
  `labour` and `transport`.
- `app.invoice` gains `rounding_amount` (signed, strictly below one crown in
  absolute value), `advance_total` and a generated `amount_due`.
- `app.economic_event_line` gains `effective_date` and `activity_code`.
- Derivation rule set `cz-default-2026-09.1`: advance deduction legs, rounding
  legs, per leg effective date, labour and transport accounts.
- API contract, web mirror and the two invoice pages carry the new fields.
- Not in scope: a document kind for the advance tax document, editing invoice
  content after creation, dimension master tables, a reporting read path.

## Design

An advance deduction is a line kind, because the paper itemises deducted
advances by VAT regime and several advances at several rates may be deducted on
one final invoice. A rounding difference is a header scalar, because it has no
VAT regime, no category and no period, and its magnitude is bounded by law.

`base_total`, `vat_total` and `gross_total` keep summing item lines only.
`advance_total` sums deduction lines. `amount_due` is a stored generated column
`gross_total + rounding_amount - advance_total`; a check keeps it non negative.
`app.document.total_amount` for invoice kinds is the printed total,
`gross_total + rounding_amount`.

Every event leg carries `effective_date`, the tax point of the line with the
fallback line, invoice, document date. `app.economic_event.event_date` stays the
document date. Service periods are analytics attributes read by joining
`app.invoice_line`; derivation does not read them.

Rules on the received side: an advance deduction debits 321 by base plus VAT,
credits 314 by base and credits 343 by VAT when standard, and books no VAT legs
otherwise, because a reverse charge supply self assesses once at DUZP on the
full base. Rounding debits 548 and credits 321 when positive, and debits 321 and
credits 648 when negative. The issued side mirrors with 311, 324, 648 and 548.

Migration `20260915.0001_invoice_periods_advances.sql`;
`DATABASE_MIGRATION_COMPATIBILITY` becomes `20260915.0001`.

Research and decisions: `.context/research/2026-09-15-invoice-analytics-plan.md`
(not committed) and ADR 0013.

## Security

No new routes, no new roles, no new grants. The new columns are covered by the
existing per command row level security policies. `amount_due` cannot be written
by any role because it is generated.

## Verification

- `packages/db` integration tests: the new checks, the generated column, the
  backfilled `effective_date`.
- `apps/api` unit tests: derivation legs, contract rules.
- `apps/api/src/documents/invoice-scenario.integration.test.ts`: the five month
  invoice through the HTTP API, every fact read back with a plain SQL group by,
  the PATCH re-derive keeping the rounding leg, and a negative rounding case.
- `apps/web` contract and page tests.
