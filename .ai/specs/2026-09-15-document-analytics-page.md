# Document Analytics Page and Documents Demo

**Date:** 2026-09-15

## Problem

The register stores every invoice fact split per line, period and activity, but
nothing shows that the stored split answers a question without recompute. A
reviewer has to trust the docs or write SQL by hand. There is also no one
command that boots a stack, seeds documents and shows the result.

## Scope

- `GET /v1/organizations/:organizationId/documents/analytics?legalEntityId=`
  (capability `readDocuments`, entity scope applied): the invoice documents in
  scope with their totals and amount due, plus four aggregates read straight
  from the stored columns: expense and revenue by month of `effective_date` and
  account, by `activity_code`, VAT by `line_kind` and regime, and totals by
  account. The response also carries how many event lines were read and how long
  the queries took, so the page can state its own cost.
- BFF route and Zod mirror, page `/documents/analytics` inside the product
  shell, reached from the documents list; breadcrumb Documents, Analytics.
- `pnpm demo:documents`: the disposable stack from `demo:tenancy`, the owner
  account, a legal entity, a partner and five synthetic documents (one of them
  the five month invoice with mixed VAT, a deducted advance and rounding), then
  the analytics page opened in the browser and asserted by a Playwright
  operational spec.
- Not in scope: charts, exports, the reporting API, date filters beyond the
  legal entity.

## Design

The aggregates are four `group by` statements over `app.economic_event_line`,
`app.economic_event`, `app.invoice_line` and `app.directive_account`, filtered
by organization (row level security) and by the caller's legal entity scope
(application filter). No arithmetic happens in TypeScript beyond formatting. The
shared demo steps move from `scripts/demo-tenancy.sh` into
`scripts/demo-lib.sh`; `demo:tenancy` keeps its behaviour.

## Security

Same guard, same capability and same scope filter as the document list. No new
roles, tables or grants. Seed data is synthetic placeholder content created only
inside the disposable demo stack, never committed as fixtures.

## Verification

- API unit test for the contract and controller matrix; the scenario integration
  test calls the route and asserts the aggregate rows.
- Web contract, BFF and page tests.
- `tests/operational/documents-analytics.spec.ts` run by `pnpm demo:documents`.
