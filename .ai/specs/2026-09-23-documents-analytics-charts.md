# Documents analytics charts

**Date:** 2026-09-23. Implements after PR #75 (`hlebtkachenko/inbox-ux`) lands
on main. `.ai/specs/2026-09-21-documents-ux.md` left charts out ("the dataviz
pass is a later PR"); this is that PR.

## Problem

`/documents/analytics` answers every question with a table: three stat tiles,
then five `DataGrid`s. An accountant cannot see at a glance how revenue and
costs move month to month, whether a month ends with VAT to pay or to reclaim,
or which partners carry the volume.

## Scope

- Three charts between the stat tiles and the grids, each in `ChartFrame` with
  its table equivalent.
- Three additive response fields on `GET .../documents/analytics`.
- Out: grid and tile changes, currency conversion, new dependencies, a chart
  toolbar or export, drill-down from a mark, the reporting API.

## Charts

| #   | Question                                   | Carbon form                                 | Series and colour                                                                    |
| --- | ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | How do revenue and expenses move by month? | `GroupedBarChart`, months on the x axis     | Revenue, Expenses: Carbon 2-colour option 1, slot 1 and slot 2                       |
| 2   | Do I owe or reclaim VAT for a month?       | `SimpleBarChart`, bars above and below zero | VAT balance, one series, `color.pairing.option: 3` (so it matches no chart 1 series) |
| 3   | Who are the largest partners?              | `StackedBarChart`, horizontal, top 10       | Issued, Received: the same two slots as Revenue, Expenses                            |

Colour follows the entity: issued invoices make revenue and received invoices
make expenses, so each pair shares a slot. Every series is emitted even when it
is zero, so Carbon never moves a surviving series to slot 1. No raw hex:
Carbon's palette and themes only (DESIGN.md). The `dataviz` validator passes the
light pair (#6929c4, #009d9a: CVD ΔE 22.4, contrast >= 3:1). The dark pair
(#8a3ffc, #08bdba) passes separation and contrast and fails only the validator's
lightness band on teal 40; the legend and the table view are the secondary
encoding, so the Carbon palette stays.

Titles and descriptions are `documents.analyticsChart*` i18n keys: chart 1
"Revenue and expenses, last 12 months"; chart 2 "VAT balance by tax point month
(output minus input)", with a one-line description "Not a VAT return: credit
notes and advance tax documents are not included; input VAT counts in the month
of supply. Last 12 months."; chart 3 "Largest partners, all dates".

Chart 1 and chart 2 show 12 calendar months ending at the newest month with
data, gaps filled with zero; older months stay in the month grid. Chart 2 has a
single series, so no legend box. Chart 3 sorts by issued plus received, lists
names on the left axis in full (no truncation, so no label hover tooltip), the
largest on top, and leaves out invoices without a partner. Tooltip values are
HTML-escaped.

## API (additive, same scope)

`apps/api/src/documents/analytics-repository.ts` gains three statements.
`byMonthTotals` reuses the same `EVENT_LINE_SOURCE` and `EVENT_LINE_FILTER`
(organization, then the caller's entity scope), so #75's multi-entity
`legalEntityId` rules apply unchanged. `byPartner` and `currencyCodes` read
`app.document` directly like the invoice list: organization, the same entity
scope on `d.legal_entity_id`, `d.is_current`, and `INVOICE_KINDS`. Every such
invoice derives the event the other charts read. Money arithmetic stays in
PostgreSQL (`docs/documents.md`); amounts are decimal strings.

- `byMonthTotals: [{ month, revenue, expense, vatBalance }]`, grouped by
  `date_trunc('month', l.effective_date)::date::text`, built exactly like
  `BY_MONTH_QUERY`'s month column (`analytics-repository.ts:62`), so
  `formatMonth` parses it. `revenue` is credit minus debit on `REVENUE`
  accounts, `expense` is debit minus credit on `EXPENSE` accounts, and
  `vatBalance` is credit minus debit on account 343. That is output VAT minus
  input VAT: reverse-charge legs cancel, advance deductions are netted in. 343
  is a named constant next to the SQL, citing the rule set in
  `docs/documents.md`.
- `byPartner: [{ partnerId, partnerName, issued, received }]`, the top
  `MAX_ANALYTICS_PARTNERS = 10`. `issued` and `received` sum
  `app.document.total_amount` (`gross_total + rounding_amount`, before advances,
  the same number `/documents` list totals already sum,
  `docs/documents.md:133-136`), split by document kind and grouped by
  `d.partner_id`, joined to `app.partner` on `(partner_id, organization_id)`.
  Order: issued plus received descending, then `partner_id`. A seeded -0.30
  rounding proves the printed total, replacing the old 311/321 event-leg
  derivation.
- `currencyCodes: string[]`, the distinct `app.document.currency_code` of the
  current invoices in scope, sorted. Event amounts carry no currency, so this is
  the only honest unit label.

`stats.queryCount` goes from 5 to 8. `contract.ts` (Zod + OpenAPI) and the web
mirror `apps/web/src/lib/documents/contract.ts` change together.

## Page

- Placement: after `analytics-stats`, before `.tables`, inside the
  `documents.length > 0` branch, so the existing `DataTableSkeleton`, error
  notification and empty tile cover loading, failure and an empty scope. A
  nested Carbon `Grid`: chart 1 full width; charts 2 and 3 at `lg={16} xlg={8}`,
  so they sit side by side only from 1312 px. Each chart is wrapped in `Section`
  (as in `dataset-chart.tsx`), with test ids `analytics-chart-month`,
  `analytics-chart-vat`, `analytics-chart-partners`.
- Per-chart empty state: if a series set is all zero, or `byPartner` is empty,
  that slot shows one sentence ("No revenue or expenses in this scope yet.", and
  so on) and no chart.
- Currency: one code gives axis titles "Amount (CZK)". More than one gives a
  low-contrast warning `InlineNotification` above the charts: "These amounts add
  up CZK and EUR without conversion." The axis title is then "Amount". An empty
  `currencyCodes` (no documents in scope) shows the same plain "Amount" label.
- Formatting: value ticks use
  `Intl.NumberFormat('cs-CZ', { notation: 'compact' })` ("1,2 mil."), tooltips
  and tables use `formatMoney`; money stays cs-CZ throughout. Month ticks and
  tooltips both use `formatMonth` (#75) in the UI language, ticks in its short
  form, so a tick is never cs-CZ while its tooltip is the UI language; table
  cells use the same formatter and match the month grid.
- Options: `theme` from `useThemeMode().resolvedTheme`, `height` 320 px (chart
  3: 360 px), `resizable: true`, `animations: false`, `toolbar.enabled: false`
  (the table is in `ChartFrame`), `accessibility.svgAriaLabel` equal to the
  title, legend on for two series and off for one, bars start at zero.
- Series shaping: a pure `apps/web/src/lib/documents/analytics-series.ts` turns
  the response into chart data and `ChartTable` rows (month fill, 12-month
  window, `Number()` for mark geometry only). The page holds no arithmetic.
  Chart 3 gives each partner bar a unique chart key, appending a counter for
  duplicate names, while the `ChartTable` shows the plain partner name.
- Labels: new keys under `documents.analyticsChart*` in `resources.ts`.

## Security

No new boundary: the three statements share the `runInTenantContext` transaction
and the scope predicates of the five existing ones. Partner names are the ones
the invoice list already returns. Nothing new is logged.

## Verification

- API: `invoice-scenario.integration.test.ts` checks `byMonthTotals` against the
  scenario's known revenue, expense and VAT, the partner order and the 10-row
  cap, `byPartner` against the seeded -0.30 rounding, `currencyCodes`, and
  `queryCount: 8`. The restricted-member test at `:729-752` also expects
  `byMonthTotals: []`, `byPartner: []` and `currencyCodes: []`. New fixtures (an
  issued standard-VAT invoice, a negative rounding, 11+ partners, a second
  entity with data) live in their own `describe` with a fresh organization, so
  existing assertions stay. `document.controller.test.ts` and the OpenAPI schema
  get the new fields.
- Web: `contract.test.ts` parity; `analytics-series.test.ts` (gap fill, the
  12-month window, both series kept at zero, negative VAT, the unit label);
  `analytics/page.test.tsx` mocks the three chart components through
  `vi.mock('@bap/design-system/charts', importOriginal)`, keeps `ChartFrame`
  real, and checks the titles, table rows, empty sentences and mixed-currency
  warning; `bff.test.ts` fixture.
- Proof `tests/operational/documents-analytics.spec.ts`: inside each chart test
  id, `svg.layout-svg-wrapper[aria-label="<title>"]`, not `role="img"`. The
  chart 1 table matches the seeded months. The entity scope switch changes the
  chart tables, asserted as a superset, landing around `:430`.
- Visual gate `scripts/visual-gate.mjs`: the existing `documents-analytics`
  shots at 1440 and 1056 (`scrollWidth <= innerWidth`), plus one 1440 shot with
  `page.emulateMedia({ colorScheme: 'dark' })` (the demo owner's theme is
  `system`), read by the orchestrator.
- Gate: `pnpm check`, then `pnpm demo:documents` for the proof.

## Lanes

- L1 API: `contract.ts`, `analytics-repository.ts`, the two API tests,
  `docs/documents.md` ("Analytics route": eight statements, the three fields).
- L2 web, in parallel against the contract above: web contract and test,
  `analytics-series.ts` and test, analytics `page.tsx`, `page.module.scss`,
  `page.test.tsx`, `resources.ts`, `bff.test.ts`.
- L3 after both: proof, visual gate, and the `DESIGN.md:7-8` sentence that still
  calls domain analytics deferred.

## Open questions

- Is a 12-month window right? Recommendation: yes. A year is the accounting
  horizon, and the grid keeps the full history.
- Should `byPartner` net out advances (amount due, not gross)? Recommendation:
  no; "invoiced" is the plain question; `amount_due` stays in the invoice list.
- Should the three `ChartFrame` tables collapse, since they lengthen the page?
  Recommendation: ship them open. If the page reads too long, a later
  design-system change can add a collapsible table to `ChartFrame`.

## Gate

Advisor (Opus 5.5, 2026-09-23): revise, folded in.

- The partner measure is the printed total.
- The VAT chart keeps the neutral title and caveat.
- The window is 12 months.
- The chart tables ship open.
