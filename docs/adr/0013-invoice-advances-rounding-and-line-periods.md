# ADR 0013: Invoice Advances, Rounding and Line Periods

- Status: accepted
- Date: 2026-09-15

## Context

A Czech invoice routinely carries facts that the first documents register
(ADR 0012) could not hold: several tax point dates on one paper, a service
period per line, an economic activity per line, an advance already paid and
deducted on the final invoice, and a rounding difference to whole crowns that
the VAT Act (§ 36 odst. 5, since 1 October 2021 for every payment method)
excludes from the tax base. The register stored one tax point date, every amount
non negative, and every event leg dated by the document date, so a report by
month or by activity would have had to split the invoice arithmetically. BAP is
an analytics platform: every fact must be stored split at write time and read
with a plain group by.

## Decision

An advance deduction is an `app.invoice_line` with
`line_kind = 'advance_deduction'`. It carries base, VAT mode, VAT rate and VAT
amount like a supply line and no category, no tax point date and no period: its
legs take the final invoice's tax point, never the month the advance was paid.
The paper itemises deducted advances by VAT regime, and several advances at
several rates may be deducted on one final invoice, so a header scalar cannot
hold it. Amounts stay non negative: direction lives in the line kind.

A rounding difference is a signed header scalar, `app.invoice.rounding_amount`,
with a check `abs(rounding_amount) < 1`. It is the one signed money column in
the register. It has no VAT regime, no category and no period, so a line would
carry meaningless columns and would need a direction flag of its own.

`base_total`, `vat_total` and `gross_total` sum item lines only. `advance_total`
sums deduction lines. `amount_due` is a stored generated column
`gross_total + rounding_amount - advance_total`, kept non negative by a check;
an overpaid advance is settled by another document, never by a negative amount
due. The register's `total_amount` for an invoice is the printed total,
`gross_total + rounding_amount`.

Each line carries its own `tax_point_date`, `period_start`, `period_end` and
`activity_code`. Each derived event leg carries `effective_date`, the tax point
of its line with the fallback line, invoice, document date, and a copy of the
line's `activity_code`. `app.economic_event.event_date` stays the document date.
`effective_date` is the supply date and never the service period; accrual
reports join `app.invoice_line` for the period. `activity_code` is a free
normalised code, not a dimension table: one writer exists and a master table
would be a table, two routes and a page for a list nobody maintains yet.

Derivation, rule set `cz-default-2026-09.1`: on the received side an advance
deduction debits 321 by base plus VAT, credits 314 by base and credits 343 by
VAT when standard; it books no VAT legs for any other VAT mode, because a
reverse charge supply self assesses once at DUZP on the full base. Rounding
debits 548 and credits 321 when positive, and debits 321 and credits 648 when
negative. The issued side mirrors with 311, 324, 648 and 548. Categories gain
`labour` and `transport`, both 518 received and 602 issued, so the kind of work
is groupable without parsing descriptions.

## Consequences

- One invoice with five months, mixed regimes, an advance and a rounding
  difference is read by month, by activity, by VAT regime and by account with
  group by only.
- Every existing event line receives `effective_date` equal to its event date in
  the migration; old events keep rule set `cz-default-2026-09` until their
  document is written again, as ADR 0012 already states.
- Invoice content stays a create time fact. `PATCH` carries register fields
  only; the re-derive on partner or document date now also reads the invoice
  header, because the rounding legs and the tax point fallback depend on it.
- The advance tax document itself is not a document kind yet. A final invoice
  links to a registered advance document through `app.document_link` with kind
  `settles`.
- A second analytic dimension (cost centre, job) follows the same column
  pattern; a dimension table arrives with its second writer.
